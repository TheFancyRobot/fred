export async function SummarizeSong(input: { readonly title: string; readonly lyrics: string }): Promise<string> {
  return `summary:${input.title}:${input.lyrics.length}`;
}

export async function BuildSupportPrompt(input: {
  readonly agentId: string;
  readonly topic: string;
}): Promise<string> {
  return `You are ${input.agentId}. Help the customer with ${input.topic}.`;
}
