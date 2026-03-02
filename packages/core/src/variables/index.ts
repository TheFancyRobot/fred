import type { Effect } from 'effect';

export type VariableValue = string | number | boolean;
export type VariableFactory = () => Effect.Effect<VariableValue>;
