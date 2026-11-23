import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const config = resolve('dist/server/wrangler.json');
if (!existsSync(config)) {
  console.error('Build first with npm run build, then run npm run db:migrate.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync('.openai/hosting.json', 'utf8'));
if (!manifest.d1) throw new Error('The hosting manifest must declare a D1 binding.');
const migrationConfig = JSON.parse(readFileSync(config, 'utf8'));
for (const binding of migrationConfig.d1_databases ?? []) {
  binding.migrations_dir = resolve('drizzle');
}
migrationConfig.main = resolve('dist/server/index.js');
if (migrationConfig.assets) migrationConfig.assets.directory = resolve('dist/client');
mkdirSync('.sites-runtime', { recursive: true });
const migrationConfigPath = resolve('.sites-runtime/local-migrations.json');
writeFileSync(migrationConfigPath, JSON.stringify(migrationConfig, null, 2));
const result = spawnSync(process.execPath, [
  '--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js',
  'd1', 'migrations', 'apply', manifest.d1, '--local', '--config', migrationConfigPath,
  '--persist-to', '.wrangler/state',
], { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
process.exit(result.status ?? 1);
