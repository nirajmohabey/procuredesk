import { database, json, errorResponse } from "../../../src/server/http";

export const dynamic = "force-dynamic";
export async function GET() {
  const requestId = crypto.randomUUID();
  try { await database().prepare("SELECT scope FROM workspaces LIMIT 1").first(); return json({ status: "ready", service: "procuredesk", runtime: "nextjs-node", storage: "PostgreSQL", simulator: true }, 200, requestId); }
  catch (error) { return errorResponse(error, requestId); }
}
