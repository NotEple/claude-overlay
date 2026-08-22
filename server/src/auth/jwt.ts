import { createHmac, timingSafeEqual } from 'crypto';

const enc = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url');
const dec = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());

export function signToken(payload: object, secret: string): string {
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 });
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string, secret: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [header, body, sig] = parts;
  const decodedHeader = dec(header);
  if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') throw new Error('Invalid header');
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const actualBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('Invalid signature');
  }
  const payload = dec(body);
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}
