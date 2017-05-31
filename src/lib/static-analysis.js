// @flow
import {getSwaggerPathFromExpress} from './helpers';
import {schemaFromEndpoints} from 'swagger-to-graphql';
import graphql from 'graphql';
import {dirname} from 'path';
type Location = {
  start: {
    line: number,
    column: number
  },
  end: {
    line: number,
    column: number
  }
}
type SwaggerParam = {
  name: string,
  in: string,
  required: boolean,
  type: ?string,
  schema: ?Object
}
type FnLocation = {filename: string, loc: Location}
type AST = {body: Array<any>}

const babylon = require('babylon');
const HTTPServiceAnnotationTypes = ['Headers', 'QueryString', 'Path', 'JSONResp', 'JSONBody'];
const Promise = require('bluebird');
const exec = Promise.promisify(require('child_process').exec);
const fs = Promise.promisifyAll(require('fs'));
const swagger = {
  host: 'localhost:3000',
  basePath: '/v1',
  swagger: '2.0',
  info: {title: 'Auto generated', version: '1.0'},
  paths: {},
  definitions: {}
};
const gqlEndpoints = {};

function flowGetDef(fn, loc: Location, typeName) {
  const line = loc.start.line;
  const cmd = `flow get-def ${fn} ${loc.start.line} ${loc.start.column}`;
  const reg = new RegExp(/(.*?):([0-9]+):([0-9]+),([0-9]+):([0-9]+)/);
  return exec(cmd).then((stdout, stderr) => {
    if (stderr) {
      throw new Error(stderr);
    }
    const m = stdout.trim().match(reg);
    if (!m) {
      throw new Error(`Cannot resolve type ${typeName} in ${fn}:${loc.start.line}:${col}. STDOUT: ${stdout.trim()}`);
    }
    console.log(cmd, stdout);
    const newFilename = m[1];
    const newLoc = {
      start: {
        line: +m[2],
        column: +m[3]
      },
      end: {
        line: +m[4],
        column: +m[5]
      }
    };
    if (newLoc.start.line === 0) {
      return {
        filename: fn,
        loc
      }
    } else {
      return flowGetDef(newFilename, newLoc, typeName);
    }
  });
}

function getCodeFromLocation(location: FnLocation) {
  const loc = location.loc;
  return fs.readFileAsync(location.filename).then(source => {
    const startPoint = loc.start.line * loc.start.column;
    const endPoint = loc.end.line * loc.end.column;
    //console.log(location, source.toString(), startPoint, endPoint);
    return source
      .toString()
      .split('\n')
      .map((line, ii) => {
        const i = ii + 1;
        if (i < loc.start.line || i > loc.end.line) return null;
        if (i === loc.start.line) {
          return line.substr(loc.start.column -1, line.length - loc.start.column +1);
        }
        if (i === loc.end.line) {
          return line.substr(0, loc.end.column);
        }
        return line;
      })
      .filter(line => line)
      .join('\n');
  });
}

function getAstByCode(source: string):AST {
  try {
    return babylon.parse(source, {sourceType: 'module', plugins: ['flow']}).program;
  } catch (e) {
    throw new Error(`Failed to parse ${source}: ${e}`);
  }
}

function analyzeFolder(dir: string) {
  return fs.readdirAsync(dir).then(list => {
    return Promise.all(list.map(fileName => {
      return analyzeFile(`${dir}/${fileName}`);
    }));
  });
}

function analyzeFile(fn: string) {
  return fs.readFileAsync(fn).then(source => {
    const ast = getAstByCode(source.toString());
    return findServiceTypes(ast, fn);
  });

}

function getArgsByName(genTypeDef, args: Array<any>) {
  if (genTypeDef.typeParameters) {
    return genTypeDef.typeParameters.params.reduce((prev, param, i) => {
      prev[param.name] = args[i];
      return prev;
    }, {});
  } else {
    return {};
  }
}

function mapTypeToJson(flowTypeName) {
  const type = {
    BooleanTypeAnnotation: 'boolean',
    StringTypeAnnotation: 'string',
    NumberTypeAnnotation: 'number',
    NullLiteralTypeAnnotation: 'null'
  }[flowTypeName];
  if (!type) {
    throw new Error(`Unknown primitive flow type ${flowTypeName}`);
  }
  return type;
}

function mapHTTPTypeToSwaggerIn(type) {
  const inProp = {
    Headers: 'header',
    QueryString: 'query',
    Path: 'path',
    Form: 'form',
    JSONBody: 'body'
  }[type];
  if (!inProp) {
    throw new Error(`Unknown HTTP extractor type ${type}`);
  }
  return inProp;
}

function mapHTTPTypeToContentType(type) {
  const contentType = {
    JSONResp: 'application/json'
  }[type];
  if (!contentType) {
    throw new Error(`Unknown HTTP response type ${type}`);
  }
  return contentType;
}

// @TODO support nullable
function getObjectJSONSchema(node, args) {
  if (node.type === 'TypeAlias') {
    const typeName = node.id.name;
    // Generic service types just return it's argument
    if (HTTPServiceAnnotationTypes.includes(typeName)) {
      return args[0];
    }
    const params = getArgsByName(node, args);
    if (!node.right || !node.right.properties) {
      throw new Error(`Don't know how to handle type definition ${node.id.name}`);
    }
    // @TODO nesting objects
    const objType = node.right.properties.reduce((prev, prop) => {
      let propType = prop.value.type === 'GenericTypeAnnotation' || prop.value.type === 'NullableTypeAnnotation' ? params[prop.value.id.name] : prop.value.type;
      if (typeof propType === 'object') {
        propType.type = 'object';
      } else {
        propType = {
          type: mapTypeToJson(propType)
        }
      }

      prev.properties[prop.key.name] = propType;
      return prev;
    }, {properties: {}});
    objType.required = node.right.properties.map(prop => prop.key.name);
    return objType;
  } else {
    throw new Error(`Type declaration ${node.type} is not supported`);
  }
}

function findMatchedLocation(node: any, location: FnLocation) {
  function areLocMatches(astLoc: Location) {
    return astLoc.start.line === location.loc.start.line && astLoc.start.column + 1 === location.loc.start.column
  }

  if (node && node.loc && areLocMatches(node.loc)) {
    return node;
  } else {
    return Object.values(node).find(chNode => {
      if (chNode && typeof chNode === 'object') {
        return findMatchedLocation(chNode, location)
      } else {
        return false;
      }
    });
  }

}

function getAstOfTypeFromFile(location: FnLocation) {
  // @TODO ast cache

  return fs.readFileAsync(location.filename).then(source => {
    const ast = getAstByCode(source.toString());
    // @TODO change to visitor pattern
    let type = ast.body.find(bodyNode => findMatchedLocation(bodyNode, location));
    // let type = ast.body.find(exp => {
    //   const loc = exp.id ? exp.id.loc : exp.loc;
    //   return ['ExportNamedDeclaration', 'TypeAlias'].includes(exp.type) && areLocMatches(loc);
    // });
    if (!type) {
      throw new Error(`Type is not found by given location: ${JSON.stringify(location)}`);
    }
    if (type.type === 'ExportNamedDeclaration') {
      type = type.declaration;
    }

    if (type.type !== 'TypeAlias') {
      throw new Error(`Found non TypeAlias declaration, donno how to handle: ${JSON.stringify(location)}`);
    }
    return type;
  });
}

function resolveObjectWithArgs(type, promisedArgs, fn) {
  return promisedArgs.then(args => {
    //console.log('RESOLVED ARGS', args);
    const loc = Object.assign({}, type.loc);
    loc.start.column++; // no idea why, but must be so
    const typeName = (type.id && type.id.name) || type.type;

    return flowGetDef(fn, type.loc, typeName).then(location => {
      return getAstOfTypeFromFile(location);
    }).then((ast) => {
      return getObjectJSONSchema(ast, args)
    });
  });
}

// Return JSON Schema for ast Flow type
function resolveType(type, fn) {
  if (type && (type.type === 'TypeAnnotation' || type.type === 'GenericTypeAnnotation')) {
    let promisedArgs;
    if (type.type === 'GenericTypeAnnotation' && type.typeParameters) {
      const args = type.typeParameters.params;
      promisedArgs = Promise.all(args.map(arg => resolveType(arg, fn)));
    } else {
      promisedArgs = Promise.resolve([]);
    }
    return resolveObjectWithArgs(type, promisedArgs, fn);
  } else {
    return Promise.resolve(mapTypeToJson(type.type));
  }
}

// route({method: 'POST', path: '/track'})((token: Headers<string>, event: QueryString<string>): JSONResp<Resp<User>> => {
function isExpressionHTTPRoute(expr) {
  function debug(cs) {
    console.log(`expression at line: ${expr.loc.start.line} pretending to be a HTTP route, condition ${cs} of 9`);
    return true;
  }
  return expr.expression && debug(1) &&
    expr.expression.type === 'CallExpression' && debug(2) &&
    expr.expression.arguments && debug(3) &&
    expr.expression.arguments.length === 1 && debug(4) &&
    expr.expression.arguments[0].type === 'ArrowFunctionExpression' && debug(5) &&
    expr.expression.arguments[0].returnType && debug(6) &&
      HTTPServiceAnnotationTypes.includes(expr.expression.arguments[0].returnType.typeAnnotation.id.name) && debug(7) &&
    expr.expression.callee.arguments.length === 1 && debug(8) &&
    expr.expression.callee.arguments[0].type === 'ObjectExpression' && debug(9);
}

function isExpressionGraphQLRoute(expr) {
  function debug(cs) {
    console.log(`expression at line: ${expr.loc.start.line} pretending to be a GQL route, condition ${cs} of 9`);
    return true;
  }
  return expr.expression && debug(1) &&
    expr.expression.type === 'CallExpression' && debug(2) &&
    expr.expression.arguments && debug(3) &&
    expr.expression.arguments.length === 1 && debug(4) &&
    expr.expression.arguments[0].type === 'ArrowFunctionExpression' && debug(5) &&
    expr.expression.arguments[0].returnType && debug(6) &&
    expr.expression.callee.arguments.length === 1 && debug(8) &&
    expr.expression.callee.arguments[0].type === 'ObjectExpression' && debug(9) &&
    ['typeName', 'isMutation'].includes(expr.expression.callee.arguments[0].properties[0].key.name) && debug(10);
}

fucntion handleGraphQL(expressionStatement, fn) {
  const func = expressionStatement.expression.arguments[0];
  const params = func.params;

  const promises = (params || []).map(param => resolveType(param.typeAnnotation.typeAnnotation, fn));
  if (func.returnType) {
    promises.push(resolveType(func.returnType.typeAnnotation, fn));
  }
  return Promise.all(promises).then((types) => {
    const parameters = params.map((param, paramI) => {
      const paramType = types[paramI];
      const paramObj = {};
      if (typeof paramType === 'object') {
        paramObj.schema = paramType;
      } else {
        paramObj.type = paramType;
      }
      return {name: param.name, types[paramI], jsonSchema: paramObj};
    });
    const {typeName, isMutation} = getObjectFromAst(expressionStatement.expression.callee.arguments[0].properties);
    if (gqlEndpoints[typeName]) {
      gqlEndpoints[typeName] = {};
    }
    gqlEndpoints[typeName] = {
      parameters,
      description: typeName,
      response: types[types.length - 1],
      mutation: isMutation,
      request: (args) => {
        
      }
    }
  });
}

function persistAPI() {
  return fs.writeFileAsync(`${__dirname}/../../swagger/swagger.json`, JSON.stringify(swagger)).then(() => {
    if (Object.keys(gqlEndpoints)) {
      const schema = schemaFromEndpoints(gqlEndpoints);
      return fs.writeFileAsync(`${__dirname}/../../graphql/graphql.json`, graphql.printSchema(schema));
    }
  });
}

function getObjectFromAst(propsAst) {
  const keys = expressionStatement.expression.callee.arguments[0].properties.map(prop => prop.key.name);
  const vals = expressionStatement.expression.callee.arguments[0].properties.map(prop => prop.value.value);
  return keys.reduce((obj, key, j) => {
    obj[key] = vals[j];
    return obj;
  }, {});
}

function handleSwagger(expressionStatement, fn) {
  const func = expressionStatement.expression.arguments[0];
  const params = func.params;

  const promises = (params || []).map(param => resolveType(param.typeAnnotation.typeAnnotation, fn));

  if (func.returnType) {
    promises.push(resolveType(func.returnType.typeAnnotation, fn));
  }
  return Promise.all(promises).then((types) => {
    
    const {path, method} = getObjectFromAst(expressionStatement.expression.callee.arguments[0].properties);

    const swaggerParams = params.map((param, paramI) => {
      const paramType = types[paramI];
      const paramObj: SwaggerParam =  {
        name: param.name,
        in: mapHTTPTypeToSwaggerIn(param.typeAnnotation.typeAnnotation.id.name),
        required: param.typeAnnotation.typeAnnotation.type !== 'NullableTypeAnnotation'
      };
      if (typeof paramType === 'object') {
        paramObj.schema = paramType;
      } else {
        paramObj.type = paramType;
      }
      return paramObj;
    });
    const produces = mapHTTPTypeToContentType(func.returnType.typeAnnotation.id.name);

    buildSwagger(path, method, swaggerParams, types[types.length - 1], produces);
  }).then(() => {
    return persistAPI();
  }).then(() => {
    console.log('API: http://localhost:3000/ui/dist/');
    return swagger;
  });
}

/**
 * Route is:
 * 1. root expression currying call
 * 2. where callee is CallExpression with 2 arguments (for HTTP method and path)
 * 3. and with 1 calling argument - arrow function (which is controller basically)
 * 4. arrow function should have any number of HTTP types (QueryString, Headers etc.) and HTTP returned type
 */
function findServiceTypes(ast: AST, fn: string) {
  const promises = (ast.body || [])
  .filter(root => root.type === 'ExpressionStatement')
  .map(expressionStatement => {
    if (isExpressionHTTPRoute(expressionStatement)) {
      return handleSwagger(expressionStatement, fn);
    } else if (isExpressionGraphQLRoute(expressionStatement)) {
      return handleGraphQL(expressionStatement, fn);
    } else {
      console.log(`No routes`);
      Promise.resolve();
    }
  });
  return Promise.all(promises);
}

function buildSwagger(path, method, args, responseType, produces) {
  if (!path) throw new Error('No path provided for swagger');
  if (!method) throw new Error('No method provided for swagger');
  // @TODO check + support multiple args

  path = getSwaggerPathFromExpress(path);

  if (!swagger.paths[path]) {
    swagger.paths[path] = {};
  }
  if (!swagger.paths[path][method]) {
    swagger.paths[path][method] = {};
  }
  swagger.paths[path][method].produces = [produces];
  swagger.paths[path][method].consumes = [produces];
  if (args) {
    swagger.paths[path][method].parameters = args;
  }
  if (responseType) {
    const respType = typeof responseType === 'object' ? {schema: responseType} : {type: responseType};
    respType.description = `${method} ${path}`;
    swagger.paths[path][method].responses = {
      200: respType
    };
  }
}

module.exports = {
  analyzeFile,
  findServiceTypes,
  getAstByCode,
  analyzeFolder
};