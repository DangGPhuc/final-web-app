/**
 * Structured Gmail Error Taxonomy
 *
 * Requirements:
 * - Differentiate between revoked/expired refresh tokens, configuration/scope errors, and transient network errors.
 * - Do not mark healthy connections permanently revoked for unrelated errors.
 * - Never expose raw OAuth tokens or sensitive server stack traces to clients.
 */

export class GmailTokenRevokedError extends Error {
  constructor(message: string = 'Token đã hết hạn hoặc bị thu hồi (Yêu cầu kết nối lại).') {
    super(message);
    this.name = 'GmailTokenRevokedError';
  }
}

export class GmailConfigError extends Error {
  constructor(message: string = 'Lỗi cấu hình Gmail API hoặc chưa kích hoạt quyền truy cập.') {
    super(message);
    this.name = 'GmailConfigError';
  }
}

export class GmailTransientError extends Error {
  constructor(message: string = 'Lỗi kết nối tạm thời tới máy chủ Google. Vui lòng thử lại sau.') {
    super(message);
    this.name = 'GmailTransientError';
  }
}

/**
 * Backward compatibility alias for GmailTokenRevokedError
 */
export const GmailTokenExpiredError = GmailTokenRevokedError;
