import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import {
  Fred,
  GraphWorkflowBuilder,
  SessionService,
  compileGraphWorkflow,
  createHandoffTool,
  defineWorkflow,
  type Tool,
} from '@fancyrobot/fred';
import { Effect, Runtime, Schema } from 'effect';
import { appendNotebookEntry, ensureNotebook, queryNotebook } from './notes';
import { fetchLatestNewsDigest } from './news';
import {
  emitTuiProgressComplete,
  emitTuiProgressError,
  emitTuiProgressStart,
  emitTuiTaskComplete,
  emitTuiTaskError,
  emitTuiTaskStart,
} from './tui-progress';
import { runBrowserResearch } from './browser-research';

export const DEFAULT_NOTEBOOK_PATH = fileURLToPath(
  new URL('../data/notebook.md', import.meta.url),
);

export interface SetupExampleOptions {
  configPath?: string;
  notebookPath?: string;
}

export interface DeterministicSmokeResult {
  notebookPreview: string;
  newsDigest: string;
}

export interface ResearchExecutionPlan {
  mode: 'background' | 'decision';
  includeMarketTrack: boolean;
  includeRiskTrack: boolean;
  browserReadTopResults: number;
}

const MAX_PARALLEL_RESEARCH_ANGLES = 2;

const WORKFLOW_PROGRESS_IDS_KEY = '__tuiWorkflowProgressIds';

interface ResearchProgressContext {
  agentId: string;
  parentToolCallId?: string;
  depth?: number;
}

const researchProgressAgentContext = new AsyncLocalStorage<ResearchProgressContext>();

/**
 * Whether the process is running in dev mode (enables verbose error details).
 */
const IS_DEV = process.env.NODE_ENV === 'development' || process.env.FRED_DEBUG === '1';

/**
 * Safe fields that may appear in user-facing error messages.
 * All other fields (command, file paths, stack traces) are suppressed
 * unless running in dev mode.
 */
const SAFE_ERROR_FIELDS = new Set(['subagentId', 'timeoutMs', 'message']);

/** Strip absolute file paths from a string. */
const FILE_PATH_PATTERN = /(?:\/[\w.-]+){2,}|[A-Z]:\\(?:[\w.-]+\\){1,}[\w.-]*/g;

/**
 * Extract a readable error message from an error value.
 *
 * Handles Effect tagged errors (objects with `_tag`), plain Error instances,
 * and arbitrary values.
 *
 * In production mode, only safe fields (agent id, timeout) are included and
 * file paths are stripped. In dev mode (NODE_ENV=development or FRED_DEBUG=1),
 * all fields are shown for debugging.
 */
function extractEffectErrorMessage(error: unknown): string {
  // Tagged Effect error (e.g. SubagentTimeoutError { _tag, subagentId, ... })
  if (error && typeof error === 'object' && '_tag' in error) {
    const tagged = error as Record<string, unknown>;
    const tag = String(tagged._tag);

    if (!IS_DEV) {
      const details: string[] = [];
      for (const key of SAFE_ERROR_FIELDS) {
        const value = tagged[key];
        if (value === undefined || value === null) continue;
        if (typeof value === 'string' && value.length > 80) continue;
        details.push(`${key}=${typeof value === 'string' ? value : String(value)}`);
      }
      return details.length > 0 ? `${tag}: ${details.join(', ')}` : tag;
    }

    const details: string[] = [];
    for (const [key, value] of Object.entries(tagged)) {
      if (key === '_tag') continue;
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && value.length > 100) continue;
      details.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
    return details.length > 0 ? `${tag}: ${details.join(', ')}` : tag;
  }

  // Plain Error instance
  if (error instanceof Error) {
    if (IS_DEV) return error.message;
    return error.message.replace(FILE_PATH_PATTERN, '<path>');
  }

  // Fallback
  if (IS_DEV) return String(error);
  return 'An internal error occurred';
}

function createWorkflowProgressHooks(labels: Record<string, string>, depth: number) {
  return {
    beforeStep: [
      (event: any) => {
        const stepName = String(event.data.step?.name ?? 'workflow-step');
        const progressId = `${stepName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const contextMetadata = (event.data.context.metadata ??= {});
        const progressIds = (contextMetadata[WORKFLOW_PROGRESS_IDS_KEY] ?? {}) as Record<string, string>;
        contextMetadata[WORKFLOW_PROGRESS_IDS_KEY] = {
          ...progressIds,
          [stepName]: progressId,
        };
        emitTuiTaskStart({
          toolCallId: progressId,
          toolName: labels[stepName] ?? stepName,
          input: { stepName },
          depth,
        });
      },
    ],
    afterStep: [
      (event: any) => {
        const stepName = String(event.data.step?.name ?? 'workflow-step');
        const progressIds = ((event.data.context?.metadata ?? {})[WORKFLOW_PROGRESS_IDS_KEY] ?? {}) as Record<string, string>;
        const progressId = progressIds[stepName];
        if (!progressId) {
          return;
        }
        emitTuiTaskComplete({
          toolCallId: progressId,
          toolName: labels[stepName] ?? stepName,
          output: 'completed',
        });
      },
    ],
    onStepError: [
      (event: any) => {
        const stepName = String(event.data.step?.name ?? 'workflow-step');
        const progressIds = ((event.data.context?.metadata ?? {})[WORKFLOW_PROGRESS_IDS_KEY] ?? {}) as Record<string, string>;
        const progressId = progressIds[stepName];
        if (!progressId) {
          return;
        }
        emitTuiTaskError({
          toolCallId: progressId,
          toolName: labels[stepName] ?? stepName,
          error: {
            message: extractEffectErrorMessage(event.data.error),
          },
        });
      },
    ],
  };
}

export function normalizeOptionalLimit(limit: number | string | null | undefined): number | undefined {
  if (limit === null || limit === undefined) {
    return undefined;
  }

  const parsed = typeof limit === 'number' ? limit : Number(limit.trim());
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.trunc(parsed);
}

export function normalizeReadTopResults(
  value: number | string | boolean | null | undefined,
): number | undefined {
  if (typeof value === 'boolean') {
    return value ? 3 : 0;
  }

  return normalizeOptionalLimit(value);
}

export function planResearchExecution(question: string): ResearchExecutionPlan {
  const normalized = question.toLowerCase();
  const hasDecisionSignals = /\b(compare|comparison|choose|recommend|recommendation|best|better|vs\.?|versus|option|worth it|should i|tradeoff|which)\b/.test(normalized);
  const hasMarketSignals = /\b(price|pricing|cost|cheap|budget|expensive|plan|subscription|product|service|tool|software|provider|vendor|performance|market|company|stock|fund|etf)\b/.test(normalized);
  const hasRiskSignals = /\b(risk|safe|safety|danger|legal|security|privacy|compliance|side effect|failure|downside|blind spot|harm)\b/.test(normalized);
  const hasBackgroundSignals = /\b(essay|report|summary|overview|history|historical|background|causes?|why did|fall of|rise of|collapse|empire|civilization|war|dynasty|century)\b/.test(normalized);

  const includeMarketTrack = hasDecisionSignals || hasMarketSignals;
  const includeRiskTrack = hasDecisionSignals || hasRiskSignals;
  const mode = includeMarketTrack || includeRiskTrack ? 'decision' : 'background';

  return {
    mode,
    includeMarketTrack,
    includeRiskTrack,
    browserReadTopResults: mode === 'background' || hasBackgroundSignals ? 1 : 2,
  };
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    if ('content' in value) {
      return extractText((value as { content?: unknown }).content);
    }

    if ('finalReport' in value) {
      return extractText((value as { finalReport?: unknown }).finalReport);
    }

    if ('brief' in value) {
      return extractText((value as { brief?: unknown }).brief);
    }

    if ('digest' in value) {
      return extractText((value as { digest?: unknown }).digest);
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).filter(Boolean).join('\n');
  }

  return String(value ?? '');
}

function readOutputField(output: unknown, field: string): string {
  if (!output || typeof output !== 'object' || !(field in output)) {
    return '';
  }

  return extractText((output as Record<string, unknown>)[field]);
}

function getResearchExecutionPlanFromContext(ctx: {
  input: string;
  outputs?: Record<string, unknown>;
}): ResearchExecutionPlan {
  const storedPlan = (ctx.outputs?.planResearch as { executionPlan?: ResearchExecutionPlan } | undefined)?.executionPlan;
  return storedPlan ?? planResearchExecution(ctx.input);
}

function isSkippedFinding(text: string): boolean {
  return text.trim().startsWith('Skipped:');
}

function appendReportSection(lines: string[], heading: string, content: string): void {
  if (!content.trim() || isSkippedFinding(content)) {
    return;
  }

  lines.push(heading, content, '');
}

export function extractResearchAngles(plan: string, maxAngles = MAX_PARALLEL_RESEARCH_ANGLES): string[] {
  const seen = new Set<string>();

  return plan
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (seen.has(line)) {
        return false;
      }
      seen.add(line);
      return true;
    })
    .slice(0, Math.max(1, maxAngles));
}

function buildCurrentDateContextLine(): string {
  return `Current date: ${new Date().toISOString().slice(0, 10)}`;
}

async function runAgentPrompt(fred: Fred, agentId: string, message: string): Promise<string> {
  const agent = fred.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  try {
    // Use fred.runSafe which wraps with Effect.exit internally,
    // preventing Effect's runtime from logging fiber failures to stderr.
    const response = await researchProgressAgentContext.run(
      { agentId },
      () => fred.runSafe(agent.processMessage(message, [])),
    );
    return extractText(response).trim();
  } catch (error) {
    throw new Error(extractEffectErrorMessage(error));
  }
}

function getWorkflowProgressId(
  ctx: { metadata?: Record<string, unknown> },
  stepName: string,
): string | undefined {
  const progressIds = (ctx.metadata?.[WORKFLOW_PROGRESS_IDS_KEY] ?? {}) as Record<string, string>;
  return progressIds[stepName];
}

async function runAgentPromptWithProgress(
  fred: Fred,
  agentId: string,
  message: string,
  context: ResearchProgressContext,
): Promise<string> {
  const agent = fred.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  try {
    const response = await researchProgressAgentContext.run(
      context,
      () => fred.runSafe(agent.processMessage(message, [])),
    );
    return extractText(response).trim();
  } catch (error) {
    throw new Error(extractEffectErrorMessage(error));
  }
}

async function runParallelTrackResearch(
  fred: Fred,
  agentId: string,
  userRequest: string,
  plan: string,
  options: { parentToolCallId?: string; taskDepth: number; toolDepth: number },
): Promise<string> {
  const angles = extractResearchAngles(plan).slice(0, 3);
  const TASKS_TO_RUN = angles.length > 0 ? angles : [userRequest];

  const taskWithTimeout = async (
    angle: string,
    index: number,
  ): Promise<{ angle: string; findings: string; timedOut: boolean }> => {
    const taskId = `${agentId}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
    const TASK_TIMEOUT_MS = 45_000;

    emitTuiTaskStart({
      toolCallId: taskId,
      toolName: agentId,
      input: { question: angle },
      depth: options.taskDepth,
      parentToolCallId: options.parentToolCallId,
    });

    let timedOut = false;
    try {
      const findings = await Promise.race([
        runAgentPromptWithProgress(
          fred,
          agentId,
          [
            buildCurrentDateContextLine(),
            '',
            `User request: ${userRequest}`,
            '',
            'Research plan:',
            plan,
            '',
            `Focus angle ${index + 1}: ${angle}`,
            '',
            'Investigate only this angle. If live or date-sensitive facts matter, use agent_browser_research. Return findings only for this angle.',
          ].join('\n'),
          {
            agentId,
            parentToolCallId: taskId,
            depth: options.toolDepth,
          },
        ),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`Research angle timed out after ${TASK_TIMEOUT_MS / 1000}s`)), TASK_TIMEOUT_MS),
        ),
      ]);

      emitTuiTaskComplete({
        toolCallId: taskId,
        toolName: agentId,
        output: 'completed',
      });

      return { angle, findings, timedOut };
    } catch (error) {
      timedOut = error instanceof Error && error.message.includes('timed out');
      emitTuiTaskError({
        toolCallId: taskId,
        toolName: agentId,
        error: {
          message: extractEffectErrorMessage(error),
        },
      });
      if (timedOut) {
        return { angle, findings: `[Timed out] ${angle}`, timedOut: true };
      }
      throw error;
    }
  };

  const settled = await Promise.all(TASKS_TO_RUN.map((angle, index) => taskWithTimeout(angle, index)));
  const results = settled.filter((r): r is { angle: string; findings: string; timedOut: false } => !r.timedOut);

  if (results.length === 0) {
    return TASKS_TO_RUN.length === 1
      ? `Research timed out: ${TASKS_TO_RUN[0]}`
      : `All ${TASKS_TO_RUN.length} research angles timed out.`;
  }

  return results
    .map(({ angle, findings }) => `### ${angle}\n${findings.trim()}`)
    .join('\n\n');
}

function buildResearchWorkflow(fred: Fred): ReturnType<GraphWorkflowBuilder['build']> {
  return new GraphWorkflowBuilder('research-swarm')
    .addNode('planResearch', {
      type: 'function',
      fn: async (ctx) => ({
        executionPlan: planResearchExecution(ctx.input),
        plan: await runAgentPrompt(
          fred,
          'research-planner',
          [
            buildCurrentDateContextLine(),
            '',
            'Create a research plan for this request.',
            '',
            `Request: ${ctx.input}`,
          ].join('\n'),
        ),
      }),
    })
    .addForkNode('fanOutResearch', ['webTrack', 'marketTrack', 'riskTrack'])
    .addNode('webTrack', {
      type: 'function',
      fn: async (ctx) => {
        const plan = readOutputField(ctx.outputs.planResearch, 'plan');
        return {
          webFindings: await runParallelTrackResearch(
            fred,
            'web-researcher',
            ctx.input,
            plan,
            {
              parentToolCallId: getWorkflowProgressId(ctx, 'webTrack'),
              taskDepth: 4,
              toolDepth: 5,
            },
          ),
        };
      },
    })
    .addNode('marketTrack', {
      type: 'function',
      fn: async (ctx) => {
        const executionPlan = getResearchExecutionPlanFromContext(ctx);
        if (!executionPlan.includeMarketTrack) {
          return {
            marketFindings: 'Skipped: market track not needed for a background or historical research request.',
          };
        }

        return {
          marketFindings: await runAgentPrompt(
            fred,
            'market-researcher',
            [
              buildCurrentDateContextLine(),
              '',
              `User request: ${ctx.input}`,
              '',
              'Research plan:',
              readOutputField(ctx.outputs.planResearch, 'plan'),
            ].join('\n'),
          ),
        };
      },
    })
    .addNode('riskTrack', {
      type: 'function',
      fn: async (ctx) => {
        const executionPlan = getResearchExecutionPlanFromContext(ctx);
        if (!executionPlan.includeRiskTrack) {
          return {
            riskFindings: 'Skipped: risk track not needed for a background or historical research request.',
          };
        }

        return {
          riskFindings: await runAgentPrompt(
            fred,
            'risk-analyst',
            [
              buildCurrentDateContextLine(),
              '',
              `User request: ${ctx.input}`,
              '',
              'Research plan:',
              readOutputField(ctx.outputs.planResearch, 'plan'),
            ].join('\n'),
          ),
        };
      },
    })
    .addJoinNode('mergeResearch', ['webTrack', 'marketTrack', 'riskTrack'])
    .addNode('synthesizeResearch', {
      type: 'function',
      fn: async (ctx) => {
        const webFindings = readOutputField(ctx.outputs.mergeResearch, 'webFindings');
        const marketFindings = readOutputField(ctx.outputs.mergeResearch, 'marketFindings');
        const riskFindings = readOutputField(ctx.outputs.mergeResearch, 'riskFindings');

        return {
          synthesis: await runAgentPrompt(
            fred,
            'research-synthesizer',
            [
              buildCurrentDateContextLine(),
              '',
              `User request: ${ctx.input}`,
              '',
              'Research plan:',
              readOutputField(ctx.outputs.planResearch, 'plan'),
              ...(webFindings ? ['', 'Web findings:', webFindings] : []),
              ...(!isSkippedFinding(marketFindings) && marketFindings ? ['', 'Market findings:', marketFindings] : []),
              ...(!isSkippedFinding(riskFindings) && riskFindings ? ['', 'Risk findings:', riskFindings] : []),
            ].join('\n'),
          ),
        };
      },
    })
    .addNode('finalizeResearch', {
      type: 'function',
      fn: (ctx) => {
        const lines = [
          '# Research Swarm Report',
          '',
          '## Question',
          ctx.input,
          '',
          '## Plan',
          readOutputField(ctx.outputs.planResearch, 'plan'),
          '',
        ];

        appendReportSection(lines, '## Web Findings', readOutputField(ctx.outputs.mergeResearch, 'webFindings'));
        appendReportSection(lines, '## Market Findings', readOutputField(ctx.outputs.mergeResearch, 'marketFindings'));
        appendReportSection(lines, '## Risk Findings', readOutputField(ctx.outputs.mergeResearch, 'riskFindings'));
        appendReportSection(lines, '## Synthesis', readOutputField(ctx.outputs.synthesizeResearch, 'synthesis'));
        // Critique step removed — self-check is now part of the synthesizer prompt.

        return {
          finalReport: lines.join('\n'),
        };
      },
    })
    .addEdge('planResearch', 'fanOutResearch')
    .addEdge('mergeResearch', 'synthesizeResearch')
    .addEdge('synthesizeResearch', 'finalizeResearch')
    .setHooks(createWorkflowProgressHooks({
      planResearch: 'research-planner',
      webTrack: 'web-researcher',
      marketTrack: 'market-researcher',
      riskTrack: 'risk-analyst',
      synthesizeResearch: 'research-synthesizer',
      finalizeResearch: 'finalize-research',
    }, 3))
    .setEntry('planResearch')
    .build();
}

function buildDailyBriefWorkflow(fred: Fred, notebookPath: string): ReturnType<GraphWorkflowBuilder['build']> {
  return new GraphWorkflowBuilder('daily-brief')
    .addForkNode('collectBriefInputs', ['noteSnapshot', 'newsSnapshot'])
    .addNode('noteSnapshot', {
      type: 'function',
      fn: async () => ({
        noteSummary: await queryNotebook(notebookPath, { limit: 5 }),
      }),
    })
    .addNode('newsSnapshot', {
      type: 'function',
      fn: async (ctx) => ({
        newsSummary: await runAgentPrompt(
          fred,
          'news-briefer',
          `Summarize the latest news from the past 24 hours. Focus area: ${ctx.input}.`,
        ),
      }),
    })
    .addJoinNode('mergeBriefInputs', ['noteSnapshot', 'newsSnapshot'])
    .addNode('writeDailyBrief', {
      type: 'function',
      fn: async (ctx) => ({
        brief: await runAgentPrompt(
          fred,
          'daily-brief-writer',
          [
            `Daily brief focus: ${ctx.input}`,
            '',
            'Notebook summary:',
            readOutputField(ctx.outputs.mergeBriefInputs, 'noteSummary'),
            '',
            'News summary:',
            readOutputField(ctx.outputs.mergeBriefInputs, 'newsSummary'),
          ].join('\n'),
        ),
      }),
    })
    .addEdge('mergeBriefInputs', 'writeDailyBrief')
    .setHooks(createWorkflowProgressHooks({
      noteSnapshot: 'note-taker',
      newsSnapshot: 'news-briefer',
      writeDailyBrief: 'daily-brief-writer',
    }, 3))
    .setEntry('collectBriefInputs')
    .build();
}

function createSaveNoteTool(notebookPath: string): Tool<
  { readonly title: string; readonly content: string; readonly tags?: ReadonlyArray<string> },
  string
> {
  return {
    id: 'save_note',
    name: 'save_note',
    description: 'Save a short note to the local markdown notebook',
    schema: {
      input: Schema.Struct({
        title: Schema.String,
        content: Schema.String,
        tags: Schema.optional(Schema.Array(Schema.String)),
      }),
      success: Schema.String,
      metadata: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short heading for the note' },
          content: { type: 'string', description: 'The note body to save' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional comma-like tags for later retrieval',
          },
        },
        required: ['title', 'content'],
      },
    },
    execute: async ({ title, content, tags }) => {
      const entry = await appendNotebookEntry(notebookPath, { title, content, tags });
      return `Saved note:\n${entry}`;
    },
  };
}

function createReadNotesTool(notebookPath: string): Tool<
  { readonly query?: string | null; readonly limit?: number | string | null },
  string
> {
  return {
    id: 'read_notes',
    name: 'read_notes',
    description: 'Read saved notes from the local markdown notebook',
    schema: {
      input: Schema.Struct({
        query: Schema.optional(Schema.NullOr(Schema.String)),
        limit: Schema.optional(Schema.NullOr(Schema.Union(Schema.Number, Schema.String))),
      }),
      success: Schema.String,
      metadata: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional text to search for inside saved notes' },
          limit: { type: 'number', description: 'Maximum matching sections to return' },
        },
      },
    },
    execute: async ({ query, limit }) => queryNotebook(notebookPath, {
      query: query ?? undefined,
      limit: normalizeOptionalLimit(limit),
    }),
  };
}

function createNewsTool(): Tool<
  { readonly topic?: string | null; readonly limit?: number | string | null },
  string
> {
  return {
    id: 'fetch_latest_news',
    name: 'fetch_latest_news',
    description: 'Fetch and summarize latest news from the past 24 hours',
    capabilities: ['external'],
    schema: {
      input: Schema.Struct({
        topic: Schema.optional(Schema.NullOr(Schema.String)),
        limit: Schema.optional(Schema.NullOr(Schema.Union(Schema.Number, Schema.String))),
      }),
      success: Schema.String,
      metadata: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Optional topic or beat to focus on' },
          limit: { type: 'number', description: 'Maximum number of items to include' },
        },
      },
    },
    execute: async ({ topic, limit }) => {
      const result = await fetchLatestNewsDigest({
        topic: topic ?? undefined,
        limit: normalizeOptionalLimit(limit),
      });
      return `${result.digest}\n\nSource: ${result.source}`;
    },
  };
}

function createResearchTool(notebookPath: string, fred: Fred): Tool<
  { readonly question: string; readonly saveSummary?: string | null },
  string
> {
  return {
    id: 'run_research_swarm',
    name: 'run_research_swarm',
    description: 'Run a parallel multi-agent research workflow and return the report',
    schema: {
      input: Schema.Struct({
        question: Schema.String,
        saveSummary: Schema.optional(Schema.NullOr(Schema.String)),
      }),
      success: Schema.String,
      metadata: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Research question or comparison request' },
          saveSummary: { type: 'string', description: 'Pass "yes" to save the final report to notes' },
        },
        required: ['question'],
      },
    },
    execute: async ({ question, saveSummary }) => {
      const result = await fred.executeGraphWorkflow('research-swarm', question);
      const finalReport = readOutputField(result.outputs.finalizeResearch, 'finalReport');

      const shouldSave = typeof saveSummary === 'string'
        && /^(yes|true|1)$/i.test(saveSummary.trim());
      if (shouldSave) {
        await appendNotebookEntry(notebookPath, {
          title: `Research: ${question.slice(0, 60)}`,
          content: finalReport,
          tags: ['research'],
        });
      }

      return finalReport;
    },
  };
}

function createBrowserResearchTool(fred: Fred, searchBaseUrl: string): Tool<
  { readonly query: string; readonly maxResults?: number | string | null; readonly readTopResults?: number | string | boolean | null },
  string
> {
  return {
    id: 'agent_browser_research',
    name: 'agent_browser_research',
    description: 'Use browser-backed live web research for up-to-date public information',
    capabilities: ['external'],
    schema: {
      input: Schema.Struct({
        query: Schema.String,
        maxResults: Schema.optional(Schema.NullOr(Schema.Union(Schema.Number, Schema.String))),
        readTopResults: Schema.optional(Schema.NullOr(Schema.Union(Schema.Number, Schema.String, Schema.Boolean))),
      }),
      success: Schema.String,
      metadata: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for live web research' },
          maxResults: { type: 'number', description: 'Maximum search results to return' },
          readTopResults: { type: 'number', description: 'How many top results to open and summarize; true means use the default depth' },
        },
        required: ['query'],
      },
    },
    execute: async ({ query, maxResults, readTopResults }) => {
      const progressContext = researchProgressAgentContext.getStore();
      const originAgentId = progressContext?.agentId;
      const browserProgressId = `agent_browser_research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const executionPlan = planResearchExecution(query);
      emitTuiProgressStart({
        toolCallId: browserProgressId,
        toolName: 'agent_browser_research',
        input: { query },
        originAgentId,
        parentToolCallId: progressContext?.parentToolCallId,
        depth: progressContext?.depth ?? 4,
        kind: 'tool',
      });

      try {
        const searchUrl = `${searchBaseUrl}/search?q=${encodeURIComponent(query)}`;
        const report = await runBrowserResearch(fred, query, {
          searchUrl,
          maxResults: normalizeOptionalLimit(maxResults) ?? 5,
          readTopResults: normalizeReadTopResults(readTopResults) ?? executionPlan.browserReadTopResults,
        });
        emitTuiProgressComplete({
          toolCallId: browserProgressId,
          toolName: 'agent_browser_research',
          output: report,
        });
        return report;
      } catch (error) {
        const errorMessage = extractEffectErrorMessage(error);
        emitTuiProgressError({
          toolCallId: browserProgressId,
          toolName: 'agent_browser_research',
          error: { message: errorMessage },
        });
        throw new Error(errorMessage);
      }
    },
  };
}

function createDailyBriefTool(fred: Fred): Tool<{ readonly focus?: string }, string> {
  return {
    id: 'create_daily_brief',
    name: 'create_daily_brief',
    description: 'Create a daily brief using saved notes and fresh news',
    schema: {
      input: Schema.Struct({
        focus: Schema.optional(Schema.String),
      }),
      success: Schema.String,
      metadata: {
        type: 'object',
        properties: {
          focus: { type: 'string', description: 'Optional focus area for the brief' },
        },
      },
    },
    execute: async ({ focus }) => {
      // Open a session on first input and run the whole daily-brief workflow
      // under it. executeGraphWorkflow binds the id as the ambient session for
      // the run (SessionService.withSession), so its nodes read/write the same
      // conversation through the environment. The id is resumable at any time,
      // so a follow-up brief can continue the same conversation.
      const runtime = await fred.getRuntime();
      const session = await Runtime.runPromise(runtime)(
        Effect.flatMap(SessionService, (sessions) => sessions.open()),
      );
      const result = await fred.executeGraphWorkflow(
        'daily-brief',
        focus?.trim() || 'general daily brief',
        { conversationId: session.id },
      );
      return readOutputField(result.outputs.writeDailyBrief, 'brief');
    },
  };
}

export async function setupExample(
  fred: Fred,
  options: SetupExampleOptions = {},
): Promise<{ notebookPath: string; workflows: string[] }> {
  const notebookPath = options.notebookPath ?? DEFAULT_NOTEBOOK_PATH;
  const configPath = options.configPath ?? './config.yaml';
  const directSpecialists = [
    'research-orchestrator',
    'note-taker',
    'news-briefer',
    'daily-brief-agent',
  ];

  await ensureNotebook(notebookPath);
  const searchBaseUrl = process.env.FRED_SEARCH_URL ?? 'https://search.tfr.one';

  await fred.registerGlobalVariables({
    current_date: () => Effect.succeed(new Date().toISOString().slice(0, 10)),
    search_url: () => Effect.succeed(searchBaseUrl),
  });

  fred.registerTool(
    createHandoffTool(
      (agentId) => fred.getAgent(agentId),
      () => directSpecialists,
    ) as unknown as Tool,
  );
  fred.registerTool(createSaveNoteTool(notebookPath) as Tool);
  fred.registerTool(createReadNotesTool(notebookPath) as Tool);
  fred.registerTool(createNewsTool() as Tool);
  fred.registerTool(createBrowserResearchTool(fred, searchBaseUrl) as Tool);
  fred.registerTool(createResearchTool(notebookPath, fred) as Tool);
  fred.registerTool(createDailyBriefTool(fred) as Tool);

  await fred.initializeFromConfig(configPath);

  // Builders remain ergonomic sugar; compiling them here makes the canonical
  // WorkflowIR explicit and registers both through the unified API.
  await fred.defineWorkflow(defineWorkflow(compileGraphWorkflow(buildResearchWorkflow(fred))));
  await fred.defineWorkflow(
    defineWorkflow(compileGraphWorkflow(buildDailyBriefWorkflow(fred, notebookPath))),
  );

  return {
    notebookPath,
    workflows: ['research-swarm', 'daily-brief'],
  };
}

function buildSmokeNewsFeed(now: Date): string {
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toUTCString();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toUTCString();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toUTCString();

  return `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>Smoke Feed</title>
      <item>
        <title>Transit workers reach agreement - City Desk</title>
        <link>https://example.com/transit</link>
        <pubDate>${oneHourAgo}</pubDate>
      </item>
      <item>
        <title>Storm system weakens overnight - Weather Center</title>
        <link>https://example.com/weather</link>
        <pubDate>${threeHoursAgo}</pubDate>
      </item>
      <item>
        <title>Older article - Archive</title>
        <link>https://example.com/archive</link>
        <pubDate>${twoDaysAgo}</pubDate>
      </item>
    </channel>
  </rss>`;
}

export async function runDeterministicSmokeChecks(
  notebookPath: string,
): Promise<DeterministicSmokeResult> {
  const timestamp = new Date('2026-03-06T12:00:00.000Z');
  await appendNotebookEntry(notebookPath, {
    title: 'Smoke test note',
    content: 'Remember to ask for concise summaries and save high-signal findings.',
    tags: ['smoke', 'prefs'],
    timestamp,
  });

  const notebookPreview = await queryNotebook(notebookPath, {
    query: 'smoke',
    limit: 1,
  });

  const news = await fetchLatestNewsDigest({
    limit: 2,
    now: timestamp,
    fetchImpl: async () =>
      new Response(buildSmokeNewsFeed(timestamp), {
        status: 200,
        headers: {
          'content-type': 'application/rss+xml',
        },
      }),
  });

  return {
    notebookPreview,
    newsDigest: news.digest,
  };
}
