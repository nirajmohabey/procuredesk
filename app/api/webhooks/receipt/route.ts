import { database, json, errorResponse, readBody } from "../../../../src/server/http";
import { DomainError, handleReceipt } from "../../../../src/server/service";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const integration = new URL(request.url).searchParams.get("integration");
    if (!integration || integration.length > 128) throw new DomainError("NOT_FOUND", "Integration not found.", 404);
    const result = await handleReceipt(database(), integration, await readBody(request, 8192), request.headers.get("x-vendor-timestamp") || "", request.headers.get("x-vendor-signature") || "");
    return json({ ok: true, ...result }, 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}
