import { z } from "zod";

/** Small D1 contract shared by the Worker and the independent SQLite integration harness. */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta?: { changes?: number } }>;
  run(): Promise<{ results?: unknown[]; meta?: { changes?: number } }>;
}
export interface Database { readonly dialect?: "postgres" | "sqlite"; prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]>; }
type Row = Record<string, any>;
export class DomainError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
export const ACTORS = [
  { id: "maya", name: "Maya Chen", role: "employee", email: "maya@atlas.example", initials: "MC" },
  { id: "alex", name: "Alex Morgan", role: "approver", email: "alex@atlas.example", initials: "AM" },
  { id: "jordan", name: "Jordan Lee", role: "finance", email: "jordan@atlas.example", initials: "JL" },
  { id: "admin", name: "Niraj Mohabey", role: "administrator", email: "niraj@atlas.example", initials: "NM" },
] as const;
export function actorFor(id: string) {
  const actor = ACTORS.find(a => a.id === id);
  if (!actor) throw new DomainError("FORBIDDEN", "Choose a valid demo workspace member.", 403);
  return actor;
}
function canApprove(id: string) { const a = actorFor(id); if (!["approver", "administrator"].includes(a.role)) throw new DomainError("FORBIDDEN", "Only an approver can perform this action.", 403); }
function canCreate(id: string) { const a = actorFor(id); if (a.role === "finance") throw new DomainError("FORBIDDEN", "Finance has read-only access.", 403); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Row)[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
export async function canonicalHash(value: unknown) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)))); }
export async function scopeFor(owner: string, org: string) {
  if (!owner) throw new DomainError("UNAUTHENTICATED", "Sign in to open your workspace.", 401);
  if (!["atlas", "nova"].includes(org)) throw new DomainError("NOT_FOUND", "Workspace not found.", 404);
  return `${(await canonicalHash(owner)).slice(0, 32)}:${org}`;
}
const prep = (db: Database, sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
async function one(db: Database, sql: string, ...args: unknown[]): Promise<Row | null> { return prep(db, sql, ...args).first<Row>(); }
async function many(db: Database, sql: string, ...args: unknown[]): Promise<Row[]> { return (await prep(db, sql, ...args).all<Row>()).results; }
const now = () => new Date().toISOString();
const token = () => crypto.randomUUID();
const titles = [
  [1042, "MacBook Pro 14-inch", "Apple", 249900, "Engineering", "Equipment", "maya", "Maya Chen", "submitted", "2026-11-23T09:35:00.000Z", "A faster development machine for the platform team. The current laptop cannot run our local services together."],
  [1041, "Figma Organization · annual renewal", "Figma", 540000, "Design", "Software", "maya", "Maya Chen", "submitted", "2026-11-22T16:20:00.000Z", "Annual design collaboration renewal for 15 seats. Required before the next billing cycle."],
  [1040, "Ergonomic task chairs", "Herman Miller", 168000, "Operations", "Office", "admin", "Niraj Mohabey", "submitted", "2026-11-22T11:10:00.000Z", "Two ergonomic chairs for the new team members joining in December."],
  [1039, "Linear Business · team subscription", "Linear", 144000, "Engineering", "Software", "maya", "Maya Chen", "approved", "2026-11-21T14:50:00.000Z", "Issue tracking subscription for the engineering team."],
  [1038, "Studio display", "Apple", 159900, "Design", "Equipment", "admin", "Niraj Mohabey", "ordered", "2026-11-20T10:20:00.000Z", "Color-accurate display for the product design studio."],
  [1037, "Cloud infrastructure credits", "Vercel", 320000, "Engineering", "Infrastructure", "maya", "Maya Chen", "received", "2026-11-18T09:10:00.000Z", "Prepaid cloud credits for preview deployments and production hosting."],
  [1036, "Meeting room camera", "Logitech", 89900, "Operations", "Equipment", "admin", "Niraj Mohabey", "received", "2026-11-16T15:30:00.000Z", "Conference camera for the main meeting room."],
  [1035, "Notion workspace renewal", "Notion", 192000, "Operations", "Software", "maya", "Maya Chen", "received", "2026-11-15T10:00:00.000Z", "Documentation and knowledge base subscription for the company."],
  [1034, "Developer conference passes", "React Summit", 180000, "Engineering", "Learning", "maya", "Maya Chen", "rejected", "2026-11-14T13:00:00.000Z", "Three conference passes for frontend engineers."],
  [1033, "USB-C docking stations", "CalDigit", 75900, "Engineering", "Equipment", "maya", "Maya Chen", "draft", "2026-11-23T08:00:00.000Z", "Three docking stations for the platform team."],
  [1032, "User research participant incentives", "Tremendous", 125000, "Design", "Research", "admin", "Niraj Mohabey", "submitted", "2026-11-21T09:00:00.000Z", "Incentives for a moderated usability study with 25 participants."],
  [1031, "AWS development environment", "Amazon Web Services", 210000, "Engineering", "Infrastructure", "maya", "Maya Chen", "submitted", "2026-11-20T12:00:00.000Z", "Development environment capacity for the next release cycle."],
] as const;
export async function ensureWorkspace(db: Database, owner: string, org = "atlas") {
  const scope = await scopeFor(owner, org);
  const existing = await one(db, "SELECT seeded FROM workspaces WHERE scope=? AND owner=?", scope, owner);
  if (existing?.seeded) return scope;
  const statements: Statement[] = [prep(db, "INSERT OR IGNORE INTO workspaces(scope,owner,org,name,secret,seeded,created_at) VALUES(?,?,?,?,?,0,?)", scope, owner, org, org === "atlas" ? "Atlas Studio" : "Nova Labs", token() + token(), now())];
  const gate = "EXISTS(SELECT 1 FROM workspaces WHERE scope=? AND seeded=0)";
  for (const [id, department, limit] of [["eng", "Engineering", 4800000], ["design", "Design", 1800000], ["ops", "Operations", 1200000]] as const) {
    statements.push(prep(db, `INSERT OR IGNORE INTO budgets(scope,id,department,period,limit_cents,reserved_cents,spent_cents) SELECT ?,?,?,?, ?,0,0 WHERE ${gate}`, scope, id, department, "2026-11", limit, scope));
  }
  for (const [number, title, vendor, amount, department, category, requester, requesterName, status, created, description] of titles) {
    const id = `REQ-${number}`;
    const budget = department === "Engineering" ? "eng" : department === "Design" ? "design" : "ops";
    statements.push(prep(db, `INSERT OR IGNORE INTO requests(scope,id,number,title,vendor,amount_cents,budget_id,department,category,needed_by,description,status,requester_id,requester_name,event_actor,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,? WHERE ${gate}`, scope,id,number,title,vendor,amount,budget,department,category,"2026-11-30",description,requester,requesterName,requester,created,created,scope));
    if (status !== "draft") statements.push(prep(db, `UPDATE requests SET status='submitted',updated_at=?,event_actor=? WHERE scope=? AND id=? AND status='draft' AND ${gate}`,created,requester,scope,id,scope));
    if (["approved","ordered","received"].includes(status)) statements.push(prep(db, `UPDATE requests SET status='approved',updated_at=?,event_actor='alex' WHERE scope=? AND id=? AND status='submitted' AND ${gate}`,created,scope,id,scope));
    if (["ordered","received"].includes(status)) {
      statements.push(prep(db, `INSERT OR IGNORE INTO vendor_orders(scope,order_id,amount_cents,accepted_at) SELECT ?,?,?,? WHERE ${gate}`,scope,`PO-${number}`,amount,created,scope));
      statements.push(prep(db, `UPDATE outbox SET status='delivered',attempts=1 WHERE scope=? AND order_id=? AND ${gate}`,scope,`PO-${number}`,scope));
      statements.push(prep(db, `UPDATE purchase_orders SET status='dispatched' WHERE scope=? AND id=? AND ${gate}`,scope,`PO-${number}`,scope));
      statements.push(prep(db, `UPDATE requests SET status='ordered',event_actor='vendor',updated_at=? WHERE scope=? AND id=? AND status='approved' AND ${gate}`,created,scope,id,scope));
    }
    if (status === "received") statements.push(prep(db, `INSERT OR IGNORE INTO receipts(scope,event_id,order_id,body_hash,amount_cents,currency,received_at) SELECT ?,?,?,?,?,'USD',? WHERE ${gate}`,scope,`seed-${number}`,`PO-${number}`,`seed-${number}`,amount,created,scope));
    if (status === "rejected") statements.push(prep(db, `UPDATE requests SET status='rejected',event_actor='alex',reason='Please use the learning budget next quarter.',updated_at=? WHERE scope=? AND id=? AND status='submitted' AND ${gate}`,created,scope,id,scope));
  }
  statements.push(prep(db,"UPDATE workspaces SET seeded=1 WHERE scope=?",scope));
  await db.batch(statements);
  return scope;
}
function requestView(r: Row) {
  return { id:r.id,number:r.number,title:r.title,vendor:r.vendor,amountCents:r.amount_cents,department:r.department,category:r.category,neededBy:r.needed_by,description:r.description,status:r.status,requesterId:r.requester_id,requesterName:r.requester_name,budgetId:r.budget_id,createdAt:r.created_at,updatedAt:r.updated_at,orderId:r.order_id ?? null,orderStatus:r.order_status ?? null,reason:r.reason ?? null };
}
export async function snapshot(db: Database, owner: string, org = "atlas", actorId = "alex") {
  const actor = actorFor(actorId);
  const scope = await ensureWorkspace(db,owner,org);
  const ownOnly = actor.role === "employee";
  const [workspace, budgetRows, requestRows, events, jobs, vendor] = await Promise.all([
    one(db,"SELECT name,org FROM workspaces WHERE scope=? AND owner=?",scope,owner),
    many(db,"SELECT * FROM budgets WHERE scope=? ORDER BY limit_cents DESC",scope),
    many(db,`SELECT r.*,p.id AS order_id,p.status AS order_status FROM requests r LEFT JOIN purchase_orders p ON p.scope=r.scope AND p.request_id=r.id WHERE r.scope=? ${ownOnly ? "AND r.requester_id=?" : ""} ORDER BY r.number DESC LIMIT 500`,...([scope,...(ownOnly?[actorId]:[])])),
    many(db,`SELECT a.* FROM audit a WHERE a.scope=? ${ownOnly?"AND EXISTS(SELECT 1 FROM requests r WHERE r.scope=a.scope AND r.id=a.request_id AND r.requester_id=?)":""} ORDER BY a.created_at DESC, a.id DESC LIMIT 250`,...([scope,...(ownOnly?[actorId]:[])])),
    ownOnly?Promise.resolve([]):many(db,"SELECT * FROM outbox WHERE scope=? ORDER BY created_at DESC LIMIT 100",scope),
    ownOnly?Promise.resolve([]):many(db,"SELECT * FROM vendor_orders WHERE scope=? ORDER BY accepted_at DESC LIMIT 100",scope),
  ]);
  return {
    workspace:{id:org,name:workspace?.name ?? "Workspace",timezone:"America/New_York",demo:true,period:"2026-11"},actor,actors:ACTORS,
    budgets:budgetRows.map(b=>({id:b.id,department:b.department,period:b.period,limitCents:b.limit_cents,reservedCents:b.reserved_cents,spentCents:b.spent_cents})),
    requests:requestRows.map(requestView),activity:events.map(a=>({id:String(a.id),requestId:a.request_id,actorName:a.actor_name,action:a.action,detail:a.detail,createdAt:a.created_at})),
    outbox:jobs.map(j=>({id:j.id,orderId:j.order_id,requestId:j.request_id,status:j.status,attempts:j.attempts,leaseUntil:j.lease_until,lastError:j.last_error})),
    vendorOrders:vendor.map(v=>({orderId:v.order_id,amountCents:v.amount_cents,acceptedAt:v.accepted_at})),
  };
}
const input = z.object({title:z.string().trim().min(3).max(120),vendor:z.string().trim().min(2).max(80),amountCents:z.number().int().min(1).max(100000000),department:z.enum(["Engineering","Design","Operations"]),category:z.enum(["Equipment","Software","Office","Infrastructure","Learning","Research","Other"]),neededBy:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(`${s}T00:00:00.000Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;},"Enter a valid calendar date"),description:z.string().trim().min(10).max(2000)});
function parseInput(value: unknown) { const r=input.safeParse(value); if(!r.success) throw new DomainError("VALIDATION_ERROR",r.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; "),422); return r.data; }
function requestId(body: Row) { if(typeof body.requestId!=="string"||body.requestId.length>80) throw new DomainError("VALIDATION_ERROR","A valid request ID is required.",422);return body.requestId; }
function dbError(error: unknown): DomainError {
  if(error instanceof DomainError)return error;
  const message=error instanceof Error?error.message:String(error);
  if(message.includes("BUDGET_EXCEEDED"))return new DomainError("BUDGET_EXCEEDED","Available budget changed. This request exceeds the remaining amount. Refresh and try a smaller purchase.");
  if(message.includes("SELF_APPROVAL"))return new DomainError("SELF_APPROVAL","You cannot approve your own request.",403);
  if(message.includes("REQUEST_IMMUTABLE"))return new DomainError("REQUEST_IMMUTABLE","Submitted requests are frozen. Create a new draft to change the purchase.");
  if(message.includes("operation_applied")||message.includes("INVALID_TRANSITION"))return new DomainError("STATE_CONFLICT","This request changed while you were working. Refresh to see its current state.");
  if(message.includes("CURRENCY_MISMATCH"))return new DomainError("CURRENCY_MISMATCH","This workspace accepts USD receipts only.",422);
  if(message.includes("RECEIPT_MISMATCH"))return new DomainError("RECEIPT_MISMATCH","Receipt amount does not match the purchase order.",422);
  return new DomainError("TEMPORARY_FAILURE","The operation could not complete. Please retry with the same key.",503);
}
async function priorResult(db: Database,scope:string,actor:string,action:string,key:string,hash:string) {
  const r=await one(db,"SELECT hash,result FROM idempotency WHERE scope=? AND actor=? AND operation=? AND key=?",scope,actor,action,key);
  if(!r)return null;
  if(r.hash!==hash)throw new DomainError("IDEMPOTENCY_CONFLICT","This retry key was already used for different input.");
  return {...JSON.parse(r.result),replayed:true};
}
async function mutate(db:Database,scope:string,actor:string,action:string,key:string,hash:string,statements:Statement[],result:Row,assertChange=true) {
  const prior=await priorResult(db,scope,actor,action,key,hash);if(prior)return prior;
  const guard=token();
  // SQLite serializes writers. PostgreSQL needs an explicit per-workspace
  // allocator lock so two valid creates cannot both choose MAX(number)+1.
  if(db.dialect==="postgres"&&action==="create")statements.unshift(prep(db,"SELECT scope FROM workspaces WHERE scope=? FOR UPDATE",scope));
  if(assertChange)statements.push(prep(db,"INSERT INTO operation_guards(id,ok) VALUES(?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)",guard),prep(db,"DELETE FROM operation_guards WHERE id=?",guard));
  statements.push(prep(db,"INSERT INTO idempotency(scope,actor,operation,key,hash,result,created_at) VALUES(?,?,?,?,?,?,?)",scope,actor,action,key,hash,JSON.stringify(result),now()));
  try {await db.batch(statements);return result;} catch(error){const replay=await priorResult(db,scope,actor,action,key,hash);if(replay)return replay;throw dbError(error);}
}
async function visibleRequest(db:Database,scope:string,id:string,actorId:string) {
  const r=await one(db,"SELECT * FROM requests WHERE scope=? AND id=?",scope,id);
  if(!r||(actorFor(actorId).role==="employee"&&r.requester_id!==actorId))throw new DomainError("NOT_FOUND","Request not found.",404);
  return r;
}
export async function executeAction(db:Database,owner:string,body:Row,key:string):Promise<Row> {
  if(!body||typeof body!=="object"||typeof body.action!=="string")throw new DomainError("VALIDATION_ERROR","Choose an action.",422);
  if(!key||key.length>128||!/^[A-Za-z0-9_.:-]+$/.test(key))throw new DomainError("IDEMPOTENCY_KEY_REQUIRED","Send an Idempotency-Key of 1–128 letters, digits, dots, colons, or dashes.",422);
  const org=typeof body.org==="string"?body.org:"atlas", actorId=typeof body.actor==="string"?body.actor:"alex";
  const actor=actorFor(actorId),scope=await ensureWorkspace(db,owner,org),action=body.action;
  const hash=await canonicalHash({method:"POST",action,org,actor:actorId,body});
  const prior=await priorResult(db,scope,actorId,action,key,hash);if(prior)return prior;
  if(action==="create"||action==="update") {
    canCreate(actorId);const data=parseInput(body),budgetId=data.department==="Engineering"?"eng":data.department==="Design"?"design":"ops";
    if(action==="create") {
      const id=`REQ-${token().slice(0,8).toUpperCase()}`,time=now();
      return mutate(db,scope,actorId,action,key,hash,[prep(db,"INSERT INTO requests(scope,id,number,title,vendor,amount_cents,budget_id,department,category,needed_by,description,status,requester_id,requester_name,event_actor,created_at,updated_at) VALUES(?,?,(SELECT COALESCE(MAX(number),1042)+1 FROM requests WHERE scope=?),?,?,?,?,?,?,?,?,'draft',?,?,?,?,?)",scope,id,scope,data.title,data.vendor,data.amountCents,budgetId,data.department,data.category,data.neededBy,data.description,actorId,actor.name,actorId,time,time)],{ok:true,requestId:id});
    }
    const id=requestId(body),r=await visibleRequest(db,scope,id,actorId);
    if(r.requester_id!==actorId)throw new DomainError("FORBIDDEN","Only the requester can edit this draft.",403);
    if(r.status!=="draft")throw new DomainError("REQUEST_IMMUTABLE","Submitted requests are frozen. Create a new draft to change the purchase.");
    return mutate(db,scope,actorId,action,key,hash,[prep(db,"UPDATE requests SET title=?,vendor=?,amount_cents=?,budget_id=?,department=?,category=?,needed_by=?,description=?,updated_at=?,event_actor=? WHERE scope=? AND id=? AND status='draft' AND requester_id=?",data.title,data.vendor,data.amountCents,budgetId,data.department,data.category,data.neededBy,data.description,now(),actorId,scope,id,actorId)],{ok:true,requestId:id});
  }
  if(["submit","approve","reject"].includes(action)) {
    const id=requestId(body),r=await visibleRequest(db,scope,id,actorId);
    if(action==="submit") {canCreate(actorId);if(r.requester_id!==actorId)throw new DomainError("FORBIDDEN","Only the requester can submit this draft.",403);if(r.status!=="draft"){const replay=await priorResult(db,scope,actorId,action,key,hash);if(replay)return replay;throw new DomainError("STATE_CONFLICT","Only drafts can be submitted.");}}
    else {canApprove(actorId);if(r.requester_id===actorId)throw new DomainError("SELF_APPROVAL","You cannot approve or reject your own request.",403);if(r.status!=="submitted"){const replay=await priorResult(db,scope,actorId,action,key,hash);if(replay)return replay;throw new DomainError("STATE_CONFLICT","Only submitted requests can be reviewed.");}}
    const reason=action==="reject"?z.string().trim().min(5).max(500).safeParse(body.reason):null;
    if(reason&&!reason.success)throw new DomainError("VALIDATION_ERROR","Give a reason between 5 and 500 characters.",422);
    const status=action==="submit"?"submitted":action==="approve"?"approved":"rejected";
    return mutate(db,scope,actorId,action,key,hash,[prep(db,"UPDATE requests SET status=?,event_actor=?,reason=?,updated_at=? WHERE scope=? AND id=? AND status=?",status,actorId,reason?.success?reason.data:null,now(),scope,id,action==="submit"?"draft":"submitted")],{ok:true,requestId:id,...(action==="approve"?{orderId:`PO-${r.number}`}:{})});
  }
  if(action==="dispatch") {
    canApprove(actorId);
    // Bind the retry key before contacting the simulated remote system. A replay
    // of an interrupted call returns its accepted operation; the leased outbox
    // remains the recovery authority, with a new operator dispatch after expiry.
    const accepted=await mutate(db,scope,actorId,action,key,hash,[],{ok:true,dispatchAccepted:true,pending:true},false);
    if(accepted.replayed)return accepted;
    const result={ok:true,...await processDispatch(db,scope,{crashAfterAccept:body.crashAfterAccept===true})};
    await prep(db,"UPDATE idempotency SET result=? WHERE scope=? AND actor=? AND operation=? AND key=? AND hash=?",JSON.stringify(result),scope,actorId,action,key,hash).run();
    return result;
  }
  if(action==="retry") {canApprove(actorId);if(typeof body.jobId!=="string")throw new DomainError("VALIDATION_ERROR","Choose a dispatch job.",422);return mutate(db,scope,actorId,action,key,hash,[prep(db,"UPDATE outbox SET status='pending',lease_token=NULL,lease_until=NULL,last_error=NULL,attempts=0 WHERE scope=? AND id=? AND (status='failed' OR (status='leased' AND lease_until<=?))",scope,body.jobId,Date.now())],{ok:true,jobId:body.jobId});}
  if(action==="receive") {
    canApprove(actorId);if(typeof body.orderId!=="string")throw new DomainError("VALIDATION_ERROR","Choose a purchase order.",422);
    const order=await one(db,"SELECT * FROM purchase_orders WHERE scope=? AND id=?",scope,body.orderId);if(!order)throw new DomainError("NOT_FOUND","Order not found.",404);
    const eventId=typeof body.eventId==="string"?body.eventId:`sim-${body.orderId}`;
    const raw=JSON.stringify({eventId,orderId:body.orderId,amountCents:order.amount_cents,currency:"USD"});const timestamp=String(Math.floor(Date.now()/1000));
    const workspace=await one(db,"SELECT secret FROM workspaces WHERE scope=?",scope);
    const signature=await signReceipt(workspace!.secret,raw,timestamp);
    const verified=await validateReceipt(db,scope,raw,timestamp,signature);
    // The receipt and the successful idempotent result commit together. A
    // conflicting concurrent retry key rolls the receipt's trigger effects back.
    const statements=[prep(db,"INSERT INTO receipts(scope,event_id,order_id,body_hash,amount_cents,currency,received_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(scope,event_id) DO UPDATE SET body_hash=excluded.body_hash WHERE receipts.body_hash=excluded.body_hash",scope,verified.value.eventId,verified.value.orderId,verified.hash,verified.value.amountCents,verified.value.currency,now())];
    try{return await mutate(db,scope,actorId,action,key,hash,statements,{ok:true,received:true,duplicate:verified.duplicate,orderId:body.orderId});}
    catch(error){const existing=await one(db,"SELECT body_hash FROM receipts WHERE scope=? AND event_id=?",scope,eventId);if(existing&&existing.body_hash!==verified.hash)throw new DomainError("EVENT_CONFLICT","This provider event ID was already used for a different receipt.");throw error;}
  }
  if(action==="lab") {canApprove(actorId);return {ok:true,...await runLab(db,owner)};}
  if(action==="reset") {if(actor.role!=="administrator")throw new DomainError("FORBIDDEN","Only the workspace administrator can reset sample data.",403);await prep(db,"DELETE FROM workspaces WHERE scope=? AND owner=?",scope,owner).run();await ensureWorkspace(db,owner,org);return {ok:true};}
  throw new DomainError("VALIDATION_ERROR","Unknown action.",422);
}
export async function claimDispatch(db:Database,scope:string,nowMs=Date.now()):Promise<(Row & {leaseToken:string;leaseUntil:number;attempts:number})|null> {
  await prep(db,"UPDATE outbox SET status='failed',lease_token=NULL,lease_until=NULL,last_error='Dispatch retry limit reached after lease expiry' WHERE scope=? AND attempts>=5 AND status='leased' AND lease_until<=?",scope,nowMs).run();
  const job=await one(db,"SELECT * FROM outbox WHERE scope=? AND attempts<5 AND (status='pending' OR (status='leased' AND lease_until<=?)) ORDER BY created_at,id LIMIT 1",scope,nowMs);
  if(!job)return null;const leaseToken=token();
  const result=await prep(db,"UPDATE outbox SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1,last_error=NULL WHERE scope=? AND id=? AND attempts<5 AND (status='pending' OR (status='leased' AND lease_until<=?))",leaseToken,nowMs+30000,scope,job.id,nowMs).run();
  if(!result.meta?.changes)return null;
  return {...job,leaseToken,leaseUntil:nowMs+30000,attempts:job.attempts+1};
}
export async function acknowledgeDispatch(db:Database,scope:string,jobId:string,leaseToken:string,nowMs=Date.now()) {
  const time=new Date(nowMs).toISOString();
  const locks=db.dialect==="postgres"?[
    prep(db,"SELECT b.id FROM budgets b JOIN requests r ON r.scope=b.scope AND r.budget_id=b.id JOIN outbox o ON o.scope=r.scope AND o.request_id=r.id WHERE o.scope=? AND o.id=? AND o.status='leased' AND o.lease_token=? FOR UPDATE OF b",scope,jobId,leaseToken),
    prep(db,"SELECT r.id FROM requests r JOIN outbox o ON o.scope=r.scope AND o.request_id=r.id WHERE o.scope=? AND o.id=? AND o.status='leased' AND o.lease_token=? FOR UPDATE OF r",scope,jobId,leaseToken),
    prep(db,"SELECT p.id FROM purchase_orders p JOIN outbox o ON o.scope=p.scope AND o.order_id=p.id WHERE o.scope=? AND o.id=? AND o.status='leased' AND o.lease_token=? FOR UPDATE OF p",scope,jobId,leaseToken),
    prep(db,"SELECT id FROM outbox WHERE scope=? AND id=? AND status='leased' AND lease_token=? FOR UPDATE",scope,jobId,leaseToken),
  ]:[];
  const statements=[...locks,
    prep(db,"UPDATE purchase_orders SET status='dispatched',updated_at=? WHERE scope=? AND status='pending_dispatch' AND id=(SELECT order_id FROM outbox WHERE scope=? AND id=? AND status='leased' AND lease_token=?)",time,scope,scope,jobId,leaseToken),
    prep(db,"UPDATE requests SET status='ordered',event_actor='vendor',updated_at=? WHERE scope=? AND status='approved' AND id=(SELECT request_id FROM outbox WHERE scope=? AND id=? AND status='leased' AND lease_token=?)",time,scope,scope,jobId,leaseToken),
    prep(db,"UPDATE outbox SET status='delivered',lease_until=NULL,lease_token=NULL,last_error=NULL WHERE scope=? AND id=? AND status='leased' AND lease_token=?",scope,jobId,leaseToken),
  ];
  const result=await db.batch(statements) as {meta?:{changes?:number}}[];
  return {acknowledged:result[result.length-1]?.meta?.changes===1};
}
export async function processDispatch(db:Database,scope:string,options:{crashAfterAccept?:boolean;nowMs?:number}={}) {
  const nowMs=options.nowMs??Date.now(),job=await claimDispatch(db,scope,nowMs);if(!job)return {processed:0,message:"No dispatch is ready."};
  try {
    const order=await one(db,"SELECT * FROM purchase_orders WHERE scope=? AND id=?",scope,job.order_id);if(!order)throw new Error("ORDER_NOT_FOUND");
    await prep(db,"INSERT OR IGNORE INTO vendor_orders(scope,order_id,amount_cents,accepted_at) VALUES(?,?,?,?)",scope,job.order_id,order.amount_cents,new Date(nowMs).toISOString()).run();
    if(options.crashAfterAccept){await prep(db,"UPDATE outbox SET last_error='Simulated crash after vendor acceptance; acknowledgement not written' WHERE scope=? AND id=? AND lease_token=?",scope,job.id,job.leaseToken).run();return {processed:1,crashed:true,orderId:job.order_id,jobId:job.id,leaseUntil:job.leaseUntil,message:"Vendor accepted. Worker stopped before acknowledgement. Replay with a fresh lease is safe."};}
    await acknowledgeDispatch(db,scope,job.id,job.leaseToken,nowMs);return {processed:1,orderId:job.order_id,jobId:job.id,crashed:false};
  }catch(error){await prep(db,"UPDATE outbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,last_error=?,lease_token=NULL,lease_until=NULL WHERE scope=? AND id=? AND status='leased' AND lease_token=?",String(error).slice(0,200),scope,job.id,job.leaseToken).run();throw dbError(error);}
}
export async function signReceipt(secret:string,raw:string,timestamp:string) {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${timestamp}.${raw}`)));
}
function constantTime(a:string,b:string){let difference=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return difference===0;}
const receiptInput=z.object({eventId:z.string().min(1).max(128),orderId:z.string().min(1).max(80),amountCents:z.number().int().positive().max(100000000),currency:z.string().length(3)}).strict();
async function validateReceipt(db:Database,scope:string,raw:string,timestamp:string,signature:string,nowMs=Date.now()) {
  if(new TextEncoder().encode(raw).length>8192)throw new DomainError("PAYLOAD_TOO_LARGE","Receipt body exceeds 8 KB.",413);
  if(!/^\d{10}$/.test(timestamp)||Math.abs(nowMs-Number(timestamp)*1000)>300000)throw new DomainError("WEBHOOK_EXPIRED","Receipt timestamp is outside the five-minute window.",401);
  const workspace=await one(db,"SELECT secret FROM workspaces WHERE scope=?",scope);
  if(!workspace||!constantTime(signature,await signReceipt(workspace.secret,raw,timestamp)))throw new DomainError("WEBHOOK_SIGNATURE_INVALID","Receipt signature is invalid.",401);
  let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new DomainError("VALIDATION_ERROR","Receipt is not valid JSON.",422);}
  const valid=receiptInput.safeParse(parsed);if(!valid.success)throw new DomainError("VALIDATION_ERROR","Receipt must include an event ID, purchase order, integer amount, and currency.",422);
  const value=valid.data,hash=await canonicalHash(value);
  const existing=await one(db,"SELECT body_hash FROM receipts WHERE scope=? AND event_id=?",scope,value.eventId);
  if(existing&&existing.body_hash!==hash)throw new DomainError("EVENT_CONFLICT","This provider event ID was already used for a different receipt.");
  const order=await one(db,"SELECT amount_cents FROM purchase_orders WHERE scope=? AND id=?",scope,value.orderId);if(!order)throw new DomainError("NOT_FOUND","Order not found.",404);
  if(value.currency!=="USD")throw new DomainError("CURRENCY_MISMATCH","This workspace accepts USD receipts only.",422);
  if(order.amount_cents!==value.amountCents)throw new DomainError("RECEIPT_MISMATCH","Receipt amount does not match the purchase order.",422);
  return {value,hash,duplicate:!!existing};
}
export async function handleReceipt(db:Database,scope:string,raw:string,timestamp:string,signature:string,nowMs=Date.now()) {
  const {value,hash,duplicate}=await validateReceipt(db,scope,raw,timestamp,signature,nowMs);
  if(duplicate)return {received:true,duplicate:true,orderId:value.orderId};
  try{await prep(db,"INSERT INTO receipts(scope,event_id,order_id,body_hash,amount_cents,currency,received_at) VALUES(?,?,?,?,?,?,?)",scope,value.eventId,value.orderId,hash,value.amountCents,value.currency,new Date(nowMs).toISOString()).run();}
  catch(error){const retry=await one(db,"SELECT body_hash FROM receipts WHERE scope=? AND event_id=?",scope,value.eventId);if(retry){if(retry.body_hash!==hash)throw new DomainError("EVENT_CONFLICT","This provider event ID was already used for a different receipt.");return {received:true,duplicate:true,orderId:value.orderId};}throw dbError(error);}
  return {received:true,duplicate:false,orderId:value.orderId};
}
export async function runLab(db:Database,owner:string) {
  const runId=token(),scope=`lab:${(await canonicalHash(owner)).slice(0,24)}:${runId}`,time=now();const start=Date.now();
  const checks:{name:string;passed:boolean;detail:string}[]=[];
  try {
    await db.batch([
      prep(db,"INSERT INTO workspaces(scope,owner,org,name,secret,seeded,created_at) VALUES(?,?, 'lab','Reliability lab',?,1,?)",scope,owner,token()+token(),time),
      prep(db,"INSERT INTO budgets(scope,id,department,period,limit_cents,reserved_cents,spent_cents) VALUES(?,'lab','Engineering','2026-11',10000,0,0)",scope),
      ...[1,2].map(i=>prep(db,"INSERT INTO requests(scope,id,number,title,vendor,amount_cents,budget_id,department,category,needed_by,description,status,requester_id,requester_name,event_actor,created_at,updated_at) VALUES(?,?,?,'Race test purchase','Simulated vendor',7000,'lab','Engineering','Equipment','2026-11-30','Controlled race fixture','submitted','maya','Maya Chen','maya',?,?)",scope,`RACE-${i}`,i,time,time)),
    ]);
    const approve=async(id:string)=>{try{await db.batch([prep(db,"UPDATE requests SET status='approved',event_actor='alex',updated_at=? WHERE scope=? AND id=? AND status='submitted'",now(),scope,id)]);return {id,approved:true};}catch(error){return {id,approved:false,error:dbError(error).code};}};
    const race=await Promise.all([approve("RACE-1"),approve("RACE-2")]);
    const budget=await one(db,"SELECT * FROM budgets WHERE scope=? AND id='lab'",scope);
    checks.push({name:"Competing approvals",passed:race.filter(r=>r.approved).length===1&&budget?.reserved_cents===7000,detail:`Two $70 requests competed for $100. ${race.filter(r=>r.approved).length} approved; $${((10000-(budget?.reserved_cents??0))/100).toFixed(2)} remains.`});
    const crash=await processDispatch(db,scope,{crashAfterAccept:true});
    const replay=await processDispatch(db,scope,{nowMs:Date.now()+31000});
    const vendor=await one(db,"SELECT COUNT(*) AS n FROM vendor_orders WHERE scope=?",scope);
    checks.push({name:"Crash recovery",passed:!!crash.crashed&&replay.processed===1&&vendor?.n===1,detail:"Worker stopped after vendor acceptance. Expired lease replay retained exactly one vendor order."});
    const order=await one(db,"SELECT * FROM purchase_orders WHERE scope=?",scope);
    const workspace=await one(db,"SELECT secret FROM workspaces WHERE scope=?",scope);
    const raw=JSON.stringify({eventId:"lab-receipt",orderId:order!.id,amountCents:7000,currency:"USD"}),timestamp=String(Math.floor(Date.now()/1000)),signature=await signReceipt(workspace!.secret,raw,timestamp);
    const receipts=await Promise.all([handleReceipt(db,scope,raw,timestamp,signature),handleReceipt(db,scope,raw,timestamp,signature)]);
    const finalBudget=await one(db,"SELECT * FROM budgets WHERE scope=?",scope);
    checks.push({name:"Duplicate receipt",passed:finalBudget?.reserved_cents===0&&finalBudget?.spent_cents===7000&&receipts.some(r=>r.duplicate),detail:"The same signed receipt arrived twice. Reserved $0; spent $70; one event applied."});
    const foreignScope=await scopeFor(owner,"nova");let denied=false;
    try{await visibleRequest(db,foreignScope,order!.request_id,"alex");}catch(error){denied=error instanceof DomainError&&error.code==="NOT_FOUND";}
    checks.push({name:"Tenant isolation",passed:denied,detail:"The domain request lookup rejected the same request ID under a different organization scope."});
    let invalid=false;try{await handleReceipt(db,scope,raw,timestamp,"0".repeat(64));}catch(error){invalid=error instanceof DomainError&&error.code==="WEBHOOK_SIGNATURE_INVALID";}
    checks.push({name:"Signature validation",passed:invalid,detail:"A tampered signature was rejected before any accounting change."});
    return {runId,checks,durationMs:Date.now()-start,createdAt:now(),evidence:{budgetLimitCents:10000,availableCents:3000,reservedCents:finalBudget?.reserved_cents,spentCents:finalBudget?.spent_cents,vendorOrderCount:vendor?.n,race}};
  }finally{await prep(db,"DELETE FROM workspaces WHERE scope=? AND owner=?",scope,owner).run();}
}
