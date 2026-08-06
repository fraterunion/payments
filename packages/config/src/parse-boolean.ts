const TRUE_VALUES = new Set(['true', '1', 'yes']);
const FALSE_VALUES = new Set(['false', '0', 'no']);

/**
 * Strictly parses a boolean-ish string. Returns `undefined` for anything
 * that isn't an unambiguous true/false representation, so callers decide
 * how to handle an absent or unrecognized value instead of silently
 * defaulting to `false`.
 */
export function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}
