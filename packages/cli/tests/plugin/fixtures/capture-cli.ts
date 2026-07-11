import { writeFile } from 'node:fs/promises';

const [stdoutPath, stderrPath, cwd, command, ...args] = process.argv.slice(2);

if (!stdoutPath || !stderrPath || !cwd || !command) {
  process.exit(2);
}

const child = Bun.spawn([command, ...args], {
  cwd,
  env: process.env,
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'pipe',
});
const [status, stdout, stderr] = await Promise.all([
  child.exited,
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
]);

await Promise.all([
  writeFile(stdoutPath, stdout),
  writeFile(stderrPath, stderr),
]);
process.exit(status);
