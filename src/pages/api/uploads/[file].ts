/**
 * DELETE /api/uploads/<id>.<ext>
 *
 * Removes an uploaded image from R2. Used by the section archive
 * "完全削除" flow — the only path in the admin that physically
 * destroys a stored image.
 *
 * The path parameter is the filename portion of the public image
 * URL (`/img/<id>.<ext>`). The handler maps it back to the R2 key
 * (`images/<id>.<ext>`).
 *
 * Authentication is enforced by middleware. Any authenticated user
 * can delete any image — there's no per-user upload attribution in
 * the current schema.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { success, errors } from '../../../lib/api';

export const prerender = false;

// Mirror upload.ts. Path-traversal defence: reject anything that's
// not a UUID-looking id followed by a known extension.
const FILE_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(webp|png|jpg)$/;

export const DELETE: APIRoute = async ({ params }) => {
  if (!env?.BUCKET) {
    return errors.internalError('Storage not configured');
  }

  const file = params.file;
  if (typeof file !== 'string' || !FILE_PATTERN.test(file)) {
    return errors.validationError('Invalid file name', { field: 'file' });
  }

  const key = `images/${file}`;

  try {
    await env.BUCKET.delete(key);
  } catch (err) {
    console.error('R2 delete failed:', err);
    return errors.internalError('Failed to delete image');
  }

  return success({ deleted: key });
};
