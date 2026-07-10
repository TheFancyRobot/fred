import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const requirementsPath = join(root, 'docs', 'requirements.txt');
const venvPath = join(root, '.venv', 'docs');
const venvPython = process.platform === 'win32'
  ? join(venvPath, 'Scripts', 'python.exe')
  : join(venvPath, 'bin', 'python');
const stampPath = join(venvPath, '.requirements.sha256');
const command = process.argv[2] ?? 'build';
const allowedCommands = new Set(['build', 'serve', 'gh-deploy']);

if (!allowedCommands.has(command)) {
  console.error(`Unknown docs command: ${command}`);
  process.exit(2);
}

const run = (argv: readonly string[]): number => {
  const child = Bun.spawnSync([...argv], {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return child.exitCode;
};

const findPython = (): string => {
  for (const candidate of process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python']) {
    const result = Bun.spawnSync([candidate, '--version'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if (result.exitCode === 0) return candidate;
  }
  console.error('Python 3 is required to build the documentation.');
  process.exit(127);
};

if (!existsSync(venvPython)) {
  mkdirSync(dirname(venvPath), { recursive: true });
  const exitCode = run([findPython(), '-m', 'venv', venvPath]);
  if (exitCode !== 0) process.exit(exitCode);
}

const requirements = readFileSync(requirementsPath);
const requirementsHash = createHash('sha256').update(requirements).digest('hex');
const installedHash = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : '';

if (requirementsHash !== installedHash) {
  const exitCode = run([
    venvPython,
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '-r',
    requirementsPath,
  ]);
  if (exitCode !== 0) process.exit(exitCode);
  writeFileSync(stampPath, `${requirementsHash}\n`);
}

process.exit(run([venvPython, '-m', 'mkdocs', command]));
