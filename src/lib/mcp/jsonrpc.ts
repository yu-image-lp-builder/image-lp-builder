/**
 * Minimal JSON-RPC 2.0 helpers for the MCP endpoint.
 *
 * MCP is JSON-RPC 2.0 over HTTP — request bodies have
 * { jsonrpc: '2.0', id, method, params? } and responses pair with the
 * same id. We only need request-style messages (no batches) and a
 * narrow slice of error codes used by this endpoint.
 */

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcSuccess = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcError = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

/**
 * Standard JSON-RPC error codes plus an MCP-specific one for tool
 * execution failures.
 */
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export function jsonRpcSuccess(id: JsonRpcId, result: unknown): Response {
  const body: JsonRpcSuccess = { jsonrpc: '2.0', id, result };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): Response {
  const body: JsonRpcError = {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined && { data }) },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Parse a request body as a JSON-RPC request. Performs minimal
 * structural validation — method must be a string, jsonrpc must be
 * "2.0". params is allowed to be missing.
 */
export function parseJsonRpcRequest(body: unknown):
  | { ok: true; request: JsonRpcRequest }
  | { ok: false; reason: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, reason: 'Request body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  if (obj.jsonrpc !== '2.0') {
    return { ok: false, reason: 'jsonrpc field must be "2.0"' };
  }
  if (typeof obj.method !== 'string') {
    return { ok: false, reason: 'method field must be a string' };
  }
  if (
    obj.params !== undefined &&
    (typeof obj.params !== 'object' || obj.params === null || Array.isArray(obj.params))
  ) {
    return { ok: false, reason: 'params must be an object when provided' };
  }
  return {
    ok: true,
    request: {
      jsonrpc: '2.0',
      id: (obj.id as JsonRpcId) ?? null,
      method: obj.method,
      params: (obj.params as Record<string, unknown> | undefined) ?? undefined,
    },
  };
}
