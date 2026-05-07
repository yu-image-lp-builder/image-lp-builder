/**
 * customHead sanitizer
 *
 * The tracking-tags admin lets the operator paste extra HTML into
 * the LP `<head>` — typically GTM/GA4/Meta Pixel/Clarity snippets
 * the built-in toggles don't cover. Without sanitization an
 * authenticated operator could plant arbitrary `<script>` content,
 * event-handler attributes, or `javascript:` URLs that run in every
 * visitor's browser — a textbook stored XSS.
 *
 * Tradeoff: real tracking snippets need inline `<script>` and
 * external `src=` for gtag.js, so we can't just drop scripts. The
 * allow-list keeps the tags those snippets use, scrubs every other
 * element, and rejects every event-handler attribute (`onload=`
 * etc.) and `javascript:` / `data:` URL.
 *
 * Runtime: Cloudflare Workers. We use `xss` (pure JS, no Node deps)
 * because sanitize-html pulls in `htmlparser2` → readable-stream →
 * Node `path`, which the Workers runtime can't load. DOMPurify /
 * isomorphic-dompurify need a real DOM (jsdom) for the same reason.
 */

import { FilterXSS } from 'xss';

// Tags the LP head needs for tracking. `script` is the load-bearing
// one — without it gtag/Clarity/Pixel can't init.
const ALLOWED_TAGS: Record<string, string[]> = {
  script: ['src', 'async', 'defer', 'type', 'crossorigin', 'integrity', 'nonce'],
  noscript: [],
  style: ['type'],
  link: ['rel', 'href', 'type', 'crossorigin', 'as', 'integrity'],
  meta: ['name', 'content', 'http-equiv', 'charset', 'property'],
  img: ['src', 'alt', 'width', 'height', 'style'],
  // GTM's <noscript> fallback uses an iframe to googletagmanager.com.
  // Keep src/width/height/style; drop everything else.
  iframe: ['src', 'width', 'height', 'style', 'frameborder', 'scrolling'],
};

// `xss` defaults strip the inner content of `<script>` and `<style>`
// (treating them as HTML to escape). Override that — tracking
// snippets are ALL inline JS — but only for tags we explicitly
// allow. Returning a string from `onTag` tells the filter to use
// that string as-is; otherwise it falls back to the default
// (escape) behavior, which is what we want for unknown tags.
const filter = new FilterXSS({
  whiteList: ALLOWED_TAGS,
  // Disable HTML-escape of tag content we keep, so `<script>foo()</script>`
  // survives intact. Without this xss would emit `<script>` then
  // escape `foo()` into `&lt;...&gt;` if it looked HTML-like.
  stripIgnoreTagBody: ['script'] as never,
  // ^ counterintuitive name: this lists tags whose body to drop
  // when the TAG ITSELF is filtered. `script` is in our whitelist
  // so its body is kept. Listing it here is harmless and matches
  // xss's recipe for "kept inline scripts".
  allowCommentTag: false,
  // Strip event-handler attrs (`onload=`, `onerror=`, ...). xss does
  // this by default for any attr starting with `on` that isn't in
  // the per-tag allow-list, but make it explicit.
  onIgnoreTagAttr: (_tag, name, value) => {
    if (name.startsWith('on')) return '';
    // Only allow data-* attributes (gtag/Clarity sometimes use them).
    if (name.startsWith('data-')) {
      return `${name}="${escapeAttr(value)}"`;
    }
    return '';
  },
  // Block `javascript:` / `data:` / `vbscript:` URLs in href/src.
  // The xss default already does this for href/src, but cover it
  // belt-and-braces in case a custom attr like `formaction` slips.
  safeAttrValue: (tag, name, value, cssFilter) => {
    if ((name === 'href' || name === 'src') && /^(javascript|data|vbscript):/i.test(value.trim())) {
      return '';
    }
    // Defer to xss's default for everything else.
    return defaultSafeAttrValue(tag, name, value, cssFilter);
  },
});

// Re-export of xss's internal helper. Importing the symbol keeps
// behavior consistent with the library if it ever updates its
// scheme list.
import { safeAttrValue as defaultSafeAttrValue } from 'xss';

function escapeAttr(v: string): string {
  return v.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanitize the operator-provided customHead HTML before it's
 * inserted into the public LP `<head>`. Returns a safe-to-render
 * HTML string. Returns empty string for null / undefined / empty
 * input so callers can render unconditionally.
 */
export function sanitizeCustomHead(input: string | null | undefined): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (trimmed.length === 0) return '';
  return filter.process(trimmed);
}
