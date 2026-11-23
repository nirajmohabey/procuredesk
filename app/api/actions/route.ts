import { database, owner, json, errorResponse, checkOrigin, readJson } from "../../../src/server/http";
import { executeAction } from "../../../src/server/service";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const requestId = crypto.randomUUID(), start = Date.now();
  try {
    checkOrigin(request);
    const userId = await owner(), body = await readJson(request);
    const result = await executeAction(database(), userId, body, request.headers.get("idempotency-key") || "");
    console.info(JSON.stringify({ requestId, operation: body.action, org: body.org || "atlas", actor: body.actor || "alex", durationMs: Date.now() - start, outcome: "ok" }));
    return json({ ...result, traceId: requestId }, 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}
