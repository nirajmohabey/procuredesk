import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, uniqueIndex, check, foreignKey } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  scope: text("scope").primaryKey(), owner: text("owner").notNull(), org: text("org").notNull(),
  name: text("name").notNull(), secret: text("secret").notNull(), seeded: integer("seeded").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
export const budgets = sqliteTable("budgets", {
  scope: text("scope").notNull().references(() => workspaces.scope, { onDelete: "cascade" }), id: text("id").notNull(),
  department: text("department").notNull(), period: text("period").notNull(), limitCents: integer("limit_cents").notNull(),
  reservedCents: integer("reserved_cents").notNull().default(0), spentCents: integer("spent_cents").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.scope, t.id] }), check("budget_nonnegative", sql`${t.limitCents} >= 0 AND ${t.reservedCents} >= 0 AND ${t.spentCents} >= 0 AND ${t.reservedCents} + ${t.spentCents} <= ${t.limitCents}`)]);
export const requests = sqliteTable("requests", {
  scope: text("scope").notNull(), id: text("id").notNull(), number: integer("number").notNull(),
  title: text("title").notNull(), vendor: text("vendor").notNull(), amountCents: integer("amount_cents").notNull(),
  budgetId: text("budget_id").notNull(), department: text("department").notNull(), category: text("category").notNull(),
  neededBy: text("needed_by").notNull(), description: text("description").notNull(), status: text("status").notNull().default("draft"),
  requesterId: text("requester_id").notNull(), requesterName: text("requester_name").notNull(), eventActor: text("event_actor").notNull(),
  reason: text("reason"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.scope, t.id] }), uniqueIndex("request_number").on(t.scope,t.number),
  foreignKey({ columns: [t.scope,t.budgetId], foreignColumns: [budgets.scope,budgets.id] }).onDelete("cascade"),
  check("request_amount",sql`${t.amountCents} > 0 AND ${t.amountCents} <= 100000000`),
  check("request_status",sql`${t.status} IN ('draft','submitted','approved','ordered','received','rejected')`)]);
export const purchaseOrders = sqliteTable("purchase_orders", {
  scope: text("scope").notNull(), id: text("id").notNull(), requestId: text("request_id").notNull(), amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("pending_dispatch"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({columns:[t.scope,t.id]}),uniqueIndex("one_order_per_request").on(t.scope,t.requestId),
  foreignKey({columns:[t.scope,t.requestId],foreignColumns:[requests.scope,requests.id]}).onDelete("cascade"),
  check("order_status",sql`${t.status} IN ('pending_dispatch','dispatched','received')`)]);
export const outbox = sqliteTable("outbox", {
  scope: text("scope").notNull(), id: text("id").notNull(), orderId: text("order_id").notNull(), requestId: text("request_id").notNull(),
  status: text("status").notNull().default("pending"), attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"), leaseUntil: integer("lease_until"), lastError: text("last_error"), createdAt: text("created_at").notNull(),
}, (t) => [primaryKey({columns:[t.scope,t.id]}),uniqueIndex("one_dispatch_per_order").on(t.scope,t.orderId),
  foreignKey({columns:[t.scope,t.orderId],foreignColumns:[purchaseOrders.scope,purchaseOrders.id]}).onDelete("cascade"),
  check("outbox_status",sql`${t.status} IN ('pending','leased','delivered','failed')`)]);
export const vendorOrders = sqliteTable("vendor_orders", {
  scope: text("scope").notNull(), orderId: text("order_id").notNull(), amountCents: integer("amount_cents").notNull(), acceptedAt: text("accepted_at").notNull(),
}, (t)=>[primaryKey({columns:[t.scope,t.orderId]}),foreignKey({columns:[t.scope,t.orderId],foreignColumns:[purchaseOrders.scope,purchaseOrders.id]}).onDelete("cascade")]);
export const receipts = sqliteTable("receipts", {
  scope: text("scope").notNull(), eventId: text("event_id").notNull(), orderId: text("order_id").notNull(), bodyHash: text("body_hash").notNull(),
  amountCents: integer("amount_cents").notNull(), currency: text("currency").notNull(), receivedAt: text("received_at").notNull(),
},(t)=>[primaryKey({columns:[t.scope,t.eventId]}),foreignKey({columns:[t.scope,t.orderId],foreignColumns:[purchaseOrders.scope,purchaseOrders.id]}).onDelete("cascade")]);
export const audit = sqliteTable("audit", {
  id: integer("id").primaryKey({autoIncrement:true}), scope: text("scope").notNull().references(()=>workspaces.scope,{onDelete:"cascade"}),
  requestId: text("request_id").notNull(), actorName: text("actor_name").notNull(), action: text("action").notNull(), detail: text("detail").notNull(), createdAt: text("created_at").notNull(),
});
export const idempotency = sqliteTable("idempotency", {
  scope: text("scope").notNull().references(()=>workspaces.scope,{onDelete:"cascade"}), actor: text("actor").notNull(), operation: text("operation").notNull(), key: text("key").notNull(),
  hash: text("hash").notNull(), result: text("result").notNull(), createdAt: text("created_at").notNull(),
}, (t)=>[primaryKey({columns:[t.scope,t.actor,t.operation,t.key]})]);
export const operationGuards = sqliteTable("operation_guards",{id: text("id").primaryKey(),ok:integer("ok").notNull()},(t)=>[check("operation_applied",sql`${t.ok}=1`)]);
