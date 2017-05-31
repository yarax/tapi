// @flow
import express from 'express';
import {getSwaggerPathFromExpress} from './helpers';
import tv4 from 'tv4';
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());
app.use(express.static(`${__dirname}/../../swagger/`));
app.use((err, req, res, next) => {
  const code =  err.statusCode || 500;
  res.status(code).send(err.message);
  console.log(err);
  next();
});

type RouteOptions = {
  method: string,
  path: string
}
// move to config
const basePath = '/v1';

function validate(val, type) {
  const res = tv4.validateResult(val, type);
  //console.log(val, type, res);
  if (res.error) {
    const err = new Error(res.error.message);
    err.statusCode = 400;
    throw err;
  }
  return val;
}

function getArgsFromReq(req, method, path) {
  const swaggerPath = getSwaggerPathFromExpress(path);
  const swagger = require('../../swagger/swagger.json');
  const endpoint = swagger.paths[swaggerPath] && swagger.paths[swaggerPath][method];
  if (!endpoint) {
    const err = new Error(`Endpoint ${method} ${swaggerPath} was not found`);
    err.statusCode = 404;
    throw err;
  }
  return endpoint.parameters.map(param => {
    const paramType = param.type || param.schema;
    // @TODO remove crap
    if (typeof paramType === 'object' && !paramType.type) {
      paramType.type = 'object';
    }
    if (param.in === 'query') return validate(req.query[param.name], paramType);
    if (param.in === 'header') return validate(req.get(param.name), paramType);
    if (param.in === 'path') return validate(req.param(param.name), paramType);
    if (param.in === 'body') return validate(req.body, paramType);
    throw new Error(`Swagger ${param.in} parameters is not supported yet`);
  });
}

export const route = (options: RouteOptions) => {
  // create swagger endpoint
  let {method, path} = options;
  method = method.toLowerCase();
  const listenPath = `${basePath}${path}`;
  return (func) => {
    console.log('Bound route', method, path);
    app[method](listenPath, (req, res, next) => {
      const args = getArgsFromReq(req, method, path);
      //validateArguments(method, path, args);
      // composition / triggers etc
      const result = func.apply(func, args);
      //setHeaders(method, path, res);
      res.send(result);
    });
  }
}

export const run = () => {
  // move to config
  app.listen(3000, () => {
    console.log('http://localhost:3000/');
  });
}