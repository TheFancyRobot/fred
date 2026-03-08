export interface NewsArticle {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  publishedDate: Date | null;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchLatestNewsOptions {
  topic?: string;
  limit?: number;
  now?: Date;
  fetchImpl?: FetchLike;
}

const GOOGLE_NEWS_LOCALE = 'hl=en-US&gl=US&ceid=US:en';

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .trim();
}

function stripMarkup(value: string): string {
  return decodeXmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return stripMarkup(match?.[1] ?? '');
}

function splitTitleAndSource(title: string): { title: string; source: string } {
  const parts = title.split(' - ').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { title, source: '' };
  }

  return {
    title: parts.slice(0, -1).join(' - '),
    source: parts.at(-1) ?? '',
  };
}

function hoursAgo(publishedDate: Date | null, now: Date): string {
  if (!publishedDate || Number.isNaN(publishedDate.getTime())) {
    return 'time unknown';
  }

  const diffMs = Math.max(0, now.getTime() - publishedDate.getTime());
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) {
    const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    return `${diffMinutes}m ago`;
  }

  return `${diffHours}h ago`;
}

export function parseNewsFeed(xml: string): NewsArticle[] {
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  return itemBlocks
    .map((block) => {
      const rawTitle = extractFirstTag(block, 'title');
      const rawSource = extractFirstTag(block, 'source');
      const split = splitTitleAndSource(rawTitle);
      const publishedAt = extractFirstTag(block, 'pubDate');
      const publishedDate = publishedAt ? new Date(publishedAt) : null;

      return {
        title: split.title,
        link: extractFirstTag(block, 'link'),
        source: rawSource || split.source || 'Unknown source',
        publishedAt,
        publishedDate: publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate : null,
      } satisfies NewsArticle;
    })
    .filter((article) => article.title.length > 0 && article.link.length > 0);
}

export function selectRecentArticles(
  articles: ReadonlyArray<NewsArticle>,
  now = new Date(),
  hoursWindow = 24,
): NewsArticle[] {
  const cutoff = now.getTime() - hoursWindow * 60 * 60 * 1000;

  return articles.filter((article) => {
    if (!article.publishedDate) {
      return false;
    }

    return article.publishedDate.getTime() >= cutoff;
  });
}

export function buildGoogleNewsUrl(topic?: string): string {
  if (!topic || topic.trim().length === 0) {
    return `https://news.google.com/rss?${GOOGLE_NEWS_LOCALE}`;
  }

  const query = encodeURIComponent(`${topic.trim()} when:1d`);
  return `https://news.google.com/rss/search?q=${query}&${GOOGLE_NEWS_LOCALE}`;
}

export function formatNewsDigest(
  articles: ReadonlyArray<NewsArticle>,
  options: { topic?: string; now?: Date; strict24Hours?: boolean } = {},
): string {
  const now = options.now ?? new Date();
  const scope = options.topic ? ` for "${options.topic.trim()}"` : '';
  const windowLabel = options.strict24Hours === false ? 'top available feed items' : 'last 24 hours';

  if (articles.length === 0) {
    return `No news items were available${scope}.`;
  }

  return [
    `Latest news${scope} (${windowLabel}):`,
    ...articles.map((article) => {
      const timeLabel = hoursAgo(article.publishedDate, now);
      return `- ${article.title} (${article.source}, ${timeLabel})\n  ${article.link}`;
    }),
  ].join('\n');
}

export async function fetchLatestNewsDigest(
  options: FetchLatestNewsOptions = {},
): Promise<{ source: string; articles: NewsArticle[]; digest: string }> {
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;
  const limit = Math.max(1, Math.min(options.limit ?? 5, 10));
  const now = options.now ?? new Date();
  const response = await fetchImpl(buildGoogleNewsUrl(options.topic), {
    headers: {
      'user-agent': 'fred-example-13/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`News request failed with ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parseNewsFeed(xml);
  const recent = selectRecentArticles(parsed, now);
  const strict24Hours = recent.length > 0;
  const selected = (strict24Hours ? recent : parsed).slice(0, limit);

  return {
    source: 'Google News RSS',
    articles: selected,
    digest: formatNewsDigest(selected, {
      topic: options.topic,
      now,
      strict24Hours,
    }),
  };
}
