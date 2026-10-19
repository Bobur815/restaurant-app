// PostToolUse (Edit | Write | MultiEdit): run the repo's Prettier on an edited
// src/**/*.{ts,css,html,json} file, like `npm run format`. Never fails the turn.
// The whole of src/ is Prettier-clean (format:check), so formatting never rewrites unrelated code.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { norm, projectDir, readHookInput } from './_lib.ts';

interface Input {
  tool_input?: { file_path?: string };
}

const input = readHookInput<Input>();
const file = norm(input?.tool_input?.file_path ?? '');
const root = norm(projectDir());

const inSrc = file.toLowerCase().startsWith(root.toLowerCase() + '/src/');
const wanted = /\.(ts|css|html|json)$/.test(file) && !/\/src\/generated\//.test(file);
if (!inSrc || !wanted || !existsSync(file)) process.exit(0);

const bin = join(projectDir(), 'node_modules', 'prettier', 'bin', 'prettier.cjs');
if (!existsSync(bin)) process.exit(0);

spawnSync(process.execPath, [bin, '--write', file], { cwd: projectDir(), stdio: 'ignore' });
process.exit(0);
