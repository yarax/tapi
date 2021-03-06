# Typed* Node.js API development

This is not the finished framework or tool, this is a proof of concept for following ideas in Node.js development:

* Controllers must be typed. It allows to cover with types all further code.
* API endpoint must be described only once (single source of truth, DRY)
* API must have UI and documentation
* Data must be validated automatically in runtime before getting to controller according endpoint description.
* API can be any type or format (REST, GraphQL, RPC etc.) and not be coupled with business logic

The main idea of current implementation is generating API from AST during covering controller with types.
It allows to maintain all points mentioned above and keep development really fast.

## Usage

`controllers/controller.js`

## Run

```
npm i
babel-node app.js
```

## Troubleshooting

Implementation uses Flow AST and `flow get-def` to resolve Flow types. `get-def` can work inproperly or unexpected in some cases/machines/OS

\* Here and further it means using type checkers like TypeScript or Flow
