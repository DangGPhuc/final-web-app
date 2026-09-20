import crypto from 'crypto';
import { getOwnerSecretKey } from './owner-auth';
import { parseAndValidateIsoDate } from '../date';

export class ContinuationExpiredError extends Error {
  code = 'continuation_expired' as const;
  constructor(message = 'Phiên tiếp tục quét đã hết hạn. Vui lòng bắt đầu phiên quét mới.') {
    super(message);
    this.name = 'ContinuationExpiredError';
  }
}

export class InvalidContinuationError extends Error {
  code = 'invalid_continuation_token' as const;
  constructor(message = 'Token tiếp tục không hợp lệ hoặc đã bị thay đổi.') {
    super(message);
    this.name = 'InvalidContinuationError';
  }
}

export interface QuickContinuationData {
  version: 1;
  mode: 'QUICK';
  gmailConnectionId: string;
  pageToken: string;
  lowerBoundEpoch: number;
  upperBoundEpoch: number;
  exp: number;
}

export interface HistoricalContinuationData {
  version: 1;
  mode: 'HISTORICAL';
  gmailConnectionId: string;
  pageToken: string;
  fromDate: string;
  toDate: string;
  exp: number;
}

export type ContinuationData = QuickContinuationData | HistoricalContinuationData;

/**
 * Derive a domain-separated HMAC key for continuation tokens from OWNER_SECRET_KEY
 */
function getContinuationSigningKey(): Buffer {
  const secret = getOwnerSecretKey();
  return crypto.createHmac('sha256', secret).update('gmail-continuation:v1').digest();
}

/**
 * Create an opaque, signed continuation token valid for ttlSeconds (default 30 minutes / 1800s)
 */
export function signContinuationToken(
  params:
    | {
        mode: 'QUICK';
        gmailConnectionId: string;
        pageToken: string;
        lowerBoundEpoch: number;
        upperBoundEpoch: number;
      }
    | {
        mode: 'HISTORICAL';
        gmailConnectionId: string;
        pageToken: string;
        fromDate: string;
        toDate: string;
      },
  ttlSeconds = 1800
): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  if (params.mode === 'HISTORICAL') {
    parseAndValidateIsoDate(params.fromDate);
    parseAndValidateIsoDate(params.toDate);
    if (params.fromDate > params.toDate) {
      throw new InvalidContinuationError('Khoảng ngày trong token tiếp tục Historical không hợp lệ (fromDate > toDate).');
    }
  }

  const data: ContinuationData =
    params.mode === 'QUICK'
      ? {
          version: 1,
          mode: 'QUICK',
          gmailConnectionId: params.gmailConnectionId,
          pageToken: params.pageToken,
          lowerBoundEpoch: params.lowerBoundEpoch,
          upperBoundEpoch: params.upperBoundEpoch,
          exp,
        }
      : {
          version: 1,
          mode: 'HISTORICAL',
          gmailConnectionId: params.gmailConnectionId,
          pageToken: params.pageToken,
          fromDate: params.fromDate,
          toDate: params.toDate,
          exp,
        };

  const payloadJson = JSON.stringify(data);
  const payloadB64 = Buffer.from(payloadJson, 'utf-8').toString('base64url');
  const key = getContinuationSigningKey();
  const sig = crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');

  return `${payloadB64}.${sig}`;
}

/**
 * Verify and decode an opaque continuation token.
 * Validates HMAC signature with constant-time comparison, checks expiry, and schema.
 */
export function verifyContinuationToken(token: string): ContinuationData {
  if (!token || typeof token !== 'string') {
    throw new InvalidContinuationError('Token tiếp tục không được để trống.');
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new InvalidContinuationError('Định dạng token tiếp tục không hợp lệ.');
  }

  const [payloadB64, sig] = parts;
  let key: Buffer;
  try {
    key = getContinuationSigningKey();
  } catch (err) {
    throw new InvalidContinuationError('Không thể xác thực token: Cấu hình khóa máy chủ không sẵn sàng.');
  }

  const expectedSig = crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf-8');
  const expectedSigBuf = Buffer.from(expectedSig, 'utf-8');

  if (
    sigBuf.length !== expectedSigBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedSigBuf)
  ) {
    throw new InvalidContinuationError('Chữ ký token tiếp tục không hợp lệ hoặc đã bị thay đổi.');
  }

  let data: any;
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    data = JSON.parse(json);
  } catch {
    throw new InvalidContinuationError('Không thể giải mã dữ liệu token tiếp tục.');
  }

  if (data?.version !== 1) {
    throw new InvalidContinuationError('Phiên bản token tiếp tục không được hỗ trợ.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof data.exp !== 'number' || data.exp < now) {
    throw new ContinuationExpiredError();
  }

  if (typeof data.gmailConnectionId !== 'string' || !data.gmailConnectionId) {
    throw new InvalidContinuationError('Thiếu thông tin kết nối Gmail trong token.');
  }

  if (typeof data.pageToken !== 'string' || !data.pageToken) {
    throw new InvalidContinuationError('Thiếu pageToken trong token tiếp tục.');
  }

  if (data.mode === 'QUICK') {
    if (!Number.isFinite(data.lowerBoundEpoch) || !Number.isFinite(data.upperBoundEpoch)) {
      throw new InvalidContinuationError('Khoảng thời gian Quick Scan trong token không hợp lệ.');
    }
  } else if (data.mode === 'HISTORICAL') {
    if (typeof data.fromDate !== 'string' || typeof data.toDate !== 'string') {
      throw new InvalidContinuationError('Thiếu khoảng ngày trong token tiếp tục Historical.');
    }
    try {
      parseAndValidateIsoDate(data.fromDate);
      parseAndValidateIsoDate(data.toDate);
    } catch {
      throw new InvalidContinuationError('Khoảng ngày trong token tiếp tục Historical không hợp lệ.');
    }
    if (data.fromDate > data.toDate) {
      throw new InvalidContinuationError('Khoảng ngày trong token tiếp tục Historical không hợp lệ (fromDate > toDate).');
    }
  } else {
    throw new InvalidContinuationError('Chế độ quét trong token không hợp lệ.');
  }

  return data as ContinuationData;
}
