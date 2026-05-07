/**
 * /api/site-settings
 *
 * GET -> read the singleton site_settings row
 * PUT -> partial update (currently: maintenance_mode flag)
 *
 * Authenticated by the standard /api/* middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { siteSettingsQueries } from '../../lib/db';
import { errors, success } from '../../lib/api';

export const prerender = false;

export const GET: APIRoute = async () => {
  if (!env?.DB) return errors.internalError('Database not configured');
  try {
    const settings = await siteSettingsQueries.get(env.DB);
    return success({
      maintenanceMode: settings.maintenance_mode === 1,
      updatedAt: settings.updated_at,
    });
  } catch (err) {
    console.error('GET /api/site-settings failed:', err);
    return errors.internalError('Failed to load site settings');
  }
};

export const PUT: APIRoute = async ({ request }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Body must be a JSON object');
  }
  const obj = body as Record<string, unknown>;

  if (obj.maintenanceMode !== undefined) {
    if (typeof obj.maintenanceMode !== 'boolean') {
      return errors.validationError('`maintenanceMode` must be a boolean', {
        field: 'maintenanceMode',
      });
    }
    try {
      const updated = await siteSettingsQueries.setMaintenanceMode(
        env.DB,
        obj.maintenanceMode
      );
      return success({
        maintenanceMode: updated.maintenance_mode === 1,
        updatedAt: updated.updated_at,
      });
    } catch (err) {
      console.error('PUT /api/site-settings failed:', err);
      return errors.internalError('Failed to update site settings');
    }
  }

  return errors.validationError('No supported fields in request body');
};
