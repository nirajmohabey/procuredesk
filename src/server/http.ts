import { cookies } from "next/headers";
import { attachDatabasePool } from "@vercel/functions";
import { createPostgresDatabase } from "./postgres";
import { issueSession, verifySession } from "./session";
import { isSameOrigin } from "./origin";
import { DomainError, type Database } from "./service";

const runtime = globalThis as typeof globalThis & { procuredeskDatabase?: { url: string; database: Database } };

export function database(): Database {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DomainError("DATABASE_UNAVAILABLE", "Workspace storage is temporarily unavailable.", 503);
  if (!runtime.procuredeskDatabase || runtime.procuredeskDatabase.url !== connectionString) {
    const database = createPostgresDatabase(connectionString);
    if (process.env.VERCEL === "1") attachDatabasePool(database.pool);
    runtime.procuredeskDatabase = { url: connectionString, database };
  }
  return runtime.procuredeskDatabase.database;
}
export async function owner() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new DomainError("SESSION_UNAVAILABLE", "Private demo sessions are temporarily unavailable.", 503);
  const jar = await cookies();
  const cookieName = process.env.VERCEL === "1" ? "__Host-procuredesk-session" : "procuredesk-session";
  const existing = verifySession(jar.get(cookieName)?.value, secret);
  if (existing) return existing;
  const session = issueSession(secret);
  jar.set(cookieName, session.token, { httpOnly: true, secure: process.env.VERCEL === "1", sameSite: "lax", path: "/", maxAge: session.maxAge });
  return session.owner;
}
export function json(data: unknown, status = 200, requestId = crypto.randomUUID()) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId, "X-Content-Type-Options": "nosniff" } });
}
export function errorResponse(error: unknown, requestId: string) {
  const domain = error instanceof DomainError ? error : new DomainError("TEMPORARY_FAILURE", "The workspace could not complete this request. Please retry.", 503);
  console.error(JSON.stringify({ requestId, code: domain.code, outcome: "error" }));
  return json({ error: { code: domain.code, message: domain.message }, requestId }, domain.status, requestId);
}
export function checkOrigin(request: Request) {
  if (!isSameOrigin(request, process.env.VERCEL === "1")) {
    throw new DomainError("ORIGIN_DENIED", "This action must start from the ProcureDesk workspace.", 403);
  }
}
export async function readBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") || 0) > limit) throw new DomainError("PAYLOAD_TOO_LARGE", `Request body exceeds ${limit / 1024} KB.`, 413);
  if (!request.body) return "";
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new DomainError("PAYLOAD_TOO_LARGE", `Request body exceeds ${limit / 1024} KB.`, 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new DomainError("VALIDATION_ERROR", "Request body must contain valid UTF-8.", 422); }
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new DomainError("UNSUPPORTED_MEDIA_TYPE", "Send application/json.", 415);
  const raw = await readBody(request, 16384);
  try { const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new DomainError("VALIDATION_ERROR", "Send a valid JSON object.", 422); }
}
