import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = fileURLToPath(
  new URL('../node_modules/typescript/bin/tsc', import.meta.url),
);
rmSync(new URL('../lib/', import.meta.url), { recursive: true, force: true });
for (const [module, moduleResolution, outDir] of [
  ['ES2022', 'Bundler', 'lib/module'],
  ['Node16', 'Node16', 'lib/commonjs'],
]) {
  execFileSync(
    process.execPath,
    [
      compiler,
      '-p',
      'tsconfig.build.json',
      '--module',
      module,
      '--moduleResolution',
      moduleResolution,
      '--outDir',
      outDir,
    ],
    { cwd: root, stdio: 'inherit' },
  );
}
execFileSync(
  process.execPath,
  [
    compiler,
    '-p',
    'tsconfig.build.json',
    '--declaration',
    '--emitDeclarationOnly',
    '--outDir',
    'lib/typescript',
  ],
  { cwd: root, stdio: 'inherit' },
);
writeFileSync(
  new URL('../lib/module/package.json', import.meta.url),
  '{"type":"module"}\n',
);
