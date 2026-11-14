import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const name of ['combat','range','inventory','skills','extra-monsters','ground-items','deerclops','audio','render']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`test-${name}.mjs`, import.meta.url))], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
