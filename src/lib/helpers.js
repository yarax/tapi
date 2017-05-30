export function getSwaggerPathFromExpress(expressPath) {
  return expressPath.replace(/:[0-9a-z_]+/g, (m) => {
    return `{${m.replace(':', '')}}`;
  });
}