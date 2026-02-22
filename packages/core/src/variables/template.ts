import { Effect } from 'effect';

/**
 * Global variable value types
 */
export type VariableValue = string | number | boolean;
export type VariableFactory = () => Effect.Effect<VariableValue>;

/**
 * Resolve a template string by replacing all {{ var_name }} with values
 * @param template - String with {{ var_name }} placeholders
 * @param variables - Map of variable names to values
 * @param options - Resolution options
 * @returns Resolved string with all variables replaced
 */
export function resolveTemplate(
  template: string,
  variables: Record<string, VariableValue>,
  options?: {
    /** If true, throw on missing variables. If false, leave placeholder unchanged */
    strict?: boolean;
    /** If true, remove unresolved placeholders. If false, leave them as-is */
    removeUnresolved?: boolean;
  }
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const strict = options?.strict ?? false;
    const removeUnresolved = options?.removeUnresolved ?? false;

    const resolved = template.replace(
      /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
      (match, varName) => {
        const value = variables[varName];

        if (value !== undefined) {
          return String(value);
        }

        if (strict) {
          throw new Error(`Variable "${varName}" not found in template`);
        }

        if (removeUnresolved) {
          return '';
        }

        return match;
      }
    );

    return resolved;
  });
}
