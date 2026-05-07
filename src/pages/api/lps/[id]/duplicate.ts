/**
 * POST /api/lps/:id/duplicate
 *
 * Clone an LP into a fresh draft. Body: `{ slug: string }`.
 *
 * Carries over the structural / visual side of the source LP
 * (sections + CTAs + promotions + max_width + background_color +
 * frame_style) and resets every operational field — see
 * pageQueries.duplicate for the exact split.
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries, generateId } from '../../../../lib/db';
import { success, errors } from '../../../../lib/api';
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from '../../../../lib/slugs';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

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
    return errors.validationError('複製先のURL末尾(slug)を入力してください', {
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
    const source = await pageQueries.findById(env.DB, workspaceId, id);
    if (!source) return errors.notFound(`複製元のLPが見つかりませんでした`);

    if (await pageQueries.existsBySlug(env.DB, slug)) {
      return errors.validationError(
        `「${slug}」というURL末尾は既に使われています。別の名前を入力してください`,
        { field: 'slug' }
      );
    }

    const duplicated = await pageQueries.duplicate(env.DB, workspaceId, id, {
      id: generateId(),
      slug,
    });
    if (!duplicated) {
      return errors.internalError('Failed to duplicate LP');
    }

    return success(duplicated, 201);
  } catch (err) {
    console.error(`POST /api/lps/${id}/duplicate failed:`, err);
    return errors.internalError('Failed to duplicate LP');
  }
};
