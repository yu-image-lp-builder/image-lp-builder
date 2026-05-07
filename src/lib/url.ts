/**
 * URL helpers
 *
 * og:image and similar metadata fields must be absolute URLs to be
 * usable by Facebook / Twitter / Slack / LINE crawlers — they don't
 * resolve relative paths against the origin reliably. Internal URLs
 * (/img/xxx.webp) are stored relative so the value survives domain
 * changes; we promote them to absolute at render time.
 */

export function toAbsoluteUrl(
  value: string | undefined,
  base: URL | string
): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

// XSS-prone schemes (`javascript:`, `data:`, `vbscript:`, `file:`)
// that must never reach an `href` we render — they execute in the
// visitor's browser. The allow-list is intentionally narrow: image
// LPs only need https/http (external destinations), tel/mailto
// (CTA dialer / mailer), and same-origin relative paths.
const ABSOLUTE_URL_SCHEMES = ['http:', 'https:', 'tel:', 'mailto:'] as const;

export type UrlKind = 'absolute' | 'relative-or-absolute';

interface UrlCheckOptions {
  /**
   * `absolute` — must start with one of the allowed schemes.
   * `relative-or-absolute` — also allows `/path` style values that
   *   resolve against the current origin (used by MyLink, where
   *   internal short links like `/go/abc` are valid).
   */
  kind?: UrlKind;
}

/**
 * Validate that a URL string uses an allowed scheme. Returns null
 * when ok, an error message string when not. Trims whitespace before
 * checking so callers don't have to.
 */
export function validateUrlScheme(
  value: string,
  options: UrlCheckOptions = {}
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'URL を入力してください';

  const { kind = 'relative-or-absolute' } = options;

  // Relative path like `/go/abc` is fine for `relative-or-absolute`.
  // Reject protocol-relative URLs (`//evil.com`) outright — they
  // inherit the current scheme and bypass the allow-list.
  if (trimmed.startsWith('//')) {
    return 'URL の形式が不正です(// で始まる URL は使えません)';
  }
  if (kind === 'relative-or-absolute' && trimmed.startsWith('/')) {
    return null;
  }

  let parsed: URL;
  try {
    // Pass a base so bare hosts like `example.com` (without a scheme)
    // don't accidentally become absolute. We *want* those rejected.
    parsed = new URL(trimmed);
  } catch {
    return 'URL の形式が不正です(http:// や https:// で始まる URL を入力してください)';
  }

  if (!ABSOLUTE_URL_SCHEMES.includes(parsed.protocol as (typeof ABSOLUTE_URL_SCHEMES)[number])) {
    return `この種類の URL は使えません(対応: ${ABSOLUTE_URL_SCHEMES.join(' / ')})`;
  }
  return null;
}
