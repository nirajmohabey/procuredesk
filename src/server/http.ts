import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { DomainError, type Database } from "./service";

export function database(): Database {
  if (!env.DB) throw new DomainError("DATABASE_UNAVAILABLE", "Workspace storage is temporarily unavailable.", 503);
  return env.DB as unknown as Database;
}
export async function owner() {
  const user = await getChatGPTUser();
  if (!user) throw new DomainError("UNAUTHENTICATED", "Sign in with ChatGPT to open your private demo workspace.", 401);
  return user.userId;
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
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
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
