export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 1;
export const SLUG_MAX_LENGTH = 100;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'go',
  'mcp',
  'preview',
  '404',
  '_astro',
  'public',
  'lp',
  'line',
  'form',
  'instagram',
  'x',
  'note',
  'hp',
  'dashboard',
  'onboarding',
]);
