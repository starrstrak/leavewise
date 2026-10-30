import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const SESSION_COOKIE = 'lw_session';
export const DEFAULT_TTL_SECONDS = 8 * 3600;

export type SessionCheck =
  | { ok: true; userId: string; exp: number }
  | { ok: false; code: 'no_session' | 'invalid_session' | 'session_expired' };

/** Local signing secret, generated at first launch under app/data (git-ignored), never committed. */
export function loadSecret(file: string): string {
  if (existsSync(file)) {
    const s = readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  }
  mkdirSync(dirname(file), { recursive: true });
  const s = randomBytes(32).toString('hex');
  writeFileSync(file, s + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return s;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

/** Cookie value `<base64url(json)>.<hmac>`; the payload only holds the demo user id and the expiry (epoch seconds). */
export function makeToken(secret: string, userId: string, nowSec: number, ttl = DEFAULT_TTL_SECONDS): string {
  const body = b64(JSON.stringify({ u: userId, exp: nowSec + ttl }));
  return `${body}.${sign(secret, body)}`;
}

export function checkToken(secret: string, token: string | undefined, nowSec: number): SessionCheck {
  if (!token) return { ok: false, code: 'no_session' };
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return { ok: false, code: 'invalid_session' };
  const want = Buffer.from(sign(secret, body)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, code: 'invalid_session' };
  let p: { u?: unknown; exp?: unknown };
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, code: 'invalid_session' }; }
  if (typeof p.u !== 'string' || typeof p.exp !== 'number') return { ok: false, code: 'invalid_session' };
  if (nowSec >= p.exp) return { ok: false, code: 'session_expired' };
  return { ok: true, userId: p.u, exp: p.exp };
}

export function readCookie(header: string | undefined, name = SESSION_COOKIE): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export const cookieHeader = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
