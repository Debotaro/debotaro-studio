import type { DesignTokens } from './types';

const tokenReference = /^\$(primitive|semantic)\.([A-Za-z][A-Za-z0-9_-]{0,63})$/;

/** Resolve aliases without accepting arbitrary CSS expressions or executing input. */
export function resolveToken(tokens: DesignTokens, value: string | number): string | number {
  const visited = new Set<string>();
  let resolved = value;
  while (typeof resolved === 'string' && resolved.startsWith('$')) {
    const match = tokenReference.exec(resolved);
    if (!match) throw new Error(`Invalid token reference "${resolved}". Expected $semantic.name or $primitive.name.`);
    if (visited.has(resolved)) throw new Error(`Token reference cycle: ${[...visited, resolved].join(' → ')}.`);
    visited.add(resolved);
    const category = match[1] as keyof DesignTokens;
    const name = match[2];
    if (!Object.hasOwn(tokens[category], name)) throw new Error(`Missing token ${resolved}.`);
    resolved = tokens[category][name];
  }
  return resolved;
}

export function isTokenReference(value: unknown): value is string {
  return typeof value === 'string' && tokenReference.test(value);
}

/** Numeric fields accept finite numbers or aliases, never CSS/string-number coercion. */
export function resolveNumericToken(tokens: DesignTokens, value: number | string): number {
  const resolved = resolveToken(tokens, value);
  if (typeof resolved !== 'number' || !Number.isFinite(resolved)) {
    throw new Error(`Value "${String(value)}" must resolve to a finite number; color tokens, numeric strings and CSS expressions are not numeric values.`);
  }
  return resolved;
}

/** Shared defaults use primitive values plus semantic aliases; themes change aliases. */
export function createDefaultTokens(theme: 'light' | 'dark' = 'light'): DesignTokens {
  return {
    primitive: {
      white: '#ffffff', ink: '#18202f', muted: '#657084', violet: '#6d4aff',
      violetSoft: '#f0ecff', canvas: '#f5f6fa', line: '#e4e7ef', green: '#23734e',
      night: '#171a24', nightSurface: '#222635', nightText: '#f2f4fa', nightMuted: '#acb4c7',
      nightLine: '#383e51', radius: 12, space: 8,
    },
    semantic: {
      background: theme === 'dark' ? '$primitive.night' : '$primitive.canvas',
      surface: theme === 'dark' ? '$primitive.nightSurface' : '$primitive.white',
      text: theme === 'dark' ? '$primitive.nightText' : '$primitive.ink',
      muted: theme === 'dark' ? '$primitive.nightMuted' : '$primitive.muted',
      border: theme === 'dark' ? '$primitive.nightLine' : '$primitive.line',
      accent: '$primitive.violet', accentSoft: '$primitive.violetSoft', onAccent: '$primitive.white',
      success: '$primitive.green',
    },
  };
}
