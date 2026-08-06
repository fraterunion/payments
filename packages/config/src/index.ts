export const CONFIG_PACKAGE_NAME = '@fraterunion-payments/config' as const;

export { RUNTIME_ENVIRONMENTS, isRuntimeEnvironment } from './runtime-environment.js';
export type { RuntimeEnvironment } from './runtime-environment.js';

export { LOG_LEVELS, isLogLevel } from './log-level.js';
export type { LogLevel } from './log-level.js';

export { parseBooleanFlag } from './parse-boolean.js';
