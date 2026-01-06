import { Intent, IntentMatch } from './intent';

/**
 * Intent matcher with hybrid matching strategy
 */
export class IntentMatcher {
  private intents: Intent[] = [];

  /**
   * Register intents for matching
   */
  registerIntents(intents: Intent[]): void {
    this.intents = intents;
  }

  /**
   * Match a user message against registered intents
   * Uses hybrid strategy: exact → regex → semantic
   */
  async matchIntent(
    message: string,
    semanticMatcher?: (message: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number; utterance?: string }>
  ): Promise<IntentMatch | null> {
    const normalizedMessage = message.toLowerCase().trim();

    // Try exact match first
    for (const intent of this.intents) {
      for (const utterance of intent.utterances) {
        if (normalizedMessage === utterance.toLowerCase().trim()) {
          return {
            intent,
            confidence: 1.0,
            matchedUtterance: utterance,
            matchType: 'exact',
          };
        }
      }
    }

    // Try regex match
    for (const intent of this.intents) {
      for (const utterance of intent.utterances) {
        try {
          // Treat utterance as regex pattern
          const regex = new RegExp(utterance, 'i');
          if (regex.test(message)) {
            return {
              intent,
              confidence: 0.8,
              matchedUtterance: utterance,
              matchType: 'regex',
            };
          }
        } catch {
          // Invalid regex, skip
          continue;
        }
      }
    }

    // Try semantic matching if provided
    if (semanticMatcher) {
      for (const intent of this.intents) {
        const result = await semanticMatcher(message, intent.utterances);
        if (result.matched) {
          return {
            intent,
            confidence: result.confidence,
            matchedUtterance: result.utterance,
            matchType: 'semantic',
          };
        }
      }
    }

    return null;
  }

  /**
   * Get all registered intents
   */
  getIntents(): Intent[] {
    return this.intents;
  }

  /**
   * Clear all intents
   */
  clear(): void {
    this.intents = [];
  }
}


