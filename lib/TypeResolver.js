const babylon = require('babylon');
const res = babylon.parse(`
type A = {a: string, b: number}
`, {plugins: [
    "flow"
  ]});
console.log(res);
module.exports = (fn, line, col) => {

}