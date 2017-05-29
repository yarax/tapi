const babylon = require('babylon');
const AnnotationTypes = ['Headers', 'Body', 'QueryString', 'Path'];
const exec = require('child_process').exec;
const fs = require('fs');
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

function resolveType(ast, fn) {
  const cmd = `flow get-def ${fn} ${ast.loc.start.line} ${ast.loc.start.column}`;
  console.log(cmd);
  exec(cmd, (err, stdout, stderr) => {
    console.log(stdout);
  });
}

// back compatable with babel plugin
function callExpression (path, state) {
  const func = path.node.arguments[0];
  let method, endpoint, contentType, returnedType;
  if (path.node.callee && path.node.callee.arguments) {
    method = path.node.callee.arguments[0].value;
    endpoint = path.node.callee.arguments[1].value;
  }
  const params = func.params;
  const returned = func.returnType;
  if (returned && returned.typeAnnotation && returned.type === 'TypeAnnotation') {
    contentType = returned.typeAnnotation.id.name;
    if (returned.typeAnnotation.typeParameters && returned.typeAnnotation.typeParameters.params) {
      returnedType = returned.typeAnnotation.typeParameters.params[0];
      resolveType(returnedType, state.file.opts.filename);
    }

  }
  const args = [];
  params.forEach(param => {
    const argName = param.typeAnnotation.name;
    if (param.typeAnnotation && param.typeAnnotation.typeAnnotation && param.typeAnnotation.typeAnnotation.type === 'GenericTypeAnnotation' && AnnotationTypes.includes(param.typeAnnotation.typeAnnotation.id.name)) {
      const retrieveMethod = param.typeAnnotation.typeAnnotation.id.name;
      // @TODO type of argument
      args.push({
        name: argName,
        in: retrieveMethod
      });
    }
  });
  buildSwagger(path, method, args);
}

function handleFile(fn) {
  const source = fs.readFileSync(fn).toString();
  const ast =  babylon.parse(source, {sourceType: 'module', plugins: ['flow']});
  return findServiceTypes(ast.program, fn);
}


/**
 * Route is:
 * 1. root expression currying call
 * 2. where callee is CallExpression with 2 arguments (for HTTP method and path)
 * 3. and with 1 calling argument - arrow function (which is controller basically)
 * 4. arrow function should have any number of HTTP types (QueryString, Headers etc.) and HTTP returned type
 */
function findServiceTypes(ast, fn) {
  (ast.body || [])
  .filter(root => root.type === 'ExpressionStatement')
  .forEach(expressionStatement => {
    if (expressionStatement.expression && 
    expressionStatement.expression.type === 'CallExpression' &&
    expressionStatement.expression.arguments && 
    expressionStatement.expression.arguments.length === 1 && 
    expressionStatement.expression.arguments[0].type === 'ArrowFunctionExpression') {
      //console.log(expressionStatement.expression.callee.callee.name);
      return callExpression({node: expressionStatement.expression}, {
        file: {
          opts: {
            filename: fn
          }
        }
      });
    } else {
      console.log(`No routes`);
    }
  });
}

module.exports = {
  handleFile,
  findServiceTypes
}