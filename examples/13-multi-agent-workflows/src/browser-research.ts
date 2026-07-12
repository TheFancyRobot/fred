import type { FredClient } from '@fancyrobot/fred';

type BrowserResearchClient = Pick<FredClient, 'subagents'>;

const AGENT_BROWSER = 'agent-browser';
const DEFAULT_TIMEOUT = 30_000;
const SEARCH_FETCH_TIMEOUT = 12_000;
let sessionCounter = 0;

function makeSessionName(): string {
  return `fred-research-${process.pid}-${++sessionCounter}`;
}

export interface BrowserResearchEntry {
  title: string;
  url: string;
  snippet: string;
  pageExtract?: string;
}

async function runAgentBrowser(
  fred: BrowserResearchClient,
  subagentId: string,
  args: string[],
  options: { timeout?: number } = {},
): Promise<string> {
  const result = await fred.subagents.execute(subagentId, {
    args,
    timeoutMs: options.timeout ?? DEFAULT_TIMEOUT,
    maxOutputChars: 80_000,
  });
  return result.stdout.trim();
}

async function fetchSearchResultsHtml(searchUrl: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_FETCH_TIMEOUT);

  try {
    const response = await fetch(searchUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'fred-example-13-research/1.0',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      return undefined;
    }

    return await response.text();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function stripContentBoundaries(text: string): string {
  return text
    .replace(/^--- AGENT_BROWSER_PAGE_CONTENT .*\n?/gm, '')
    .replace(/^--- END_AGENT_BROWSER_PAGE_CONTENT .*\n?/gm, '')
    .trim();
}

function parseSearchResults(snapshotText: string, maxResults: number): BrowserResearchEntry[] {
  const cleaned = stripContentBoundaries(snapshotText);
  const entries: BrowserResearchEntry[] = [];
  const lines = cleaned.split('\n');

  let i = 0;
  while (i < lines.length && entries.length < maxResults) {
    const line = lines[i].trim();

    const urlMatch = line.match(/(https?:\/\/[^\s)>\]"]+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      const title = line.replace(urlMatch[0], '').replace(/[@\[\]()]/g, '').trim() || url;

      const snippetLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && snippetLines.length < 3) {
        const nextLine = lines[j].trim();
        if (!nextLine || nextLine.match(/(https?:\/\/[^\s)>\]"]+)/)) {
          break;
        }
        snippetLines.push(nextLine);
        j++;
      }

      entries.push({
        title: title.slice(0, 200),
        url,
        snippet: snippetLines.join(' ').slice(0, 400),
      });
      i = j;
    } else {
      i++;
    }
  }

  return entries;
}

async function fetchPageExtractViaBrowser(
  fred: BrowserResearchClient,
  url: string,
  maxChars = 1400,
): Promise<string | undefined> {
  const session = makeSessionName();
  const subagent = await fred.subagents.spawn({
    name: `agent-browser:${session}`,
    command: AGENT_BROWSER,
    args: ['--session', session],
    env: {
      AGENT_BROWSER_MAX_OUTPUT: '30000',
      AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
    },
    metadata: {
      kind: 'browser-research',
      session,
    },
    destroy: {
      cleanupArgs: ['close'],
      cleanupTimeoutMs: 5_000,
      ignoreCleanupFailure: true,
    },
  });

  try {
    await runAgentBrowser(
      fred,
      subagent.id,
      ['open', url],
      { timeout: 15_000 },
    );
    await runAgentBrowser(
      fred,
      subagent.id,
      ['wait', '--load', 'networkidle'],
      { timeout: 10_000 },
    );
    const text = await runAgentBrowser(
      fred,
      subagent.id,
      ['get', 'text', 'body'],
      { timeout: 5_000 },
    );
    const cleaned = stripContentBoundaries(text);
    return cleaned ? cleaned.slice(0, maxChars) : undefined;
  } catch {
    return undefined;
  } finally {
    await fred.subagents.destroy(subagent.id).catch(() => undefined);
  }
}

export async function runBrowserResearch(
  fred: BrowserResearchClient,
  query: string,
  options: {
    searchUrl: string;
    maxResults?: number;
    readTopResults?: number;
  },
): Promise<string> {
  const maxResults = Math.max(1, options.maxResults ?? 3);
  const readTopResults = Math.max(0, Math.min(maxResults, options.readTopResults ?? 1));
  const prefetchedHtml = await fetchSearchResultsHtml(options.searchUrl);
  const prefetchedResults = prefetchedHtml ? extractDuckDuckGoResults(prefetchedHtml, maxResults) : [];

  if (prefetchedResults.length > 0) {
    const enriched = await Promise.all(
      prefetchedResults.map(async (entry, index) => ({
        ...entry,
        pageExtract:
          index < readTopResults
            ? await fetchPageExtractViaBrowser(fred, entry.url)
            : undefined,
      })),
    );

    return [
      '# Browser Research',
      `Query: ${query}`,
      '',
      ...enriched.flatMap((entry, index) => [
        `${index + 1}. ${entry.title}`,
        `   URL: ${entry.url}`,
        `   Snippet: ${entry.snippet || 'No snippet available.'}`,
        ...(entry.pageExtract
          ? [`   Page extract: ${entry.pageExtract}`]
          : []),
        '',
      ]),
    ].join('\n').trim();
  }

  const session = makeSessionName();
  const subagent = await fred.subagents.spawn({
    name: `agent-browser:${session}`,
    command: AGENT_BROWSER,
    args: ['--session', session],
    env: {
      AGENT_BROWSER_MAX_OUTPUT: '30000',
      AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
    },
    metadata: {
      kind: 'browser-research',
      session,
    },
    destroy: {
      cleanupArgs: ['close'],
      cleanupTimeoutMs: 5_000,
      ignoreCleanupFailure: true,
    },
  });

  try {
    await runAgentBrowser(fred, subagent.id, ['open', options.searchUrl], { timeout: 15_000 });
    await runAgentBrowser(
      fred,
      subagent.id,
      ['wait', '--load', 'networkidle'],
      { timeout: 10_000 },
    );

    const snapshot = await runAgentBrowser(fred, subagent.id, ['get', 'text', 'body']);
    const results = parseSearchResults(snapshot, maxResults);

    if (results.length === 0) {
      return [
        '# Browser Research',
        `Query: ${query}`,
        '',
        'No search results were returned.',
      ].join('\n');
    }

    // Enrich top results by visiting pages with agent-browser
    const enriched = await Promise.all(
      results.map(async (entry, index) => ({
        ...entry,
        pageExtract:
          index < readTopResults
            ? await fetchPageExtractViaBrowser(fred, entry.url)
            : undefined,
      })),
    );

    return [
      '# Browser Research',
      `Query: ${query}`,
      '',
      ...enriched.flatMap((entry, index) => [
        `${index + 1}. ${entry.title}`,
        `   URL: ${entry.url}`,
        `   Snippet: ${entry.snippet || 'No snippet available.'}`,
        ...(entry.pageExtract
          ? [`   Page extract: ${entry.pageExtract}`]
          : []),
        '',
      ]),
    ].join('\n').trim();
  } finally {
    await fred.subagents.destroy(subagent.id).catch(() => undefined);
  }
}

// Re-export helpers used by tests
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

export function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function extractDuckDuckGoResults(html: string, maxResults = 5): BrowserResearchEntry[] {
  const DDG_LINK_REGEX = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const DDG_SNIPPET_REGEX = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i;
  const entries: BrowserResearchEntry[] = [];
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = DDG_LINK_REGEX.exec(html)) !== null) {
    const windowStart = linkMatch.index + linkMatch[0].length;
    const snippetWindow = html.slice(windowStart, windowStart + 1200);
    const snippetMatch = snippetWindow.match(DDG_SNIPPET_REGEX);
    const title = stripHtmlToText(linkMatch[2]);
    const url = resolveDuckDuckGoUrl(linkMatch[1]);
    const snippet = snippetMatch ? stripHtmlToText(snippetMatch[1]) : '';

    if (!title || !url) {
      continue;
    }

    entries.push({ title, url, snippet });
    if (entries.length >= maxResults) {
      break;
    }
  }

  return entries;
}

function resolveDuckDuckGoUrl(rawUrl: string): string {
  const absoluteUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  try {
    const parsed = new URL(absoluteUrl);
    const redirectTarget = parsed.searchParams.get('uddg');
    return redirectTarget ? decodeURIComponent(redirectTarget) : absoluteUrl;
  } catch {
    return absoluteUrl;
  }
}
