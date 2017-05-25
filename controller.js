// @flow

type Headers<T> = T;
type QS<T> = T;

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
route('POST', '/track')((token: Headers<string>, event: QS<string>): JSONResp<{}> => {

})