// @flow

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

type AST = {body: Array<any>}

const babylon = require('babylon');
const HTTPServiceAnnotationTypes = ['Headers', 'Body', 'QueryString', 'Path', 'JSONResp'];
const Promise = require('bluebird');
const exec = Promise.promisify(require('child_process').exec);
const fs = Promise.promisifyAll(require('fs'));
const swagger = {
  paths: {},
  definitions: {}
}

function buildSwagger(path, method, args) {
  if (!swagger[path]) {
    swagger[path] = {};
  }
  if (!swagger[path][method]) {
    swagger[path][method] = {};
  }
  if (args) {
    swagger[path][method].parameters = args;
  }
}

function flowGetDef(fn, loc: Location, typeName) {
  const line = loc.start.line;
  const cmd = `flow get-def ${fn} ${loc.start.line} ${loc.start.column}`;
  console.log(cmd);
  const reg = new RegExp(/(.*?):([0-9]+):([0-9]+),([0-9]+):([0-9]+)/);
  return exec(cmd).then((stdout, stderr) => {
    if (stderr) {
      throw new Error(stderr);
    }
    const m = stdout.trim().match(reg);
    if (!m) {
      throw new Error(`Cannot resolve type ${typeName} in ${fn}:${loc.start.line}:${col}. STDOUT: ${stdout.trim()}`);
    }
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

function getCodeFromLocation(location: {filename: string, loc: Location}) {
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

function getAstByCode(source: string, type: 'flowType' | 'js'):AST {
  try {
    return babylon.parse(source, {sourceType: 'module', plugins: ['flow']}).program;
  } catch (e) {
    // Super mega crappy hack. Get rid of it as soon as possible
    if (type === 'flowType' && !/^type/.test(source)) {
      return getAstByCode(`type ${source}`, type);
    }
    throw new Error(`Failed to parse ${source}: ${e}`);
  }
}

function handleFile(fn: string) {
  return fs.readFileAsync(fn).then(source => {
    const ast = getAstByCode(source.toString(), 'js');
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

function getObjectJSONSchema(ast, args) {
  if (ast.body.length > 1) throw new Error('Body laneth of type def > 1');
  let body;
  if (ast.body[0].declaration) {
    body = ast.body[0].declaration;
  } else {
    body = ast.body[0];
  }
  if (body.type === 'TypeAlias') {
    const typeName = body.id.name;
    // Generic service types just return it's argument
    if (HTTPServiceAnnotationTypes.includes(typeName)) {
      return args[0];
    }
    const params = getArgsByName(body, args);
    if (!body.right || !body.right.properties) {
      throw new Error(`Don't know how to handle type definition ${body.id.name}`);
    }
    // @TODO nesting objects
    return body.right.properties.reduce((prev, prop) => {
      let propType = prop.value.type === 'GenericTypeAnnotation' ? params[prop.value.id.name] : prop.value.type;
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
  } else {
    throw new Error(`Type declaration ${body.type} is not supported`);
  }
}


function resolveObjectWithArgs(type, promisedArgs, fn) {
  return promisedArgs.then(args => {
    //console.log('RESOLVED ARGS', args);
    const loc = Object.assign({}, type.loc);
    loc.start.column++; // no idea why, but must be so
    const typeName = (type.id && type.id.name) || type.type;

    return flowGetDef(fn, type.loc, typeName).then(location => {
      return getCodeFromLocation(location)
    }).then(code => {
      return getAstByCode(code, 'flowType')
    }).then((ast) => {
      return getObjectJSONSchema(ast, args)
    });
  });
}

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
    if (expressionStatement.expression && 
    expressionStatement.expression.type === 'CallExpression' &&
    expressionStatement.expression.arguments && 
    expressionStatement.expression.arguments.length === 1 && 
    expressionStatement.expression.arguments[0].type === 'ArrowFunctionExpression') {
      // @TODO check Headers, QueryString etc type before
      const func = expressionStatement.expression.arguments[0];
      const params = func.params;

      const promises = (params || []).map(param => resolveType(param.typeAnnotation.typeAnnotation, fn));

      if (func.returnType) {
        promises.push(resolveType(func.returnType.typeAnnotation, fn));
      }

      return Promise.all(promises);

    } else {
      console.log(`No routes`);
      Promise.resolve();
    }
  });
  return Promise.all(promises);
}

module.exports = {
  handleFile,
  findServiceTypes,
  getAstByCode
};