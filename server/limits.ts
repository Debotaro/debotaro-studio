/** Server-owned capacity policy. There is no public policy override endpoint. */
export interface DemoLimits {
  readonly databaseBytes: number;
  readonly projects: number;
  readonly projectsPerOwner: number;
  readonly versionsPerProject: number;
  readonly historyPerProject: number;
  readonly connections: number;
  readonly connectionsPerUser: number;
  readonly aiRequestsPerDay: number;
  readonly aiRequestsPerUserPerDay: number;
  readonly aiConcurrent: number;
}

export const DEFAULT_DEMO_LIMITS: DemoLimits = Object.freeze({
  databaseBytes: 268_435_456,
  projects: 1_000,
  projectsPerOwner: 20,
  versionsPerProject: 100,
  historyPerProject: 10_000,
  connections: 100,
  connectionsPerUser: 5,
  aiRequestsPerDay: 100,
  aiRequestsPerUserPerDay: 10,
  aiConcurrent: 2,
});

const ranges: Record<keyof DemoLimits, readonly [number, number]> = {
  databaseBytes: [65_536, 4_294_967_296],
  projects: [1, 100_000],
  projectsPerOwner: [1, 1_000],
  versionsPerProject: [1, 10_000],
  historyPerProject: [1, 1_000_000],
  connections: [1, 10_000],
  connectionsPerUser: [1, 100],
  aiRequestsPerDay: [0, 100_000],
  aiRequestsPerUserPerDay: [0, 10_000],
  aiConcurrent: [1, 100],
};

export function resolveDemoLimits(overrides: Partial<DemoLimits> = {}): DemoLimits {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('Demo limits must be an object containing recognized capacity settings.');
  }
  const prototype = Object.getPrototypeOf(overrides);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Demo limits must be a plain object containing recognized capacity settings.');
  }
  const normalized = { ...DEFAULT_DEMO_LIMITS };
  for (const key of Reflect.ownKeys(overrides)) {
    if (typeof key !== 'string' || !Object.hasOwn(ranges, key)) {
      throw new Error('Demo limits contain an unknown capacity setting.');
    }
    const field = key as keyof DemoLimits;
    const descriptor = Object.getOwnPropertyDescriptor(overrides, key)!;
    const value: unknown = descriptor.value;
    const [minimum, maximum] = ranges[field];
    if (!('value' in descriptor) || typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`Demo limit ${field} must be a safe integer from ${minimum} to ${maximum}.`);
    }
    normalized[field] = value;
  }
  return Object.freeze(normalized);
}

const environment: readonly (readonly [keyof DemoLimits, string, number, number, number])[] = [
  ['databaseBytes', 'STUDIO_MAX_DATABASE_MB', 1, 4_096, 1_048_576],
  ['projects', 'STUDIO_MAX_PROJECTS', 1, 100_000, 1],
  ['projectsPerOwner', 'STUDIO_MAX_PROJECTS_PER_OWNER', 1, 1_000, 1],
  ['versionsPerProject', 'STUDIO_MAX_VERSIONS', 1, 10_000, 1],
  ['historyPerProject', 'STUDIO_MAX_HISTORY', 1, 1_000_000, 1],
  ['connections', 'STUDIO_MAX_CONNECTIONS', 1, 10_000, 1],
  ['connectionsPerUser', 'STUDIO_MAX_CONNECTIONS_PER_USER', 1, 100, 1],
  ['aiRequestsPerDay', 'STUDIO_AI_DAILY_REQUESTS', 0, 100_000, 1],
  ['aiRequestsPerUserPerDay', 'STUDIO_AI_USER_DAILY_REQUESTS', 0, 10_000, 1],
  ['aiConcurrent', 'STUDIO_AI_CONCURRENT', 1, 100, 1],
];

export function limitsFromEnv(env: Record<string, string | undefined>): DemoLimits {
  const overrides: Partial<Record<keyof DemoLimits, number>> = {};
  for (const [field, name, minimum, maximum, multiplier] of environment) {
    const input = env[name];
    if (input === undefined || input === '') continue;
    const value = Number(input);
    if (typeof input !== 'string' || /[^0-9]/.test(input) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be a decimal integer from ${minimum} to ${maximum}.`);
    }
    overrides[field] = value * multiplier;
  }
  return resolveDemoLimits(overrides);
}

export class LimitError extends Error {
  constructor(message: string, readonly code = 'DEMO_CAPACITY', readonly status = 429) {
    super(message);
    this.name = 'LimitError';
  }
}
