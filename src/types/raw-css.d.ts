/**
 * Ambient declarations for reading stylesheet content in tests (see
 * src/components/Header.test.tsx). The project runs without @types/node, so
 * declare just the node:fs surface the test uses. At runtime Vitest executes
 * in Node, where these resolve normally.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}
