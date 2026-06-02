export async function SummarizeSong(input: { readonly title: string; readonly lyrics: string }): Promise<string> {
  return `summary:${input.title}:${input.lyrics.length}`;
}
