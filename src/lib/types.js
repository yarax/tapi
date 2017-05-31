// @flow

export type Headers<T> = T;
export type JSONResp<T> = T;
export type QueryString<T> = T;
export type JSONBody<T> = T;
export type Path<T> = T;
export type HTTPRouteOptions = {
  method: string,
  path: string
}
export type GraphQLResolverOptions = {
  typeName: string
}