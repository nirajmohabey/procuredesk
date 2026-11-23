import { database, owner, json, errorResponse } from "../../../src/server/http";
import { snapshot } from "../../../src/server/service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const url = new URL(request.url);
    const result = await snapshot(database(), await owner(), url.searchParams.get("org") || "atlas", url.searchParams.get("actor") || "alex");
    return json(result, 200, requestId);
  } catch (error) { return errorResponse(error, requestId); }
}
