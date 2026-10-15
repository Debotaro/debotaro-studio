import { describe, expect, it } from 'vitest';
import { DEFAULT_DEMO_LIMITS, LimitError, limitsFromEnv, resolveDemoLimits, type DemoLimits } from '../../server/limits';

describe('demo capacity policy normalization', () => {
  it('uses the documented bounded defaults and does not reuse mutable caller state', () => {
    expect(DEFAULT_DEMO_LIMITS).toEqual({
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
    const input = { projects: 12 };
    const limits = resolveDemoLimits(input);
    input.projects = 30;
    expect(limits.projects).toBe(12);
    expect(limits.historyPerProject).toBe(10_000);
    expect(DEFAULT_DEMO_LIMITS.projects).toBe(1_000);
    expect(resolveDemoLimits()).not.toBe(DEFAULT_DEMO_LIMITS);
    expect(Object.isFrozen(limits)).toBe(true);
    expect(Object.isFrozen(DEFAULT_DEMO_LIMITS)).toBe(true);
    expect(() => { Object.assign(limits, { projects: 99 }); }).toThrow(TypeError);
    expect(() => { Object.assign(DEFAULT_DEMO_LIMITS, { projects: 99 }); }).toThrow(TypeError);
  });

  it.each<[keyof DemoLimits, number, number]>([
    ['databaseBytes', 65_536, 4_294_967_296],
    ['projects', 1, 100_000],
    ['projectsPerOwner', 1, 1_000],
    ['versionsPerProject', 1, 10_000],
    ['historyPerProject', 1, 1_000_000],
    ['connections', 1, 10_000],
    ['connectionsPerUser', 1, 100],
    ['aiRequestsPerDay', 0, 100_000],
    ['aiRequestsPerUserPerDay', 0, 10_000],
    ['aiConcurrent', 1, 100],
  ])('bounds %s without clamping or silently falling back', (field, minimum, maximum) => {
    expect(resolveDemoLimits({ [field]: minimum })[field]).toBe(minimum);
    expect(resolveDemoLimits({ [field]: maximum })[field]).toBe(maximum);
    expect(() => resolveDemoLimits({ [field]: minimum - 1 })).toThrow(field);
    expect(() => resolveDemoLimits({ [field]: maximum + 1 })).toThrow(field);
  });

  it.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '2', undefined, null, true])('rejects non-integer or mistyped overrides %s', value => {
    expect(() => resolveDemoLimits({ projects: value } as Partial<DemoLimits>)).toThrow('projects');
  });

  it('allows either daily AI allowance to be zero without disabling unrelated capabilities', () => {
    const globalOff = resolveDemoLimits({ aiRequestsPerDay: 0 });
    const userOff = resolveDemoLimits({ aiRequestsPerUserPerDay: 0 });
    expect(globalOff.aiRequestsPerDay).toBe(0);
    expect(globalOff.aiRequestsPerUserPerDay).toBe(10);
    expect(userOff.aiRequestsPerUserPerDay).toBe(0);
    expect(userOff.aiRequestsPerDay).toBe(100);
    expect(globalOff.aiConcurrent).toBe(2);
    expect(globalOff.projects).toBe(1_000);
  });

  it('rejects unknown keys including non-enumerable and symbol keys', () => {
    expect(() => resolveDemoLimits({ projects: 2, project: 3 } as Partial<DemoLimits>)).toThrow('unknown');
    expect(() => resolveDemoLimits(Object.defineProperty({}, 'unrecognized', { value: 1 }))).toThrow('unknown');
    expect(() => resolveDemoLimits({ [Symbol('projects')]: 1 } as Partial<DemoLimits>)).toThrow('unknown');
    expect(() => resolveDemoLimits({ constructor: 3 } as Partial<DemoLimits>)).toThrow('unknown');
  });

  it('refuses getters without executing configuration accessors', () => {
    let evaluated = false;
    const input = Object.defineProperty({}, 'projects', { get() { evaluated = true; return 12; } });
    expect(() => resolveDemoLimits(input)).toThrow('projects');
    expect(evaluated).toBe(false);
  });

  it('accepts null-prototype records but refuses object shapes that hide inherited settings', () => {
    const record = Object.create(null) as { projects: number };
    record.projects = 3;
    expect(resolveDemoLimits(record).projects).toBe(3);
    expect(() => resolveDemoLimits(Object.create({ projects: 3 }))).toThrow('plain object');
    for (const input of [null, 1, 'policy', [], new Date()]) {
      expect(() => resolveDemoLimits(input as Partial<DemoLimits>)).toThrow('object');
    }
  });
});

describe('environment demo policy', () => {
  it('uses defaults for unset/empty values and ignores unrelated environment variables', () => {
    const limits = limitsFromEnv({ STUDIO_MAX_PROJECTS: '', STUDIO_AI_CONCURRENT: undefined, PORT: '4173', OPENAI_API_KEY: 'not-a-real-key' });
    expect(limits).toEqual(DEFAULT_DEMO_LIMITS);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it('maps every documented variable including integer MiB to immutable bytes', () => {
    const limits = limitsFromEnv({
      STUDIO_MAX_DATABASE_MB: '64',
      STUDIO_MAX_PROJECTS: '321',
      STUDIO_MAX_PROJECTS_PER_OWNER: '12',
      STUDIO_MAX_VERSIONS: '23',
      STUDIO_MAX_HISTORY: '1234',
      STUDIO_MAX_CONNECTIONS: '32',
      STUDIO_MAX_CONNECTIONS_PER_USER: '3',
      STUDIO_AI_DAILY_REQUESTS: '45',
      STUDIO_AI_USER_DAILY_REQUESTS: '4',
      STUDIO_AI_CONCURRENT: '1',
    });
    expect(limits).toEqual({ databaseBytes: 67_108_864, projects: 321, projectsPerOwner: 12, versionsPerProject: 23, historyPerProject: 1234, connections: 32, connectionsPerUser: 3, aiRequestsPerDay: 45, aiRequestsPerUserPerDay: 4, aiConcurrent: 1 });
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it('permits leading-zero decimal values and explicitly disabled AI', () => {
    const limits = limitsFromEnv({ STUDIO_MAX_PROJECTS: '0002', STUDIO_AI_DAILY_REQUESTS: '0', STUDIO_AI_USER_DAILY_REQUESTS: '000' });
    expect(limits.projects).toBe(2);
    expect(limits.aiRequestsPerDay).toBe(0);
    expect(limits.aiRequestsPerUserPerDay).toBe(0);
  });

  it.each([' ', '\t', '\n', '2\n', '\n2', ' 2', '2 ', '+2', '-2', '-0', '2.0', '.2', '2e1', '0x20', 'Infinity', 'NaN', '9007199254740992', '100001'])('fails startup rather than silently accepting %j', input => {
    expect(() => limitsFromEnv({ STUDIO_MAX_PROJECTS: input })).toThrow('STUDIO_MAX_PROJECTS');
  });

  it('enforces environment-specific database units and all capacity ranges', () => {
    expect(limitsFromEnv({ STUDIO_MAX_DATABASE_MB: '1' }).databaseBytes).toBe(1_048_576);
    expect(limitsFromEnv({ STUDIO_MAX_DATABASE_MB: '4096' }).databaseBytes).toBe(4_294_967_296);
    for (const input of ['0', '0.0625', '4097']) {
      expect(() => limitsFromEnv({ STUDIO_MAX_DATABASE_MB: input })).toThrow('STUDIO_MAX_DATABASE_MB');
    }
    for (const [name, input] of [
      ['STUDIO_MAX_PROJECTS_PER_OWNER', '1001'], ['STUDIO_MAX_VERSIONS', '10001'],
      ['STUDIO_MAX_HISTORY', '1000001'], ['STUDIO_MAX_CONNECTIONS', '10001'],
      ['STUDIO_MAX_CONNECTIONS_PER_USER', '101'], ['STUDIO_AI_DAILY_REQUESTS', '100001'],
      ['STUDIO_AI_USER_DAILY_REQUESTS', '10001'], ['STUDIO_AI_CONCURRENT', '0'],
    ]) expect(() => limitsFromEnv({ [name]: input })).toThrow(name);
  });
});

describe('capacity errors', () => {
  it('retains actionable message, default capacity status and machine code', () => {
    const error = new LimitError('This demo has reached its project limit.');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LimitError');
    expect(error.message).toBe('This demo has reached its project limit.');
    expect(error.status).toBe(429);
    expect(error.code).toBe('DEMO_CAPACITY');
    const full = new LimitError('Storage is full; preserve and back up existing data.', 'DEMO_STORAGE', 507);
    expect(full.status).toBe(507);
    expect(full.code).toBe('DEMO_STORAGE');
  });
});
