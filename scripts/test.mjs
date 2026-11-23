import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src', 'server');
const destination = join(root, 'work', 'test-build');
await mkdir(destination, { recursive: true });
async function compile(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) { await compile(path); continue; }
    if (!item.name.endsWith('.ts')) continue;
    const output = ts.transpileModule(await readFile(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: path,
    }).outputText.replace(/(from\s+['"]|import\s*['"])(\.[^'"]+)(['"])/g, (_match, before, name, after) => `${before}${name.replace(/\.ts$/, '').replace(/(?<!\.mjs)$/, '.mjs')}${after}`);
    const target = join(destination, relative(source, path)).replace(/\.ts$/, '.mjs');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, output);
  }
}
await compile(source);
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(2), 'tests/integration.test.mjs'], { cwd: root, stdio: 'inherit' });
process.exitCode = run.status ?? 1;
