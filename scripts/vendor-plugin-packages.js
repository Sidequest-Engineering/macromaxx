import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destination = path.join(root, 'vendor/plugin-packages');
await fs.mkdir(destination, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'macromaxx-vendor-'));
try {
  for (const name of ['sdk', 'runtime']) {
    const source = path.join(root, `../macromaxx-plugin-${name}`), stage = path.join(temp, name);
    await fs.mkdir(stage);
    await fs.cp(path.join(source, 'src'), path.join(stage, 'src'), { recursive: true });
    const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json')));
    if (name === 'runtime') pkg.dependencies['@macromaxx/plugin-sdk'] = '0.1.0';
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2));
    try { await fs.copyFile(path.join(source, 'README.md'), path.join(stage, 'README.md')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (name === 'sdk') await fs.chmod(path.join(stage, 'src/cli.js'), 0o755);
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--pack-destination', destination], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
    const archive = `macromaxx-plugin-${name}-0.1.0.tgz`;
    for (const project of name === 'sdk' ? ['registry', 'example'] : ['example']) {
      const vendor = path.join(root, `../macromaxx-plugin-${project}/vendor`);
      await fs.mkdir(vendor, { recursive: true });
      await fs.copyFile(path.join(destination, archive), path.join(vendor, archive));
    }
  }
} finally { await fs.rm(temp, { recursive: true, force: true }); }
