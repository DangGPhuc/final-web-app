/**
 * API Security & Demo Guards for FinTrack Pro v2
 *
 * Implements:
 * 1. Production gating for mock mutation APIs (ENABLE_DEMO_API policy).
 *    In production, mock POST/mutation endpoints return HTTP 501 Not Implemented
 *    unless ENABLE_DEMO_API=true is explicitly set.
 * 2. Strict request body UTF-8 byte size validation before JSON parsing.
 */
import { NextResponse } from 'next/server';

export function isDemoApiEnabled(): boolean {
  if (process.env.ENABLE_DEMO_API === 'true') {
    return true;
  }
  // In development/test environments, demo API defaults to enabled unless explicitly disabled
  if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEMO_API !== 'false') {
    return true;
  }
  // Production default is disabled
  return false;
}

export function checkDemoMutationAllowed(): NextResponse | null {
  if (!isDemoApiEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Demo mutation API is disabled in production. Database backend persistence is required.',
        _code: 'DEMO_MUTATION_DISABLED',
      },
      {
        status: 501,
        headers: {
          'X-Demo-Only': 'true',
          'X-Persistence': 'none',
        },
      }
    );
  }
  return null;
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
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
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

  // 4. Safely parse JSON
  try {
    const data = JSON.parse(rawText) as T;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { ok: false, error: 'Body must be a JSON object', status: 400 };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Invalid JSON body', status: 400 };
  }
}
