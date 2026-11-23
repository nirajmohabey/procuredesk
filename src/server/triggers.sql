CREATE TRIGGER request_frozen BEFORE UPDATE ON requests
WHEN OLD.status != 'draft' AND (NEW.amount_cents != OLD.amount_cents OR NEW.budget_id != OLD.budget_id OR NEW.title != OLD.title OR NEW.vendor != OLD.vendor OR NEW.department != OLD.department OR NEW.category != OLD.category OR NEW.needed_by != OLD.needed_by OR NEW.description != OLD.description OR NEW.requester_id != OLD.requester_id)
BEGIN SELECT RAISE(ABORT, 'REQUEST_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER request_transition BEFORE UPDATE OF status ON requests
WHEN NEW.status != OLD.status AND NOT ((OLD.status = 'draft' AND NEW.status = 'submitted') OR (OLD.status = 'submitted' AND NEW.status IN ('approved','rejected')) OR (OLD.status = 'approved' AND NEW.status IN ('ordered','received')) OR (OLD.status = 'ordered' AND NEW.status = 'received'))
BEGIN SELECT RAISE(ABORT, 'INVALID_TRANSITION'); END;
--> statement-breakpoint
CREATE TRIGGER approval_check BEFORE UPDATE OF status ON requests WHEN NEW.status = 'approved' AND OLD.status = 'submitted'
BEGIN
 SELECT CASE WHEN NEW.event_actor = OLD.requester_id THEN RAISE(ABORT,'SELF_APPROVAL') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM budgets WHERE scope=OLD.scope AND id=OLD.budget_id AND limit_cents-reserved_cents-spent_cents >= OLD.amount_cents) THEN RAISE(ABORT,'BUDGET_EXCEEDED') END;
END;
--> statement-breakpoint
CREATE TRIGGER approval_effects AFTER UPDATE OF status ON requests WHEN NEW.status = 'approved' AND OLD.status = 'submitted'
BEGIN
 UPDATE budgets SET reserved_cents=reserved_cents+NEW.amount_cents WHERE scope=NEW.scope AND id=NEW.budget_id;
 INSERT INTO purchase_orders(scope,id,request_id,amount_cents,status,created_at,updated_at) VALUES(NEW.scope,'PO-'||NEW.number,NEW.id,NEW.amount_cents,'pending_dispatch',NEW.updated_at,NEW.updated_at);
 INSERT INTO outbox(scope,id,order_id,request_id,status,attempts,created_at) VALUES(NEW.scope,'JOB-'||NEW.number,'PO-'||NEW.number,NEW.id,'pending',0,NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER request_created AFTER INSERT ON requests
BEGIN
 INSERT INTO audit(scope,request_id,actor_name,action,detail,created_at) VALUES(NEW.scope,NEW.id,NEW.requester_name,'created','Purchase request drafted',NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER request_audit AFTER UPDATE OF status ON requests WHEN NEW.status != OLD.status
BEGIN
 INSERT INTO audit(scope,request_id,actor_name,action,detail,created_at) VALUES(NEW.scope,NEW.id,CASE NEW.event_actor WHEN 'maya' THEN 'Maya Chen' WHEN 'alex' THEN 'Alex Morgan' WHEN 'jordan' THEN 'Jordan Lee' WHEN 'admin' THEN 'Niraj Mohabey' ELSE 'Vendor simulator' END,NEW.status,CASE NEW.status WHEN 'submitted' THEN 'Submitted for manager approval' WHEN 'approved' THEN 'Budget reserved; purchase order and dispatch created atomically' WHEN 'ordered' THEN 'Simulated vendor accepted the purchase order' WHEN 'received' THEN 'Signed receipt verified; reserved funds moved to spent' WHEN 'rejected' THEN COALESCE(NEW.reason,'Request declined') ELSE 'State changed' END,NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER receipt_check BEFORE INSERT ON receipts
BEGIN
 SELECT CASE WHEN NEW.currency != 'USD' THEN RAISE(ABORT,'CURRENCY_MISMATCH') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM purchase_orders WHERE scope=NEW.scope AND id=NEW.order_id AND amount_cents=NEW.amount_cents) THEN RAISE(ABORT,'RECEIPT_MISMATCH') END;
END;
--> statement-breakpoint
CREATE TRIGGER receipt_effects AFTER INSERT ON receipts
BEGIN
 UPDATE budgets SET reserved_cents=reserved_cents-NEW.amount_cents,spent_cents=spent_cents+NEW.amount_cents WHERE scope=NEW.scope AND id=(SELECT budget_id FROM requests WHERE scope=NEW.scope AND id=(SELECT request_id FROM purchase_orders WHERE scope=NEW.scope AND id=NEW.order_id)) AND EXISTS(SELECT 1 FROM purchase_orders WHERE scope=NEW.scope AND id=NEW.order_id AND status != 'received');
 UPDATE requests SET status='received',event_actor='vendor',updated_at=NEW.received_at WHERE scope=NEW.scope AND id=(SELECT request_id FROM purchase_orders WHERE scope=NEW.scope AND id=NEW.order_id) AND status IN ('approved','ordered');
 UPDATE purchase_orders SET status='received',updated_at=NEW.received_at WHERE scope=NEW.scope AND id=NEW.order_id AND status != 'received';
END;
