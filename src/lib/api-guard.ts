/**
 * API Security & Demo Guards for FinTrack Pro v2
 *
 * Implements:
 * 1. Production shutdown for legacy mock APIs.
 *    In NODE_ENV=production, all legacy demo routes return HTTP 404 Not Found.
 *    ENABLE_DEMO_API=true cannot re-enable them in production.
 * 2. Strict request body UTF-8 byte size validation before JSON parsing.
 */
import { NextResponse } from 'next/server';

export function isDemoApiEnabled(): boolean {
  // In production, legacy demo APIs are strictly disabled under ALL conditions.
  // ENABLE_DEMO_API=true cannot override this in production.
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  // In development/test environments, demo API defaults to enabled unless explicitly set to false
  return process.env.ENABLE_DEMO_API !== 'false';
}

export function checkLegacyDemoRouteDisabled(): NextResponse | null {
  if (!isDemoApiEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Legacy demo endpoint is disabled in production.',
        _code: 'LEGACY_DEMO_DISABLED',
      },
      {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
  return null;
}

export function checkDemoMutationAllowed(): NextResponse | null {
  return checkLegacyDemoRouteDisabled();
}

export interface BoundedJsonResult<T> {
  ok: true;
  data: T;
}

export interface BoundedJsonError {
  ok: false;
  error: string;
  status: number;
}

export async function readBoundedJsonBody<T = Record<string, unknown>>(
  req: Request,
  maxBytes: number = 50_000
): Promise<BoundedJsonResult<T> | BoundedJsonError> {
  // 1. Check Content-Length header as initial fast check
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const parsedLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(parsedLength) && parsedLength > maxBytes) {
      return { ok: false, error: 'Payload too large', status: 413 };
    }
  }

  // Enforce the byte budget while streaming, before buffering or JSON parsing.
  if (!req.body) return { ok: false, error: 'Request body cannot be empty', status: 400 };
  const reader = req.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let rawText = '';
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) return { ok: false, error: 'Request body timeout', status: 408 };
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        return { ok: false, error: 'Payload too large', status: 413 };
      }
      rawText += decoder.decode(value, { stream: true });
    }
    rawText += decoder.decode();
  } catch {
    void reader.cancel().catch(() => {});
    return { ok: false, error: 'Failed to read UTF-8 body', status: 400 };
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  if (!rawText.trim()) {
    return { ok: false, error: 'Request body cannot be empty', status: 400 };
  }

  try {
    const parsed = JSON.parse(rawText) as T;
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, error: 'Invalid JSON payload', status: 400 };
  }
}
