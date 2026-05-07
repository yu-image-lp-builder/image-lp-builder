/**
 * API response helpers
 *
 * All API endpoints return responses in a unified format:
 * - Success: { success: true, data: ... }
 * - Error: { success: false, error: { code, message, details? } }
 *
 * This ensures consistency across the entire API surface.
 */

export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/**
 * Standard error codes used across the API.
 */
export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Create a successful API response.
 */
export function success<T>(data: T, status = 200): Response {
  const body: ApiSuccess<T> = { success: true, data };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create an error API response.
 */
export function error(
  code: ErrorCode,
  message: string,
  status: number,
  details?: Record<string, unknown>
): Response {
  const body: ApiError = {
    success: false,
    error: { code, message, ...(details && { details }) },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Common error responses (shortcuts).
 */
export const errors = {
  unauthorized: (message = 'Authentication required') =>
    error(ErrorCodes.UNAUTHORIZED, message, 401),

  forbidden: (message = 'Insufficient permissions') =>
    error(ErrorCodes.FORBIDDEN, message, 403),

  notFound: (message = 'Resource not found') =>
    error(ErrorCodes.NOT_FOUND, message, 404),

  validationError: (
    message = 'Validation failed',
    details?: Record<string, unknown>
  ) => error(ErrorCodes.VALIDATION_ERROR, message, 400, details),

  conflict: (message = 'Conflict', details?: Record<string, unknown>) =>
    error(ErrorCodes.CONFLICT, message, 409, details),

  internalError: (message = 'Internal server error') =>
    error(ErrorCodes.INTERNAL_ERROR, message, 500),
};
