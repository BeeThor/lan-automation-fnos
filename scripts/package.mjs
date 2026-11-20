import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'build');
const bundle = join(output, 'web');
await readFile(join(bundle, 'index.html'));
const stage = await mkdtemp(join(output, 'fpk-'));
const layout = join(stage, 'lan-automation');
try {
  await cp(join(root, 'package'), layout, { recursive: true });
  // fnpack requires these callbacks even when installation needs no extra work.
  for (const phase of ['install', 'uninstall', 'upgrade', 'config']) {
    for (const step of ['init', 'callback']) {
      await writeFile(join(layout, 'cmd', `${phase}_${step}`), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
  }
  const lifecycle = join(layout, 'cmd/main');
  await writeFile(lifecycle, (await readFile(lifecycle, 'utf8')).replace(/\r\n/g, '\n'));
  await chmod(lifecycle, 0o755);
  await mkdir(join(layout, 'app/ui/images'), { recursive: true });
  for (const [size, icon] of [[64, 'ICON.PNG'], [256, 'ICON_256.PNG']]) {
    await copyFile(join(layout, icon), join(layout, `app/ui/images/icon_${size}.png`));
  }
  const runtime = join(layout, 'app/server');
  await cp(join(root, 'server'), runtime, { recursive: true });
  await copyFile(join(root, 'LICENSE'), join(runtime, 'LICENSE'));
  await cp(join(root, 'calendar'), join(runtime, 'calendar'), { recursive: true });
  await cp(bundle, join(runtime, 'web'), { recursive: true });
  const executable = process.env.FNPACK || 'fnpack';
  const help = spawnSync(executable, ['build', '--help'], { encoding: 'utf8' });
  if (help.error) throw help.error;
  if (help.status !== 0) throw new Error('Could not read fnpack build options');
  const flags = help.stdout.includes('--nosign') ? ['--nosign'] : [];
  const result = spawnSync(executable, ['build', '--directory', layout, ...flags], {
    cwd: stage, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('fnpack build failed');
  const candidates = [(await readdir(stage)).map(name => join(stage, name)),
    (await readdir(layout)).map(name => join(layout, name))].flat();
  const fpk = candidates.find(path => path.endsWith('.fpk'));
  if (!fpk) throw new Error('fnpack did not produce an installation package');
  if (process.platform === 'win32') {
    const permissions = spawnSync('python', [join(root, 'scripts/fpk-modes.py'), fpk], { stdio: 'inherit' });
    if (permissions.error) throw permissions.error;
    if (permissions.status !== 0) throw new Error('Unable to set Linux package permissions');
  }
  const finalPath = join(output, basename(fpk));
  await copyFile(fpk, finalPath);
  console.info(finalPath);
} finally {
  await rm(stage, { recursive: true, force: true });
}
