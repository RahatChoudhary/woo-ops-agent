// Must be the first import in src/index.ts.
// In a stdio MCP server, stdout carries protocol messages only. Anything else written
// there (a stray console.log from us or a dependency) corrupts the stream, so route
// every console method that writes to stdout to stderr instead.
const toStderr = (...args: unknown[]) => console.error(...args);

console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.dir = toStderr;
console.table = toStderr;

export {};
