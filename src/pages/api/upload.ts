/**
 * POST /api/upload
 *
 * Receives an image as multipart/form-data and stores it in R2.
 *
 * The client is responsible for converting the image to WebP before
 * upload (the server doesn't decode/transcode — that would be too
 * expensive in a Worker). The client also sends image dimensions
 * so the server doesn't have to decode the file.
 *
 * Returns the public URL (served via /img/:key) along with the R2
 * key, dimensions, size, and content type.
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { success, errors } from '../../lib/api';

export const prerender = false;

const MAX_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

function parseDimension(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 100000) return null;
  return Math.round(value);
}

export const POST: APIRoute = async ({ request }) => {
  if (!env?.BUCKET) {
    return errors.internalError('Storage not configured');
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errors.validationError(
      'リクエストの形式が不正です(multipart/form-data で送信してください)'
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return errors.validationError('画像ファイルを選択してください', {
      field: 'file',
    });
  }

  if (file.size === 0) {
    return errors.validationError('ファイルが空です', { field: 'file' });
  }

  if (file.size > MAX_SIZE) {
    const mb = Math.round((MAX_SIZE / 1024 / 1024) * 10) / 10;
    return errors.validationError(
      `ファイルサイズが大きすぎます(上限 ${mb}MB)`,
      { field: 'file', size: file.size, maxSize: MAX_SIZE }
    );
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return errors.validationError(
      `この形式の画像はアップロードできません(${file.type})。対応形式: ${Object.keys(ALLOWED_TYPES).join(', ')}`,
      { field: 'file', contentType: file.type }
    );
  }

  const width = parseDimension(formData.get('width'));
  const height = parseDimension(formData.get('height'));
  if (width === null) {
    return errors.validationError(
      '画像の幅を取得できませんでした。再度お試しください',
      { field: 'width' }
    );
  }
  if (height === null) {
    return errors.validationError(
      '画像の高さを取得できませんでした。再度お試しください',
      { field: 'height' }
    );
  }

  const id = crypto.randomUUID();
  const key = `images/${id}.${ext}`;

  try {
    await env.BUCKET.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
  } catch (err) {
    console.error('R2 put failed:', err);
    return errors.internalError('Failed to store image');
  }

  return success(
    {
      url: `/img/${id}.${ext}`,
      key,
      width,
      height,
      size: file.size,
      contentType: file.type,
    },
    201
  );
};
