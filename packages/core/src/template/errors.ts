import { Data } from 'effect';

export class TemplateCompileError extends Data.TaggedError('TemplateCompileError')<{
  readonly filePath: string;
  readonly message: string;
  readonly line?: number;
  readonly cause?: unknown;
}> {}

export class TemplateResolutionError extends Data.TaggedError('TemplateResolutionError')<{
  readonly filePath: string;
  readonly expression?: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type TemplateError = TemplateCompileError | TemplateResolutionError;
