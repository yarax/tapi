// @flow

import type {Headers, Path, JSONResp, JSONBody} from '../src/lib/types';
import type {Pet} from '../model.js';
import {HTTPRoute, GraphQLResolver} from '../src/lib/app';

type Resp<T> = {
  success: boolean,
  data: T
};

// static analysis takes params for endpoint here
// + GraphQL
HTTPRoute({method: 'GET', path: '/pet/:id'})((id: Path<number>, token: Headers<string>): JSONResp<Resp<Pet>> => {
  const pet = {name: 'Bob', id: 12};
  return {success: true, data: pet}
});

HTTPRoute({method: 'POST', path: '/pets'})((pet: JSONBody<Pet>): JSONResp<Resp<Pet>> => {
  return {success: true, data: pet}
});

GraphQLResolver({typeName: 'pet'})((id: number): Pet => {
  return {name: 'Bob', id: 12};
});