// @flow
import type {Resp} from './test.js';
import type {User} from './test.js';
type Headers<T> = T;
type JSONResp<T> = T;
type QueryString<T> = T;

function route(method, path) {
  // create swagger endpoint
  return (func) => {
    app[method](path, (req, res, next) => {
      const args = getArgsFromReq(req, method, path);
      validateArguments(method, path, args);
      // composition / triggers etc
      const result = func.apply(func, args);
      setHeaders(method, path, res);
      res.send(result);
    });

  }
}

// static analysis takes params for endpoint here
// + GraphQL
type User = {name: string}
route({method: 'POST', path: '/track'})((token: Headers<string>, event: QueryString<string>): JSONResp<Resp<User>> => {
  return {error: false, data: {name: 'fucker'}}
})