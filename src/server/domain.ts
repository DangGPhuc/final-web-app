import { ApiError } from './errors';
export const MAX_MONEY = 9_000_000_000_000_000n;
export function money(value: unknown, positive = false): bigint {
  // Decimal strings preserve precision at the JSON boundary. VND only, whole dong.
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(value)) throw new ApiError(422, 'INVALID_MONEY');
  const result = BigInt(value);
  if (result > MAX_MONEY || (positive && result === 0n)) throw new ApiError(422, 'INVALID_MONEY');
  return result;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(422, 'INVALID_ID');
  return value.toLowerCase();
}
export function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(k => !allowed.includes(k))) throw new ApiError(422, 'UNKNOWN_FIELD');
}
export function parseWallet(body: Record<string, unknown>) {
  fields(body, ['name', 'type', 'openingBalance']);
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || /[\u0000-\u001f]/.test(body.name)) throw new ApiError(422, 'INVALID_NAME');
  if (!['CASH', 'BANK', 'SAVINGS'].includes(body.type as string)) throw new ApiError(422, 'UNSUPPORTED_WALLET_TYPE');
  return { name: body.name.trim(), type: body.type as string, openingBalance: money(body.openingBalance).toString() };
}
export function parseTransfer(body: Record<string, unknown>) {
  fields(body, ['fromWalletId', 'toWalletId', 'amount', 'fee']);
  const fromWalletId = uuid(body.fromWalletId), toWalletId = uuid(body.toWalletId);
  if (fromWalletId === toWalletId) throw new ApiError(422, 'SAME_WALLET');
  return { fromWalletId, toWalletId, amount: money(body.amount, true).toString(), fee: money(body.fee ?? '0').toString() };
}
export function transferBalances(source: string, target: string, amount: string, fee: string) {
  const debit = BigInt(amount) + BigInt(fee);
  if (BigInt(source) < debit) throw new ApiError(409, 'INSUFFICIENT_FUNDS');
  const to = BigInt(target) + BigInt(amount);
  if (to > MAX_MONEY) throw new ApiError(422, 'BALANCE_LIMIT');
  return { from: (BigInt(source) - debit).toString(), to: to.toString() };
}
