import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const lifetimeSeconds = 30 * 24 * 60 * 60;
type Session = { v: 1; sub: string; iat: number; exp: number };

function key(secret: string) {
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("SESSION_SECRET must contain at least 32 bytes.");
  return secret;
}

export function issueSession(secret: string, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const payload: Session = { v: 1, sub: randomUUID(), iat: issued, exp: issued + lifetimeSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", key(secret)).update(body).digest("base64url");
  return { token: `${body}.${signature}`, owner: payload.sub, maxAge: lifetimeSeconds };
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): string | null {
  key(secret);
  if (!token || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<Session>;
    const current = Math.floor(now / 1000);
    if (payload.v !== 1 || typeof payload.sub !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.sub)) return null;
    if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) return null;
    if (payload.iat! > current + 60 || payload.exp! <= current || payload.exp! - payload.iat! !== lifetimeSeconds) return null;
    return payload.sub;
  } catch { return null; }
}
