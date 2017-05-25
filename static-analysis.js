const babylon = require('babylon');

const AnnotationTypes = ['Headers', 'Body', 'QueryString', 'Path'];

module.exports = function (babel) {
  const {types: t, template, parse} = babel;
  return {
    visitor: {
      TypeAnnotation: function TypeAnnotation(path, state) {
        //console.log(path.node.typeAnnotation);
        if (path.node.typeAnnotation.type === 'GenericTypeAnnotation') {
          if (AnnotationTypes.includes(path.node.typeAnnotation.id.name)) {
            console.log(path.node.parent);
            //const route = getRoute();
          }
        }
      },
      CallExpression: (path, state) => {
        if (path.node.arguments && path.node.arguments.length === 1 && path.node.arguments[0].type === 'ArrowFunctionExpression') {
          const func = path.node.arguments[0];
          let method, endpoint;
          if (path.node.callee && path.node.callee.arguments) {
            method = path.node.callee.arguments[0].value;
            endpoint = path.node.callee.arguments[1].value;
          }
          const params = func.params;
          params.forEach(param => {
            const argName = param.typeAnnotation.name;
            if (param.typeAnnotation && param.typeAnnotation.typeAnnotation && param.typeAnnotation.typeAnnotation.type === 'GenericTypeAnnotation' && AnnotationTypes.includes(param.typeAnnotation.typeAnnotation.id.name)) {
              const retrieveMethod = param.typeAnnotation.typeAnnotation.id.name;
            }
          });
        }
      }
    }
  };
}