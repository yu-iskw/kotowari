export const PACKAGE_NAME = '@kotowari/capability-memory' as const;

export { CapabilityMemoryError } from './errors.js';
export type { CapabilityMemoryContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { recordMemory, searchMemory } from './memory.js';
