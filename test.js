// @flow
export type Resp<T> = {
  error: boolean,
  data: T
};

export type User = {
  name: string
}