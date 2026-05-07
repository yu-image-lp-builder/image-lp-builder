/**
 * MCP tool registry.
 *
 * Each tool declares an input schema (JSON Schema), a required
 * permission level (read / write / delete), and a handler. The
 * dispatcher in /mcp consults `mcp_settings.mode` and rejects calls
 * that exceed the current mode.
 *
 * Mode → allowed permissions:
 * - read_only:      read
 * - edit_no_delete: read + write
 * - edit_full:      read + write + delete
 */

import {
  generateId,
  myLinkQueries,
  pageQueries,
  type McpMode,
} from '../db';
import {
  parseContent,
  validateContentInput,
  type PageContent,
  type Promotions,
} from '../content';
import { readAbMeta } from '../ab-test';

export type McpPermission = 'read' | 'write' | 'delete';

export type McpToolContext = {
  db: D1Database;
  /**
   * Workspace the bearer token is bound to (read off the mcp_tokens
   * row at auth time). All db queries scope through this so a token
   * issued for workspace A can never read or mutate workspace B.
   */
  workspaceId: string;
};

export type McpToolHandlerResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string; details?: unknown };

export type McpTool = {
  name: string;
  description: string;
  permission: McpPermission;
  inputSchema: Record<string, unknown>;
  handler: (
    params: Record<string, unknown>,
    ctx: McpToolContext
  ) => Promise<McpToolHandlerResult>;
};

/**
 * Tools allowed under a given mode, in the order they should be
 * surfaced to the client (read first, then write, then delete).
 */
export function permissionAllowedByMode(
  mode: McpMode,
  permission: McpPermission
): boolean {
  switch (mode) {
    case 'read_only':
      return permission === 'read';
    case 'edit_no_delete':
      return permission === 'read' || permission === 'write';
    case 'edit_full':
      return true;
  }
}

/**
 * Lightweight string-field validator used by every tool. Returns the
 * trimmed string, or null + an error message ready for the failure
 * branch of `McpToolHandlerResult`.
 */
function requireString(
  params: Record<string, unknown>,
  field: string,
  options: { maxLength?: number; allowEmpty?: boolean } = {}
): { ok: true; value: string } | { ok: false; message: string } {
  const raw = params[field];
  if (typeof raw !== 'string') {
    return { ok: false, message: `\`${field}\` must be a string` };
  }
  const trimmed = options.allowEmpty ? raw : raw.trim();
  if (!options.allowEmpty && trimmed.length === 0) {
    return { ok: false, message: `\`${field}\` must not be empty` };
  }
  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    return {
      ok: false,
      message: `\`${field}\` must be at most ${options.maxLength} characters`,
    };
  }
  return { ok: true, value: trimmed };
}

function optionalString(
  params: Record<string, unknown>,
  field: string,
  maxLength?: number
): { ok: true; value: string | undefined } | { ok: false; message: string } {
  const raw = params[field];
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: `\`${field}\` must be a string when provided` };
  }
  const trimmed = raw.trim();
  if (maxLength !== undefined && trimmed.length > maxLength) {
    return {
      ok: false,
      message: `\`${field}\` must be at most ${maxLength} characters`,
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Read the current content JSON for a page, returning an empty
 * content shell when the page exists but has never had content saved
 * (newly created LP).
 */
async function loadPageContent(
  db: D1Database,
  workspaceId: string,
  pageId: string
): Promise<{ ok: true; content: PageContent } | { ok: false; message: string }> {
  const page = await pageQueries.findById(db, workspaceId, pageId);
  if (!page) {
    return { ok: false, message: `LP \`${pageId}\` not found` };
  }
  return { ok: true, content: parseContent(page.content) };
}

/**
 * The tool registry. Read tools are plain DB lookups; write tools
 * patch the JSON content blob via pageQueries.updateContent (the
 * same path the admin UI uses).
 */
export const TOOLS: McpTool[] = [
  // -------------------------------------------------------------------
  // READ
  // -------------------------------------------------------------------
  {
    name: 'list_lps',
    description:
      'List landing pages (excluding trash). Returns id, slug, status, page_type, updated_at and parsed metadata for each LP.',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const rawLimit = params.limit;
      const rawOffset = params.offset;
      const limit =
        typeof rawLimit === 'number' && rawLimit > 0
          ? Math.min(Math.floor(rawLimit), 100)
          : 20;
      const offset =
        typeof rawOffset === 'number' && rawOffset >= 0
          ? Math.floor(rawOffset)
          : 0;

      const [pages, total] = await Promise.all([
        pageQueries.listAll(db, workspaceId, { limit, offset }),
        pageQueries.countAll(db, workspaceId),
      ]);

      return {
        ok: true,
        data: {
          pagination: { total, limit, offset },
          pages: pages.map((p) => ({
            id: p.id,
            slug: p.slug,
            status: p.status,
            updated_at: p.updated_at,
            published_at: p.published_at,
            meta: parseContent(p.content).meta ?? null,
          })),
        },
      };
    },
  },

  {
    name: 'get_lp',
    description:
      'Fetch a single landing page by id, including the full parsed content (sections + CTAs).',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const id = requireString(params, 'id');
      if (!id.ok) return { ok: false, message: id.message };

      const page = await pageQueries.findById(db, workspaceId, id.value);
      if (!page) {
        return { ok: false, message: `LP \`${id.value}\` not found` };
      }

      return {
        ok: true,
        data: {
          ...page,
          content: parseContent(page.content),
        },
      };
    },
  },

  {
    name: 'list_variants',
    description:
      'List A/B variants of an LP. Returns each variant with its label, weight, status, and id (use the id with get_lp / update_lp_meta / etc. — variants are regular pages with page_type=ab_variant).',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: { lpId: { type: 'string' } },
      required: ['lpId'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const lpId = requireString(params, 'lpId');
      if (!lpId.ok) return { ok: false, message: lpId.message };

      const variants = await pageQueries.listVariants(
        db,
        workspaceId,
        lpId.value
      );
      return {
        ok: true,
        data: {
          variants: variants.map((v) => {
            const ab = readAbMeta(v, '案');
            return {
              id: v.id,
              status: v.status,
              label: ab.label,
              weight: ab.weight,
              created_at: v.created_at,
              updated_at: v.updated_at,
            };
          }),
        },
      };
    },
  },

  {
    name: 'list_my_links',
    description:
      'List all MyLinks (reusable destinations like LINE URLs or contact emails referenced by CTAs).',
    permission: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (_params, { db, workspaceId }) => {
      const links = await myLinkQueries.list(db, workspaceId);
      return { ok: true, data: { links } };
    },
  },

  // -------------------------------------------------------------------
  // WRITE
  // -------------------------------------------------------------------
  {
    name: 'update_lp_meta',
    description:
      "Update the LP's title / description / ogImage (used in <head> for SEO and social previews). Only fields you pass are touched.",
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        ogImage: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const id = requireString(params, 'id');
      if (!id.ok) return { ok: false, message: id.message };

      const title = optionalString(params, 'title', 200);
      if (!title.ok) return { ok: false, message: title.message };
      const description = optionalString(params, 'description', 500);
      if (!description.ok) return { ok: false, message: description.message };
      const ogImage = optionalString(params, 'ogImage', 2000);
      if (!ogImage.ok) return { ok: false, message: ogImage.message };

      const loaded = await loadPageContent(db, workspaceId, id.value);
      if (!loaded.ok) return { ok: false, message: loaded.message };

      const next: PageContent = {
        ...loaded.content,
        meta: {
          ...(loaded.content.meta ?? {}),
          ...(title.value !== undefined && { title: title.value }),
          ...(description.value !== undefined && { description: description.value }),
          ...(ogImage.value !== undefined && { ogImage: ogImage.value }),
        },
      };

      const updated = await pageQueries.updateContent(
        db,
        workspaceId,
        id.value,
        JSON.stringify(next)
      );
      if (!updated) return { ok: false, message: 'Failed to update LP' };
      return { ok: true, data: { meta: next.meta } };
    },
  },

  {
    name: 'update_promotions',
    description:
      "Update an LP's conversion-boost elements (countdown, scarcity, floating CTA). Pass only the fields you want to change — keys you omit are left untouched. Set a key to null to clear that promotion entirely.",
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        countdown: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                deadline: { type: 'string', description: 'ISO 8601 datetime' },
                label: { type: 'string' },
                expiredText: { type: 'string' },
                position: { type: 'string', enum: ['top', 'bottom'] },
                backgroundColor: { type: 'string' },
                textColor: { type: 'string' },
              },
              required: ['enabled', 'deadline', 'position'],
              additionalProperties: false,
            },
          ],
        },
        scarcity: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                text: { type: 'string' },
                position: { type: 'string', enum: ['top', 'bottom'] },
                backgroundColor: { type: 'string' },
                textColor: { type: 'string' },
              },
              required: ['enabled', 'text', 'position'],
              additionalProperties: false,
            },
          ],
        },
        floatingCta: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                text: { type: 'string' },
                link: {
                  type: 'object',
                  description: 'Same shape as in-section CTA links',
                },
                position: { type: 'string', enum: ['top', 'bottom'] },
                backgroundColor: { type: 'string' },
                textColor: { type: 'string' },
                borderRadius: { type: 'number', minimum: 0 },
                showAfterScrollPercent: {
                  type: 'number',
                  minimum: 0,
                  maximum: 100,
                },
              },
              required: ['enabled', 'text', 'link', 'position'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const id = requireString(params, 'id');
      if (!id.ok) return { ok: false, message: id.message };

      const loaded = await loadPageContent(db, workspaceId, id.value);
      if (!loaded.ok) return { ok: false, message: loaded.message };

      const current: Promotions = loaded.content.promotions ?? {};
      const next: Promotions = { ...current };

      // null clears, undefined skips, object replaces.
      if ('countdown' in params) {
        if (params.countdown === null) {
          delete next.countdown;
        } else if (params.countdown !== undefined) {
          next.countdown = params.countdown as Promotions['countdown'];
        }
      }
      if ('scarcity' in params) {
        if (params.scarcity === null) {
          delete next.scarcity;
        } else if (params.scarcity !== undefined) {
          next.scarcity = params.scarcity as Promotions['scarcity'];
        }
      }
      if ('floatingCta' in params) {
        if (params.floatingCta === null) {
          delete next.floatingCta;
        } else if (params.floatingCta !== undefined) {
          next.floatingCta = params.floatingCta as Promotions['floatingCta'];
        }
      }

      const candidateContent: PageContent = { ...loaded.content, promotions: next };

      // Reuse the same structural validator the PUT /api/lps/:id endpoint
      // uses, so MCP cannot stash content the public renderer would choke on.
      const v = validateContentInput(candidateContent);
      if (!v.ok) {
        return {
          ok: false,
          message: 'promotions failed validation',
          details: { issues: v.errors },
        };
      }

      const updated = await pageQueries.updateContent(
        db,
        workspaceId,
        id.value,
        JSON.stringify(v.content)
      );
      if (!updated) return { ok: false, message: 'Failed to update LP' };
      return { ok: true, data: { promotions: next } };
    },
  },

  {
    name: 'create_variant',
    description:
      'Fork an LP into a new A/B variant. Copies the parent\'s current content as the starting point. Variants begin in draft and must be published (via update_lp_meta or the admin UI) before they enter the distribution.',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        lpId: { type: 'string', description: 'Parent LP id' },
        label: { type: 'string', description: 'Display label, e.g. "案A"' },
        weight: {
          type: 'number',
          minimum: 0,
          description: 'Distribution weight (default 1)',
        },
      },
      required: ['lpId', 'label'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const lpId = requireString(params, 'lpId');
      if (!lpId.ok) return { ok: false, message: lpId.message };
      const label = requireString(params, 'label', { maxLength: 100 });
      if (!label.ok) return { ok: false, message: label.message };

      const rawWeight = params.weight;
      const weight =
        typeof rawWeight === 'number' && rawWeight >= 0 ? rawWeight : 1;

      const parent = await pageQueries.findById(db, workspaceId, lpId.value);
      if (!parent) {
        return { ok: false, message: `LP \`${lpId.value}\` not found` };
      }
      if (parent.page_type !== 'lp') {
        return {
          ok: false,
          message: `\`${lpId.value}\` is a ${parent.page_type}, not a top-level LP`,
        };
      }

      const created = await pageQueries.createVariant(db, workspaceId, {
        id: generateId(),
        parentId: parent.id,
        slug: parent.slug,
        label: label.value,
        weight,
        content: parent.content,
      });
      return {
        ok: true,
        data: {
          variant: {
            id: created.id,
            status: created.status,
            label: label.value,
            weight,
            created_at: created.created_at,
          },
        },
      };
    },
  },

  {
    name: 'update_variant_ab',
    description:
      "Update an A/B variant's label and weight. To change the variant's content (sections, CTAs, etc.) use update_lp_meta / update_section_label / update_promotions on the variant id directly.",
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Variant id' },
        label: { type: 'string' },
        weight: { type: 'number', minimum: 0 },
      },
      required: ['id', 'label', 'weight'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const id = requireString(params, 'id');
      if (!id.ok) return { ok: false, message: id.message };
      const label = requireString(params, 'label', { maxLength: 100 });
      if (!label.ok) return { ok: false, message: label.message };
      const weight =
        typeof params.weight === 'number' && params.weight >= 0
          ? params.weight
          : null;
      if (weight === null) {
        return { ok: false, message: '`weight` must be a non-negative number' };
      }

      const updated = await pageQueries.updateVariantAb(
        db,
        workspaceId,
        id.value,
        {
          label: label.value,
          weight,
        }
      );
      if (!updated) {
        return {
          ok: false,
          message: `Variant \`${id.value}\` not found (or not an A/B variant)`,
        };
      }
      return {
        ok: true,
        data: {
          variant: {
            id: updated.id,
            status: updated.status,
            label: label.value,
            weight,
            updated_at: updated.updated_at,
          },
        },
      };
    },
  },

  {
    name: 'update_section_label',
    description:
      "Update the alt text (accessibility label) of a section's image. Use list_lps + get_lp first to find the section id.",
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        lpId: { type: 'string' },
        sectionId: { type: 'string' },
        alt: { type: 'string' },
      },
      required: ['lpId', 'sectionId', 'alt'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const lpId = requireString(params, 'lpId');
      if (!lpId.ok) return { ok: false, message: lpId.message };
      const sectionId = requireString(params, 'sectionId');
      if (!sectionId.ok) return { ok: false, message: sectionId.message };
      const alt = requireString(params, 'alt', { maxLength: 500, allowEmpty: true });
      if (!alt.ok) return { ok: false, message: alt.message };

      const loaded = await loadPageContent(db, workspaceId, lpId.value);
      if (!loaded.ok) return { ok: false, message: loaded.message };

      const idx = loaded.content.sections.findIndex(
        (s) => s.id === sectionId.value
      );
      if (idx === -1) {
        return {
          ok: false,
          message: `Section \`${sectionId.value}\` not found on LP \`${lpId.value}\``,
        };
      }

      const sections = loaded.content.sections.slice();
      sections[idx] = {
        ...sections[idx],
        image: { ...sections[idx].image, alt: alt.value },
      };
      const next: PageContent = { ...loaded.content, sections };

      const updated = await pageQueries.updateContent(
        db,
        workspaceId,
        lpId.value,
        JSON.stringify(next)
      );
      if (!updated) return { ok: false, message: 'Failed to update section' };
      return { ok: true, data: { section: sections[idx] } };
    },
  },

  {
    name: 'create_my_link',
    description:
      'Create a new MyLink. Returns the created record (including its id, which CTAs can reference).',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['label', 'url'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const label = requireString(params, 'label', { maxLength: 200 });
      if (!label.ok) return { ok: false, message: label.message };
      const url = requireString(params, 'url', { maxLength: 2000 });
      if (!url.ok) return { ok: false, message: url.message };

      const created = await myLinkQueries.create(db, workspaceId, {
        id: generateId(),
        label: label.value,
        url: url.value,
      });
      return { ok: true, data: { link: created } };
    },
  },

  {
    name: 'update_my_link',
    description:
      'Update an existing MyLink by id. Both label and url are required (this is a full replacement, not a patch).',
    permission: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        label: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['id', 'label', 'url'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const id = requireString(params, 'id');
      if (!id.ok) return { ok: false, message: id.message };
      const label = requireString(params, 'label', { maxLength: 200 });
      if (!label.ok) return { ok: false, message: label.message };
      const url = requireString(params, 'url', { maxLength: 2000 });
      if (!url.ok) return { ok: false, message: url.message };

      const updated = await myLinkQueries.update(db, workspaceId, id.value, {
        label: label.value,
        url: url.value,
      });
      if (!updated) {
        return { ok: false, message: `MyLink \`${id.value}\` not found` };
      }
      return { ok: true, data: { link: updated } };
    },
  },

  // -------------------------------------------------------------------
  // DELETE
  // -------------------------------------------------------------------
  {
    name: 'delete_section',
    description:
      'Remove a section (image + its CTAs) from an LP. The change is saved immediately.',
    permission: 'delete',
    inputSchema: {
      type: 'object',
      properties: {
        lpId: { type: 'string' },
        sectionId: { type: 'string' },
      },
      required: ['lpId', 'sectionId'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const lpId = requireString(params, 'lpId');
      if (!lpId.ok) return { ok: false, message: lpId.message };
      const sectionId = requireString(params, 'sectionId');
      if (!sectionId.ok) return { ok: false, message: sectionId.message };

      const loaded = await loadPageContent(db, workspaceId, lpId.value);
      if (!loaded.ok) return { ok: false, message: loaded.message };

      const before = loaded.content.sections.length;
      const sections = loaded.content.sections.filter(
        (s) => s.id !== sectionId.value
      );
      if (sections.length === before) {
        return {
          ok: false,
          message: `Section \`${sectionId.value}\` not found on LP \`${lpId.value}\``,
        };
      }

      const next: PageContent = { ...loaded.content, sections };
      const updated = await pageQueries.updateContent(
        db,
        workspaceId,
        lpId.value,
        JSON.stringify(next)
      );
      if (!updated) return { ok: false, message: 'Failed to delete section' };
      return {
        ok: true,
        data: { removed: sectionId.value, remaining: sections.length },
      };
    },
  },

  {
    name: 'delete_my_link',
    description:
      'Delete a MyLink by id. CTAs that referenced it will fall back to their inline url field.',
    permission: 'delete',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (params, { db, workspaceId }) => {
      const id = requireString(params, 'id');
      if (!id.ok) return { ok: false, message: id.message };

      const removed = await myLinkQueries.remove(db, workspaceId, id.value);
      if (!removed) {
        return { ok: false, message: `MyLink \`${id.value}\` not found` };
      }
      return { ok: true, data: { removed: id.value } };
    },
  },
];


export function listToolsForMode(mode: McpMode): McpTool[] {
  return TOOLS.filter((t) => permissionAllowedByMode(mode, t.permission));
}

export function findTool(name: string): McpTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/**
 * Convert a tool handler result into the MCP tools/call response
 * shape. Per MCP spec, the result is `{ content: [...], isError? }`
 * where `content` is an array of typed parts (we only emit `text`).
 */
export function toMcpToolResult(result: McpToolHandlerResult): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  if (result.ok) {
    return {
      content: [
        { type: 'text', text: JSON.stringify(result.data, null, 2) },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          { error: result.message, ...(result.details !== undefined && { details: result.details }) },
          null,
          2
        ),
      },
    ],
  };
}
