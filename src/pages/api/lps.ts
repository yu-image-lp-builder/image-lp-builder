/**
 * /api/lps
 *
 * GET  -> list LPs (paginated)
 * POST -> create a new LP as a draft
 *
 * Authentication is enforced by middleware. Both methods require an
 * authenticated user (owner or editor).
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries, generateId } from '../../lib/db';
import { success, errors } from '../../lib/api';
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from '../../lib/slugs';

export const prerender = false;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export const GET: APIRoute = async ({ url, locals }) => {
  if (!env?.DB) {
    return errors.internalError('Database not configured');
  }

  const workspaceId = locals.workspace_id;
  const limit = Math.min(
    parsePositiveInt(url.searchParams.get('limit'), DEFAULT_LIMIT),
    MAX_LIMIT
  );
  const offset = parsePositiveInt(url.searchParams.get('offset'), 0);

  try {
    const [pages, total] = await Promise.all([
      pageQueries.listAll(env.DB, workspaceId, { limit, offset }),
      pageQueries.countAll(env.DB, workspaceId),
    ]);

    return success({
      pages,
      pagination: { total, limit, offset },
    });
  } catch (err) {
    console.error('GET /api/lps failed:', err);
    return errors.internalError('Failed to list LPs');
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) {
    return errors.internalError('Database not configured');
  }

  const workspaceId = locals.workspace_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('リクエストの形式が不正です(JSON 形式を指定してください)');
  }

  if (typeof body !== 'object' || body === null) {
    return errors.validationError('リクエストの形式が不正です(オブジェクトを指定してください)');
  }

  const rawSlug = (body as { slug?: unknown }).slug;
  if (typeof rawSlug !== 'string') {
    return errors.validationError('URL末尾(slug)を入力してください', {
      field: 'slug',
    });
  }

  const slug = rawSlug.trim().toLowerCase();

  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return errors.validationError(
      `URL末尾(slug)は ${SLUG_MIN_LENGTH}〜${SLUG_MAX_LENGTH} 文字で入力してください`,
      { field: 'slug' }
    );
  }

  if (!SLUG_PATTERN.test(slug)) {
    return errors.validationError(
      'URL末尾(slug)は半角英数字とハイフンのみ使えます(先頭・末尾はハイフン不可)',
      { field: 'slug' }
    );
  }

  if (RESERVED_SLUGS.has(slug)) {
    return errors.validationError(
      `「${slug}」は予約語のため使えません。別の名前を入力してください`,
      { field: 'slug' }
    );
  }

  try {
    if (await pageQueries.existsBySlug(env.DB, slug)) {
      return errors.validationError(
        `「${slug}」というURL末尾は既に使われています。別の名前を入力してください`,
        { field: 'slug' }
      );
    }

    const created = await pageQueries.create(env.DB, workspaceId, {
      id: generateId(),
      slug,
    });

    return success(created, 201);
  } catch (err) {
    console.error('POST /api/lps failed:', err);
    return errors.internalError('Failed to create LP');
  }
};
