/**
 * /api/mcp-tokens
 *
 * GET  -> list tokens (id, label, prefix, created_at, last_used_at, revoked_at)
 * POST -> issue a new token; the *only* time the raw token is returned
 *
 * The raw token is shown once on POST and is not retrievable afterward
 * (only its SHA-256 hash is stored). Same flow as GitHub PATs.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  generateId,
  generateMcpToken,
  hashMcpToken,
  mcpTokenQueries,
} from '../../lib/db';
import { errors, success } from '../../lib/api';

export const prerender = false;

const TOKEN_PREFIX_LENGTH = 8;

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  try {
    const tokens = await mcpTokenQueries.list(env.DB, workspaceId);
    return success({
      tokens: tokens.map((t) => ({
        id: t.id,
        label: t.label,
        prefix: t.token_prefix,
        createdAt: t.created_at,
        lastUsedAt: t.last_used_at,
        revokedAt: t.revoked_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/mcp-tokens failed:', err);
    return errors.internalError('Failed to list MCP tokens');
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Body must be a JSON object');
  }

  const rawLabel = (body as { label?: unknown }).label;
  if (typeof rawLabel !== 'string') {
    return errors.validationError('`label` is required and must be a string', {
      field: 'label',
    });
  }
  const label = rawLabel.trim();
  if (label.length === 0 || label.length > 100) {
    return errors.validationError('`label` must be 1-100 characters', {
      field: 'label',
    });
  }

  try {
    const raw = generateMcpToken();
    const tokenHash = await hashMcpToken(raw);
    const tokenPrefix = raw.slice(0, TOKEN_PREFIX_LENGTH);

    const created = await mcpTokenQueries.create(env.DB, workspaceId, {
      id: generateId(),
      label,
      tokenHash,
      tokenPrefix,
    });

    return success(
      {
        token: {
          id: created.id,
          label: created.label,
          prefix: created.token_prefix,
          createdAt: created.created_at,
          lastUsedAt: created.last_used_at,
          revokedAt: created.revoked_at,
        },
        rawToken: raw,
      },
      201
    );
  } catch (err) {
    console.error('POST /api/mcp-tokens failed:', err);
    return errors.internalError('Failed to create MCP token');
  }
};
