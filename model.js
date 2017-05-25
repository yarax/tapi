// @flow

class Model {
  constructor(modelName, obj) {
    validate(modelName, obj);
    Object.keys(obj).forEach(key => {
      if (!key) return;
      /* $FlowIssue - flow doesn't support indexable signature for class declarations  */
      this[key] = obj[key];
    });
  }
  
}

// This class should be converted to JSON Schema for:
// 1. Swagger definitions
// 2. Runtime validation
class A extends Model {
  foo: string;
  bar: number;
  constructor(obj: $Shape<A>) {
 	  super('A', obj);
  }
}

const a = new A({foo: 123, bar: 123}); // error
