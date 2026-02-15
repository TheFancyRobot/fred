export {};

const PHASE_ID = "35-cross-phase-smoke-contract-refresh";
const EVIDENCE_PATH = ".planning/phases/35-cross-phase-smoke-contract-refresh/35-smoke-evidence.json";

type SmokeChannel = "OK" | "STALE_CONTRACT" | "SMOKE_FAILURE";

type SmokeCheck = {
  id: string;
  label: string;
  command: string;
};

type SmokeResult = {
  id: string;
  label: string;
  command: string;
  exitCode: number;
  decisiveLines: string[];
  channel: SmokeChannel;
};

const TEST_PATHS = {
  phase27: "tests/unit/cli/phase27-smoke.test.ts",
  phase28: "tests/unit/cli/phase28-streaming-smoke.test.ts",
  phase33: "tests/unit/cli/phase33-launch-contract-smoke.test.ts",
  phase29Tui: "tests/unit/cli/tui/session-state.test.ts",
  phase29Cli: "tests/unit/cli/session-commands.test.ts",
};

const CHECKS: SmokeCheck[] = [
  {
    id: "phase27-smoke",
    label: "Phase 27 launch parity smoke",
    command: `bun test ${TEST_PATHS.phase27}`,
  },
  {
    id: "phase28-streaming-smoke",
    label: "Phase 28 streaming smoke",
    command: `bun test ${TEST_PATHS.phase28}`,
  },
  {
    id: "phase33-launch-contract-smoke",
    label: "Phase 33 launch contract smoke",
    command: `bun test ${TEST_PATHS.phase33}`,
  },
  {
    id: "session-state",
    label: "Phase 29 TUI session state smoke",
    command: `bun test ${TEST_PATHS.phase29Tui}`,
  },
  {
    id: "session-commands",
    label: "Phase 29 session CLI smoke",
    command: `bun test ${TEST_PATHS.phase29Cli}`,
  },
  {
    id: "phase35-rollup",
    label: "Integrated cross-phase rollup",
    command:
      `bun test ${TEST_PATHS.phase27} ${TEST_PATHS.phase28} ${TEST_PATHS.phase33} ${TEST_PATHS.phase29Tui} ${TEST_PATHS.phase29Cli}`,
  },
];

const STALE_CONTRACT_PATTERNS = [
  "getcontextmanager is not a function",
  "sqlitcontextstorage",
  "sqlitecontextstorage",
  "cannot find export 'sqlitecontextstorage'",
  "does not provide an export named 'sqlitecontextstorage'",
  "stale_contract",
];

function runCommand(command: string): { exitCode: number; output: string } {
  const proc = Bun.spawnSync({
    cmd: ["bash", "-lc", command],
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  const stdout = decoder.decode(proc.stdout);
  const stderr = decoder.decode(proc.stderr);
  const exitCode = proc.exitCode ?? 1;

  return {
    exitCode,
    output: `${stdout}${stderr}`,
  };
}

function isStaleContract(output: string): boolean {
  const haystack = output.toLowerCase();
  return STALE_CONTRACT_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function classifyChannel(exitCode: number, output: string): SmokeChannel {
  if (exitCode === 0) {
    return "OK";
  }
  return isStaleContract(output) ? "STALE_CONTRACT" : "SMOKE_FAILURE";
}

function extractDecisiveLines(output: string, exitCode: number): string[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const scoreLine = (line: string): number => {
    const lower = line.toLowerCase();
    if (lower.includes("stale_contract")) return 100;
    if (lower.includes("getcontextmanager")) return 95;
    if (lower.includes("sqlitecontextstorage")) return 90;
    if (lower.includes("error") || lower.includes("typeerror") || lower.includes("referenceerror")) return 80;
    if (lower.includes("fail") || lower.includes("failed")) return 70;
    if (lower.match(/(^|\s)pass(\s|$)/)) return 60;
    if (lower.includes("ran") || lower.includes("tests")) return 50;
    return 0;
  };

  const topLines = lines
    .map((line) => ({ line, score: scoreLine(line) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((entry) => entry.line);

  const uniqueLines = Array.from(new Set(topLines));
  if (uniqueLines.length > 0) {
    return uniqueLines;
  }

  return [`command exited with code ${exitCode}`];
}

function remediationHint(channel: SmokeChannel): string {
  if (channel === "STALE_CONTRACT") {
    return "Align @fancyrobot/fred smoke mocks with tests/unit/cli/fixtures/fred-smoke-contract.ts (verify getContextManager and SqliteContextStorage exports).";
  }
  if (channel === "SMOKE_FAILURE") {
    return "Inspect decisive lines and rerun the failing command locally for detailed diagnostics.";
  }
  return "No action required.";
}

const results: SmokeResult[] = [];

for (const check of CHECKS) {
  const run = runCommand(check.command);
  const channel = classifyChannel(run.exitCode, run.output);
  const decisiveLines = extractDecisiveLines(run.output, run.exitCode);

  results.push({
    id: check.id,
    label: check.label,
    command: check.command,
    exitCode: run.exitCode,
    decisiveLines,
    channel,
  });

  const statusIcon = run.exitCode === 0 ? "OK" : "FAIL";
  console.log(`[phase35-smoke] ${statusIcon} ${check.id} (exit=${run.exitCode}, channel=${channel})`);
}

const overallExitCode = results.every((result) => result.exitCode === 0) ? 0 : 1;
const gateStatus = overallExitCode === 0 ? "passed" : "failed";
const channels = Array.from(new Set(results.map((result) => result.channel)));

const payload = {
  phase: PHASE_ID,
  status: gateStatus,
  overallExitCode,
  channels,
  linkage: {
    phase27: {
      suite: TEST_PATHS.phase27,
      check: "phase27-smoke",
    },
    phase28: {
      suite: TEST_PATHS.phase28,
      check: "phase28-streaming-smoke",
    },
    phase29_tui: {
      suite: TEST_PATHS.phase29Tui,
      check: "session-state",
      covers: ["SESS-01", "SESS-02", "SESS-03"],
    },
    phase29_cli: {
      suite: TEST_PATHS.phase29Cli,
      check: "session-commands",
      covers: ["SESS-04", "SESS-05", "SESS-06", "SESS-07"],
    },
    phase33: {
      suite: TEST_PATHS.phase33,
      check: "phase33-launch-contract-smoke",
    },
    rollup: {
      check: "phase35-rollup",
    },
  },
  checks: results,
};

await Bun.write(EVIDENCE_PATH, `${JSON.stringify(payload, null, 2)}\n`);

if (overallExitCode === 0) {
  console.log(`[phase35-smoke] PASS (${results.length}/${results.length}) consolidated checks`);
} else {
  console.error("[phase35-smoke] FAIL consolidated smoke gate");
  for (const result of results.filter((entry) => entry.exitCode !== 0)) {
    console.error(
      `[phase35-smoke] ${result.id} -> ${result.channel} | hint: ${remediationHint(result.channel)}`
    );
  }
}

console.log(`[phase35-smoke] evidence written to ${EVIDENCE_PATH}`);

process.exit(overallExitCode);
