import { readFileSync } from 'node:fs';

/** Parse the hook JSON from stdin. Returns null if it can't be parsed. */
export function readHookInput<T>(): T | null {
  try {
    return JSON.parse(readFileSync(0, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Exit code 2 = block; stderr is fed back to Claude. */
export function block(reason: string): never {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

export const projectDir = (): string => process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Windows-safe: backslashes to forward slashes. */
export const norm = (p: string): string => p.replace(/\\/g, '/');
