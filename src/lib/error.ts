/**
 * FinTrack Pro v2 — Centralized Application Error Model
 *
 * All domain operations return { ok: true; ... } or { ok: false; error: string }.
 * The error string is user-facing (Vietnamese). For programmatic discrimination,
 * use AppErrorCode.
 *
 * Future API response contract (when backend is added):
 * {
 *   ok: false,
 *   error: {
 *     code: AppErrorCode,
 *     message: string,
 *     requestId?: string   // server-generated per-request trace ID
 *   }
 * }
 *
 * Note: requestId infrastructure is not yet implemented.
 * Stack traces, filesystem paths, environment values, or SQL errors
 * MUST NEVER be included in error messages surfaced to users.
 */

export type AppErrorCode =
  // Financial integrity
  | 'INSUFFICIENT_FUNDS'
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'INVALID_TRANSFER'
  | 'CREDIT_SOURCE_FORBIDDEN'
  | 'CREDIT_DESTINATION_INCOME'
  // Entity lifecycle
  | 'NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'IMMUTABLE_FIELD'
  | 'ENTITY_IN_USE'
  | 'ENTITY_PROTECTED'
  // Validation
  | 'VALIDATION_ERROR'
  | 'INVALID_AMOUNT'
  | 'INVALID_DATE'
  | 'INVALID_ENUM'
  | 'MISSING_REQUIRED'
  | 'DUPLICATE_ENTRY'
  // Storage / Persistence
  | 'STORAGE_CORRUPT'
  | 'STORAGE_SAVE_FAILED'
  | 'SCHEMA_UNKNOWN_VERSION'
  | 'SCHEMA_MIGRATION_FAILED'
  // Backup / Import
  | 'IMPORT_INVALID_FORMAT'
  | 'IMPORT_TOO_LARGE'
  | 'IMPORT_REFERENTIAL_INTEGRITY'
  // File upload
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'FILE_TOO_LARGE'
  // Generic
  | 'UNKNOWN';

export interface AppError {
  code: AppErrorCode;
  message: string;
}

/**
 * Build a domain-operation failure result.
 * Use this instead of constructing { ok: false, error: ... } inline.
 */
export function domainError(
  _code: AppErrorCode,
  message: string
): { ok: false; error: string } {
  // The code is reserved for future structured logging / API responses.
  // Currently we surface only the human-readable message string.
  return { ok: false, error: message };
}

/**
 * Safely extract a displayable error message from an unknown thrown value.
 * NEVER exposes stack traces or internal paths.
 */
export function safeErrorMessage(e: unknown, fallback = 'Đã xảy ra lỗi không xác định'): string {
  if (e instanceof Error) {
    // Only return the message, never the stack
    return e.message || fallback;
  }
  if (typeof e === 'string') {
    return e || fallback;
  }
  return fallback;
}
