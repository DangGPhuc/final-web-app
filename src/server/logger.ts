export interface SecurityLogPayload {
  event:
    | 'SECURITY_UNAUTHENTICATED'
    | 'SECURITY_INVALID_ORIGIN'
    | 'SECURITY_CROSS_SITE_REQUEST'
    | 'SECURITY_RATE_LIMITED'
    | 'SECURITY_BOLA_DENIED'
    | 'SECURITY_SESSION_REVOKED'
    | 'SECURITY_QUOTA_EXCEEDED'
    | 'SECURITY_UNEXPECTED_FAILURE'
    | 'AUTH_LOGIN_SUCCEEDED'
    | 'AUTH_LOGIN_FAILED'
    | 'AUTH_SESSION_ISSUED'
    | 'AUTH_SESSION_REVOKED';
  requestId: string;
  errorCode: string;
  timestamp: string;
  userId?: string;
  provider?: string;
}

/**
 * Emits sanitized structured JSON security logs.
 * Never logs raw request bodies, tokens, session hashes, cookies, or SQL statements.
 */
export function logSecurityEvent(payload: SecurityLogPayload): void {
  const sanitized: Record<string, string> = {
    event: payload.event,
    requestId: payload.requestId,
    errorCode: payload.errorCode,
    timestamp: payload.timestamp,
  };

  // Only attach userId when already authenticated and safely known
  if (payload.userId) {
    sanitized.userId = payload.userId;
  }

  // Safe provider name (e.g. 'google')
  if (payload.provider) {
    sanitized.provider = payload.provider;
  }

  // Use stderr for operational warning/error logging
  console.warn(JSON.stringify(sanitized));
}
