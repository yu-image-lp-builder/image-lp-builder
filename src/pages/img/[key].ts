/**
 * GET /img/:key
 *
 * Public endpoint that streams an image from R2.
 *
 * Authentication is intentionally not required — these URLs are
 * embedded in published LPs and need to be reachable by anyone.
 *
 * The Worker proxies R2 here for two reasons:
 * 1. R2 public access is an opt-in setting on the bucket, and we
 *    want a one-click Deploy with no extra configuration.
 * 2. Going through the Worker lets us add caching / variants /
 *    transformations without changing the URL shape.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

const ETAG_NONE = 'If-None-Match';
const CACHE_HEADER = 'public, max-age=31536000, immutable';

export const GET: APIRoute = async ({ params, request }) => {
  if (!env?.BUCKET) {
    return new Response('Storage not configured', { status: 500 });
  }

  const key = params.key;
  if (typeof key !== 'string' || key.length === 0) {
    return new Response('Not Found', { status: 404 });
  }

  // Reject anything that tries to escape the images/ prefix.
  if (key.includes('/') || key.includes('..')) {
    return new Response('Not Found', { status: 404 });
  }

  const objectKey = `images/${key}`;
  const ifNoneMatch = request.headers.get(ETAG_NONE);

  let object;
  try {
    object = await env.BUCKET.get(objectKey);
  } catch (err) {
    console.error(`R2 get failed for ${objectKey}:`, err);
    return new Response('Internal Error', { status: 500 });
  }

  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
    // Drain the body so the underlying stream isn't left open.
    object.body?.cancel();
    return new Response(null, {
      status: 304,
      headers: { ETag: object.httpEtag, 'Cache-Control': CACHE_HEADER },
    });
  }

  const headers = new Headers();
  headers.set(
    'Content-Type',
    object.httpMetadata?.contentType ?? 'application/octet-stream'
  );
  headers.set('Cache-Control', CACHE_HEADER);
  headers.set('ETag', object.httpEtag);
  if (object.size) {
    headers.set('Content-Length', String(object.size));
  }

  return new Response(object.body, { status: 200, headers });
};
