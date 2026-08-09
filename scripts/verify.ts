import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface VerifyStep {
  readonly label: string;
  readonly command: readonly string[];
  readonly cwd: string;
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const exampleDir = join(projectRoot, 'examples', '13-multi-agent-workflows');

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

async function runStep(step: VerifyStep): Promise<void> {
  console.log(`\n==> ${step.label}`);
  const proc = Bun.spawn({
    cmd: [...step.command],
    cwd: step.cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${step.label} failed with exit code ${exitCode}`);
  }
}

function buildSteps(): VerifyStep[] {
  if (hasFlag('--smoke-only')) {
    return [{ label: 'example smoke', command: ['bun', 'run', 'smoke'], cwd: exampleDir }];
  }

  if (hasFlag('--e2e-only')) {
    return [{ label: 'example live e2e', command: ['bun', 'run', 'e2e'], cwd: exampleDir }];
  }

  const steps: VerifyStep[] = [
    { label: 'typecheck', command: ['bunx', 'tsc', '--noEmit'], cwd: projectRoot },
    { label: 'build package declarations', command: ['bash', 'scripts/build-declarations.sh'], cwd: projectRoot },
    { label: 'test suite', command: ['bun', 'run', 'test'], cwd: projectRoot },
    { label: 'build workspace packages', command: ['bun', 'run', 'build'], cwd: projectRoot },
    { label: 'example smoke', command: ['bun', 'run', 'smoke'], cwd: exampleDir },
  ];

  if (hasFlag('--live')) {
    steps.push({ label: 'example live e2e', command: ['bun', 'run', 'e2e'], cwd: exampleDir });
  }

  return steps;
}

async function main(): Promise<void> {
  for (const step of buildSteps()) {
    await runStep(step);
  }
}

main().catch((error) => {
  console.error('Verification failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
