import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_NOTEBOOK_CONTENT = `# Shared Notebook

This file is managed by the example's note-taking tools.
`;

export interface SaveNoteInput {
  title: string;
  content: string;
  tags?: ReadonlyArray<string>;
  timestamp?: Date;
}

function sanitizeMarkdown(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function getNotebookParts(content: string): { header: string; sections: string[] } {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const firstSectionIndex = normalized.search(/^## /m);

  if (firstSectionIndex === -1) {
    return {
      header: normalized,
      sections: [],
    };
  }

  const header = normalized.slice(0, firstSectionIndex).trimEnd();
  const sections = normalized
    .slice(firstSectionIndex)
    .split(/\n(?=## )/g)
    .map((section) => section.trim())
    .filter(Boolean);

  return { header, sections };
}

export async function ensureNotebook(path: string, seed = DEFAULT_NOTEBOOK_CONTENT): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  try {
    await readFile(path, 'utf-8');
  } catch {
    await writeFile(path, `${seed.trim()}\n`, 'utf-8');
  }
}

export async function readNotebook(path: string): Promise<string> {
  await ensureNotebook(path);
  return readFile(path, 'utf-8');
}

export async function appendNotebookEntry(path: string, input: SaveNoteInput): Promise<string> {
  await ensureNotebook(path);

  const existing = await readNotebook(path);
  const timestamp = (input.timestamp ?? new Date()).toISOString();
  const tagsLine = input.tags && input.tags.length > 0
    ? `- tags: ${input.tags.join(', ')}`
    : null;

  const entry = [
    `## ${sanitizeMarkdown(input.title)}`,
    `- saved: ${timestamp}`,
    tagsLine,
    '',
    sanitizeMarkdown(input.content),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
    .trim();

  const updated = `${existing.trimEnd()}\n\n${entry}\n`;
  await writeFile(path, updated, 'utf-8');

  return entry;
}

export async function queryNotebook(
  path: string,
  options: { query?: string; limit?: number } = {},
): Promise<string> {
  const content = await readNotebook(path);
  const { header, sections } = getNotebookParts(content);
  const fallbackLimit = sections.length > 0 ? sections.length : 1;
  const limit = Math.max(1, Math.min(options.limit ?? fallbackLimit, 20));
  const query = options.query?.trim().toLowerCase();
  const queryTokens = query
    ? Array.from(new Set(query.split(/[^a-z0-9]+/g).filter((token) => token.length >= 4)))
    : [];
  const requiredTokenMatches = queryTokens.length > 1 ? 2 : 1;

  const matchingSections = query
    ? sections.filter((section) => {
      const normalized = section.toLowerCase();
      if (normalized.includes(query)) {
        return true;
      }

      const tokenMatches = queryTokens.filter((token) => normalized.includes(token)).length;
      return tokenMatches >= Math.min(requiredTokenMatches, queryTokens.length);
    })
    : sections;

  const selected = matchingSections.slice(-limit);

  if (selected.length === 0) {
    return `${header}\n\n_No notes matched "${options.query}"._\n`;
  }

  return `${header}\n\n${selected.join('\n\n')}\n`;
}
