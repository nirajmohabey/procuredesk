-- Native PostgreSQL schema for the new dedicated ProcureDesk database.
-- Legacy D1/SQLite migration history remains unchanged in drizzle/.
CREATE TABLE workspaces (
 scope text PRIMARY KEY, owner text NOT NULL, org text NOT NULL, name text NOT NULL,
 secret text NOT NULL, seeded integer NOT NULL DEFAULT 0 CHECK(seeded IN (0,1)), created_at text NOT NULL
);
CREATE TABLE budgets (
 scope text NOT NULL REFERENCES workspaces(scope) ON DELETE CASCADE, id text NOT NULL,
 department text NOT NULL, period text NOT NULL, limit_cents integer NOT NULL,
 reserved_cents integer NOT NULL DEFAULT 0, spent_cents integer NOT NULL DEFAULT 0,
 PRIMARY KEY(scope,id),
 CONSTRAINT budget_nonnegative CHECK(limit_cents>=0 AND reserved_cents>=0 AND spent_cents>=0 AND reserved_cents+spent_cents<=limit_cents)
);
CREATE TABLE requests (
 scope text NOT NULL, id text NOT NULL, number integer NOT NULL, title text NOT NULL, vendor text NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>0 AND amount_cents<=100000000), budget_id text NOT NULL,
 department text NOT NULL, category text NOT NULL, needed_by text NOT NULL, description text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','ordered','received','rejected')),
 requester_id text NOT NULL, requester_name text NOT NULL, event_actor text NOT NULL, reason text,
 created_at text NOT NULL, updated_at text NOT NULL, PRIMARY KEY(scope,id), UNIQUE(scope,number),
 FOREIGN KEY(scope,budget_id) REFERENCES budgets(scope,id) ON DELETE CASCADE
);
CREATE TABLE purchase_orders (
 scope text NOT NULL, id text NOT NULL, request_id text NOT NULL, amount_cents integer NOT NULL,
 status text NOT NULL DEFAULT 'pending_dispatch' CHECK(status IN ('pending_dispatch','dispatched','received')),
 created_at text NOT NULL, updated_at text NOT NULL, PRIMARY KEY(scope,id), UNIQUE(scope,request_id),
 FOREIGN KEY(scope,request_id) REFERENCES requests(scope,id) ON DELETE CASCADE
);
CREATE TABLE outbox (
 scope text NOT NULL, id text NOT NULL, order_id text NOT NULL, request_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','delivered','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), lease_token text, lease_until bigint, last_error text,
 created_at text NOT NULL, PRIMARY KEY(scope,id), UNIQUE(scope,order_id),
 FOREIGN KEY(scope,order_id) REFERENCES purchase_orders(scope,id) ON DELETE CASCADE
);
CREATE TABLE vendor_orders (
 scope text NOT NULL, order_id text NOT NULL, amount_cents integer NOT NULL, accepted_at text NOT NULL,
 PRIMARY KEY(scope,order_id), FOREIGN KEY(scope,order_id) REFERENCES purchase_orders(scope,id) ON DELETE CASCADE
);
CREATE TABLE receipts (
 scope text NOT NULL, event_id text NOT NULL, order_id text NOT NULL, body_hash text NOT NULL,
 amount_cents integer NOT NULL, currency text NOT NULL, received_at text NOT NULL,
 PRIMARY KEY(scope,event_id), FOREIGN KEY(scope,order_id) REFERENCES purchase_orders(scope,id) ON DELETE CASCADE
);
CREATE TABLE audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, scope text NOT NULL REFERENCES workspaces(scope) ON DELETE CASCADE,
 request_id text NOT NULL, actor_name text NOT NULL, action text NOT NULL, detail text NOT NULL, created_at text NOT NULL
);
CREATE INDEX audit_scope_time ON audit(scope,created_at DESC,id DESC);
CREATE TABLE idempotency (
 scope text NOT NULL REFERENCES workspaces(scope) ON DELETE CASCADE, actor text NOT NULL, operation text NOT NULL,
 key text NOT NULL, hash text NOT NULL, result text NOT NULL, created_at text NOT NULL,
 PRIMARY KEY(scope,actor,operation,key)
);
CREATE TABLE operation_guards (id text PRIMARY KEY, ok integer NOT NULL, CONSTRAINT operation_applied CHECK(ok=1));

CREATE FUNCTION pd_request_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b budgets%ROWTYPE;
BEGIN
 IF OLD.status<>'draft' AND
  (NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.budget_id IS DISTINCT FROM OLD.budget_id OR
   NEW.title IS DISTINCT FROM OLD.title OR NEW.vendor IS DISTINCT FROM OLD.vendor OR NEW.department IS DISTINCT FROM OLD.department OR
   NEW.category IS DISTINCT FROM OLD.category OR NEW.needed_by IS DISTINCT FROM OLD.needed_by OR NEW.description IS DISTINCT FROM OLD.description OR
   NEW.requester_id IS DISTINCT FROM OLD.requester_id) THEN
  RAISE EXCEPTION 'REQUEST_IMMUTABLE' USING ERRCODE='P0001';
 END IF;
 IF NEW.status<>OLD.status AND NOT
  ((OLD.status='draft' AND NEW.status='submitted') OR (OLD.status='submitted' AND NEW.status IN ('approved','rejected')) OR
   (OLD.status='approved' AND NEW.status IN ('ordered','received')) OR (OLD.status='ordered' AND NEW.status='received')) THEN
  RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE='P0001';
 END IF;
 IF NEW.status='approved' AND OLD.status='submitted' THEN
  IF NEW.event_actor=OLD.requester_id THEN RAISE EXCEPTION 'SELF_APPROVAL' USING ERRCODE='P0001'; END IF;
  -- Independent approvals of different requests serialize on this actual budget
  -- row. Availability is checked AFTER acquiring its lock, not in a stale UI read.
  SELECT * INTO b FROM budgets WHERE scope=OLD.scope AND id=OLD.budget_id FOR UPDATE;
  IF NOT FOUND OR b.limit_cents-b.reserved_cents-b.spent_cents<OLD.amount_cents THEN
   RAISE EXCEPTION 'BUDGET_EXCEEDED' USING ERRCODE='P0001';
  END IF;
  UPDATE budgets SET reserved_cents=reserved_cents+OLD.amount_cents WHERE scope=OLD.scope AND id=OLD.budget_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER request_before_update BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION pd_request_before_update();

CREATE FUNCTION pd_request_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO audit(scope,request_id,actor_name,action,detail,created_at)
 VALUES(NEW.scope,NEW.id,NEW.requester_name,'created','Purchase request drafted',NEW.created_at);
 RETURN NEW;
END $$;
CREATE TRIGGER request_created AFTER INSERT ON requests FOR EACH ROW EXECUTE FUNCTION pd_request_after_insert();

CREATE FUNCTION pd_request_after_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='approved' AND OLD.status='submitted' THEN
  INSERT INTO purchase_orders(scope,id,request_id,amount_cents,status,created_at,updated_at)
   VALUES(NEW.scope,'PO-'||NEW.number,NEW.id,NEW.amount_cents,'pending_dispatch',NEW.updated_at,NEW.updated_at);
  INSERT INTO outbox(scope,id,order_id,request_id,status,attempts,created_at)
   VALUES(NEW.scope,'JOB-'||NEW.number,'PO-'||NEW.number,NEW.id,'pending',0,NEW.updated_at);
 END IF;
 IF NEW.status<>OLD.status THEN
  INSERT INTO audit(scope,request_id,actor_name,action,detail,created_at)
  VALUES(NEW.scope,NEW.id,
   CASE NEW.event_actor WHEN 'maya' THEN 'Maya Chen' WHEN 'alex' THEN 'Alex Morgan' WHEN 'jordan' THEN 'Jordan Lee' WHEN 'admin' THEN 'Niraj Mohabey' ELSE 'Vendor simulator' END,
   NEW.status,
   CASE NEW.status WHEN 'submitted' THEN 'Submitted for manager approval' WHEN 'approved' THEN 'Budget reserved; purchase order and dispatch created atomically'
    WHEN 'ordered' THEN 'Simulated vendor accepted the purchase order' WHEN 'received' THEN 'Signed receipt verified; reserved funds moved to spent'
    WHEN 'rejected' THEN COALESCE(NEW.reason,'Request declined') ELSE 'State changed' END,NEW.updated_at);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER request_after_update AFTER UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION pd_request_after_update();

CREATE FUNCTION pd_receipt_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_orders%ROWTYPE; r requests%ROWTYPE;
BEGIN
 IF NEW.currency<>'USD' THEN RAISE EXCEPTION 'CURRENCY_MISMATCH' USING ERRCODE='P0001'; END IF;
 SELECT * INTO p FROM purchase_orders WHERE scope=NEW.scope AND id=NEW.order_id;
 IF NOT FOUND OR p.amount_cents<>NEW.amount_cents THEN RAISE EXCEPTION 'RECEIPT_MISMATCH' USING ERRCODE='P0001'; END IF;
 SELECT * INTO r FROM requests WHERE scope=NEW.scope AND id=p.request_id;
 -- Match dispatch acknowledgement's lock order: budget, request, then order.
 -- The second receipt waits here, then observes the first receipt's terminal
 -- order state before deciding whether any money remains to be transferred.
 PERFORM 1 FROM budgets WHERE scope=NEW.scope AND id=r.budget_id FOR UPDATE;
 PERFORM 1 FROM requests WHERE scope=NEW.scope AND id=p.request_id FOR UPDATE;
 PERFORM 1 FROM purchase_orders WHERE scope=NEW.scope AND id=NEW.order_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_before_insert BEFORE INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION pd_receipt_before_insert();

CREATE FUNCTION pd_receipt_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_orders%ROWTYPE; r requests%ROWTYPE;
BEGIN
 SELECT * INTO p FROM purchase_orders WHERE scope=NEW.scope AND id=NEW.order_id;
 IF p.status<>'received' THEN
  SELECT * INTO r FROM requests WHERE scope=NEW.scope AND id=p.request_id;
  UPDATE budgets SET reserved_cents=reserved_cents-NEW.amount_cents,spent_cents=spent_cents+NEW.amount_cents
   WHERE scope=NEW.scope AND id=r.budget_id;
  UPDATE requests SET status='received',event_actor='vendor',updated_at=NEW.received_at
   WHERE scope=NEW.scope AND id=p.request_id AND status IN ('approved','ordered');
  UPDATE purchase_orders SET status='received',updated_at=NEW.received_at WHERE scope=NEW.scope AND id=NEW.order_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_after_insert AFTER INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION pd_receipt_after_insert();
