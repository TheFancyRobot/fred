import { fileURLToPath } from 'node:url';
import { Fred, GraphWorkflowBuilder, createHandoffTool, type Tool } from '@fancyrobot/fred';
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

const WORKFLOW_PROGRESS_IDS_KEY = '__tuiWorkflowProgressIds';

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
            message: event.data.error instanceof Error
              ? event.data.error.message
              : String(event.data.error ?? 'Workflow step failed'),
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

function buildCurrentDateContextLine(): string {
  return `Current date: ${new Date().toISOString().slice(0, 10)}`;
}

async function runAgentPrompt(fred: Fred, agentId: string, message: string): Promise<string> {
  const agent = fred.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const runtime = await fred.getRuntime();
  const response = await Runtime.runPromise(runtime)(agent.processMessage(message, []));
  return extractText(response).trim();
}

function buildResearchWorkflow(fred: Fred): ReturnType<GraphWorkflowBuilder['build']> {
  return new GraphWorkflowBuilder('research-swarm')
    .addNode('planResearch', {
      type: 'function',
      fn: async (ctx) => ({
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
    .addForkNode('fanOutResearch', ['officialTrack', 'marketTrack', 'riskTrack'])
    .addNode('officialTrack', {
      type: 'function',
      fn: async (ctx) => ({
        officialFindings: await runAgentPrompt(
          fred,
          'official-researcher',
          [
            buildCurrentDateContextLine(),
            '',
            `User request: ${ctx.input}`,
            '',
            'Research plan:',
            readOutputField(ctx.outputs.planResearch, 'plan'),
          ].join('\n'),
        ),
      }),
    })
    .addNode('marketTrack', {
      type: 'function',
      fn: async (ctx) => ({
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
      }),
    })
    .addNode('riskTrack', {
      type: 'function',
      fn: async (ctx) => ({
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
      }),
    })
    .addJoinNode('mergeResearch', ['officialTrack', 'marketTrack', 'riskTrack'])
    .addNode('synthesizeResearch', {
      type: 'function',
      fn: async (ctx) => ({
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
            '',
            'Official findings:',
            readOutputField(ctx.outputs.mergeResearch, 'officialFindings'),
            '',
            'Market findings:',
            readOutputField(ctx.outputs.mergeResearch, 'marketFindings'),
            '',
            'Risk findings:',
            readOutputField(ctx.outputs.mergeResearch, 'riskFindings'),
          ].join('\n'),
        ),
      }),
    })
    .addNode('critiqueResearch', {
      type: 'function',
      fn: async (ctx) => ({
        critique: await runAgentPrompt(
          fred,
          'research-critic',
          [
            buildCurrentDateContextLine(),
            '',
            `User request: ${ctx.input}`,
            '',
            'Draft answer:',
            readOutputField(ctx.outputs.synthesizeResearch, 'synthesis'),
          ].join('\n'),
        ),
      }),
    })
    .addNode('finalizeResearch', {
      type: 'function',
      fn: (ctx) => ({
        finalReport: [
          '# Research Swarm Report',
          '',
          '## Question',
          ctx.input,
          '',
          '## Plan',
          readOutputField(ctx.outputs.planResearch, 'plan'),
          '',
          '## Official Findings',
          readOutputField(ctx.outputs.mergeResearch, 'officialFindings'),
          '',
          '## Market Findings',
          readOutputField(ctx.outputs.mergeResearch, 'marketFindings'),
          '',
          '## Risk Findings',
          readOutputField(ctx.outputs.mergeResearch, 'riskFindings'),
          '',
          '## Synthesis',
          readOutputField(ctx.outputs.synthesizeResearch, 'synthesis'),
          '',
          '## Critique Checklist',
          readOutputField(ctx.outputs.critiqueResearch, 'critique'),
        ].join('\n'),
      }),
    })
    .addEdge('planResearch', 'fanOutResearch')
    .addEdge('mergeResearch', 'synthesizeResearch')
    .addEdge('synthesizeResearch', 'critiqueResearch')
    .addEdge('critiqueResearch', 'finalizeResearch')
    .setHooks(createWorkflowProgressHooks({
      planResearch: 'research-planner',
      officialTrack: 'official-researcher',
      marketTrack: 'market-researcher',
      riskTrack: 'risk-analyst',
      synthesizeResearch: 'research-synthesizer',
      critiqueResearch: 'research-critic',
      finalizeResearch: 'finalize-research',
    }, 3))
    .setEntry('planResearch')
    .build();
}

function buildDailyBriefWorkflow(fred: Fred): ReturnType<GraphWorkflowBuilder['build']> {
  return new GraphWorkflowBuilder('daily-brief')
    .addForkNode('collectBriefInputs', ['noteSnapshot', 'newsSnapshot'])
    .addNode('noteSnapshot', {
      type: 'function',
      fn: async () => ({
        noteSummary: await runAgentPrompt(
          fred,
          'note-taker',
          'Read the saved notebook and summarize the most relevant reminders, preferences, and open loops for a daily brief.',
        ),
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
      const browserProgressId = `agent_browser_research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      emitTuiProgressStart({
        toolCallId: browserProgressId,
        toolName: 'agent_browser_research',
        input: { query },
        depth: 4,
        kind: 'tool',
      });

      try {
        const searchUrl = `${searchBaseUrl}/search?q=${encodeURIComponent(query)}`;
        const report = await runBrowserResearch(fred, query, {
          searchUrl,
          maxResults: normalizeOptionalLimit(maxResults) ?? 5,
          readTopResults: normalizeReadTopResults(readTopResults) ?? 3,
        });
        emitTuiProgressComplete({
          toolCallId: browserProgressId,
          toolName: 'agent_browser_research',
          output: report,
        });
        return report;
      } catch (error) {
        emitTuiProgressError({
          toolCallId: browserProgressId,
          toolName: 'agent_browser_research',
          error: { message: error instanceof Error ? error.message : String(error) },
        });
        throw error;
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
      const result = await fred.executeGraphWorkflow('daily-brief', focus?.trim() || 'general daily brief');
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

  fred.registerGraphWorkflow(buildResearchWorkflow(fred));
  fred.registerGraphWorkflow(buildDailyBriefWorkflow(fred));

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
