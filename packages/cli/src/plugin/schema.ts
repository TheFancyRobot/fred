import { Either, Schema } from 'effect';
import type { PluginDeclaration, PluginObjectDeclaration } from '@fancyrobot/fred';

const PluginObjectDeclarationSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  source: Schema.String.pipe(Schema.minLength(1)),
  options: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type NormalizedPluginSourceType = 'package' | 'path';

export interface NormalizedPluginDeclaration {
  id: string;
  source: string;
  sourceType: NormalizedPluginSourceType;
  options: Record<string, unknown>;
  declarationType: 'string' | 'object';
  declaredId?: string;
}

export class PluginDeclarationValidationError extends Error {
  readonly code = 'plugin-declaration-invalid';

  constructor(message: string) {
    super(message);
    this.name = 'PluginDeclarationValidationError';
  }
}

function classifySourceType(source: string): NormalizedPluginSourceType {
  if (source.startsWith('.') || source.startsWith('/')) {
    return 'path';
  }
  return 'package';
}

function validateObjectDeclaration(raw: unknown, index: number): PluginObjectDeclaration {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PluginDeclarationValidationError(
      `Plugin declaration at index ${index} must be a string or object entry.`,
    );
  }

  if (!('id' in raw)) {
    throw new PluginDeclarationValidationError(
      `Plugin object declaration at index ${index} must include an explicit "id" field.`,
    );
  }

  const decoded = Schema.decodeUnknownEither(PluginObjectDeclarationSchema)(raw);
  if (Either.isLeft(decoded)) {
    throw new PluginDeclarationValidationError(
      `Invalid plugin object declaration at index ${index}: ${String(decoded.left)}`,
    );
  }

  return decoded.right;
}

export function normalizePluginDeclarations(
  declarations: readonly PluginDeclaration[] | undefined,
): NormalizedPluginDeclaration[] {
  if (!declarations || declarations.length === 0) {
    return [];
  }

  const normalized: NormalizedPluginDeclaration[] = [];
  const seenById = new Map<string, number>();

  declarations.forEach((entry, index) => {
    const declaration = typeof entry === 'string'
      ? entry
      : validateObjectDeclaration(entry, index);

    const source = typeof declaration === 'string'
      ? declaration
      : declaration.source;

    if (!source || source.trim().length === 0) {
      throw new PluginDeclarationValidationError(
        `Plugin declaration at index ${index} has an empty source.`,
      );
    }

    const canonicalId = source;

    const duplicateAt = seenById.get(canonicalId);
    if (duplicateAt !== undefined) {
      throw new PluginDeclarationValidationError(
        `Duplicate plugin id "${canonicalId}" at index ${index}; already declared at index ${duplicateAt}.`,
      );
    }
    seenById.set(canonicalId, index);

    normalized.push({
      id: canonicalId,
      source,
      sourceType: classifySourceType(source),
      options: typeof declaration === 'string' ? {} : (declaration.options ?? {}),
      declarationType: typeof declaration === 'string' ? 'string' : 'object',
      declaredId: typeof declaration === 'string' ? undefined : declaration.id,
    });
  });

  return normalized;
}
