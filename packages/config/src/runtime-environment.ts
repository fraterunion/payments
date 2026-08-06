export const RUNTIME_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

export function isRuntimeEnvironment(value: string): value is RuntimeEnvironment {
  return (RUNTIME_ENVIRONMENTS as readonly string[]).includes(value);
}
