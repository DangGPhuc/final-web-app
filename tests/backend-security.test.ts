import { describe, it, expect, afterEach } from 'vitest';
import { money, parseWallet, parseTransfer, transferBalances } from '../src/server/domain';
import { checkMutationOrigin, sessionHash } from '../src/server/session';
import { readBoundedJsonBody } from '../src/lib/api-guard';
const id = '11111111-1111-4111-8111-111111111111';
const origin = process.env.APP_ORIGIN;
afterEach(() => { if (origin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN=origin; });
describe('server trust boundary', () => {
  it('rejects imprecise numeric JSON, exponent/fraction/negative/oversized money', () => {
    for (const v of [1,'1.5','1e3','-1','01','9000000000000001',null]) expect(() => money(v)).toThrow('INVALID_MONEY');
    expect(money('9000000000000000')).toBe(9000000000000000n);
  });
  it('rejects mass-assignment and unsupported credit wallets', () => {
    expect(() => parseWallet({name:'Bank',type:'BANK',openingBalance:'0',userId:id})).toThrow('UNKNOWN_FIELD');
    expect(() => parseWallet({name:'Card',type:'CREDIT',openingBalance:'0'})).toThrow('UNSUPPORTED_WALLET_TYPE');
  });
  it('rejects self transfer and never rounds a balance', () => {
    expect(() => parseTransfer({fromWalletId:id,toWalletId:id,amount:'1'})).toThrow('SAME_WALLET');
    expect(transferBalances('9000000000000000','0','1','1')).toEqual({from:'8999999999999998',to:'1'});
    expect(() => transferBalances('1','0','1','1')).toThrow('INSUFFICIENT_FUNDS');
    expect(() => transferBalances('10','9000000000000000','1','0')).toThrow('BALANCE_LIMIT');
  });
  it('fails closed for absent, foreign, or same-site sibling origins', () => {
    process.env.APP_ORIGIN='https://fintrack.example';
    for (const o of [undefined,'https://evil.example','https://sub.fintrack.example']) {
      expect(() => checkMutationOrigin(new Request('https://fintrack.example/api/v2/wallets',{method:'POST',headers:{'content-type':'application/json',...(o ? {origin:o}: {})}}))).toThrow('INVALID_ORIGIN');
    }
    expect(() => checkMutationOrigin(new Request('https://fintrack.example',{method:'POST',headers:{origin:'https://fintrack.example','content-type':'application/json','sec-fetch-site':'same-origin'}}))).not.toThrow();
  });
  it('rejects ambiguous cookies and never accepts user identity headers', () => {
    expect(() => sessionHash(new Request('https://test',{headers:{'x-user-id':id}}))).toThrow('UNAUTHENTICATED');
    const cookie = '__Host-fintrack_session='+'a'.repeat(43);
    expect(sessionHash(new Request('https://test',{headers:{cookie}}))).toMatch(/^[a-f0-9]{64}$/);
    expect(() => sessionHash(new Request('https://test',{headers:{cookie:cookie+'; '+cookie}}))).toThrow('UNAUTHENTICATED');
  });
  it('cancels oversized streams without buffering the remaining body', async () => {
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(1024));},cancel(){cancelled=true;}});
    const req=new Request('https://test',{method:'POST',body:stream,duplex:'half'} as RequestInit);
    expect(await readBoundedJsonBody(req,1500)).toMatchObject({ok:false,status:413});
    expect(cancelled).toBe(true);
  });
  it('rejects invalid UTF-8 and counts multibyte bodies', async () => {
    expect(await readBoundedJsonBody(new Request('https://test',{method:'POST',body:new Uint8Array([255])}))).toMatchObject({status:400});
    expect(await readBoundedJsonBody(new Request('https://test',{method:'POST',body:JSON.stringify({a:'ệ'.repeat(10)})}),20)).toMatchObject({status:413});
  });
});
