import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {createPostgresDatabase} from '../src/server/postgres.ts';
import * as service from '../src/server/service.ts';

try{process.loadEnvFile?.('.env.local');}catch(error){if(error.code!=='ENOENT')throw error;}
const connectionString=process.env.POSTGRES_TEST_DATABASE_URL||process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!connectionString)throw new Error('Set POSTGRES_TEST_DATABASE_URL or the dedicated ProcureDesk DATABASE_URL before running PostgreSQL integration tests.');
const db=createPostgresDatabase(connectionString),owners=new Set();
const key=()=>randomUUID();
after(async()=>{try{for(const owner of owners)await db.prepare('DELETE FROM workspaces WHERE owner=?').bind(owner).run();}finally{await db.close();}});

async function race(argsList,options={}){
 const barrier=new SharedArrayBuffer(4),signal=new Int32Array(barrier);let ready=0;
 const workers=[],promises=argsList.map(args=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./postgres-race-worker.mjs',import.meta.url),{workerData:{connectionString,barrier,args,...options}});workers.push(worker);
  const timer=setTimeout(()=>reject(new Error('PostgreSQL race worker timed out')),90000);
  worker.on('message',message=>{if(message.type==='ready'){ready++;if(ready===argsList.length){Atomics.store(signal,0,1);Atomics.notify(signal,0,argsList.length);}}else if(message.type==='result'){clearTimeout(timer);resolve(message);}});
  worker.once('error',error=>{clearTimeout(timer);reject(error);});
  worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(new Error('PostgreSQL race worker exited '+code));}});
 }));
 try{return await Promise.all(promises);}finally{await Promise.all(workers.map(worker=>worker.terminate()));}
}
async function fixture(){
 const owner='pg-integration-'+randomUUID();owners.add(owner);const org='atlas';
 await service.ensureWorkspace(db,owner,org);const scope=await service.scopeFor(owner,org);
 const f={db,owner,org,scope};await clear(f);return f;
}
async function clear(f){await db.batch([
 db.prepare('DELETE FROM requests WHERE scope=?').bind(f.scope),
 db.prepare('DELETE FROM audit WHERE scope=?').bind(f.scope),
 db.prepare('DELETE FROM idempotency WHERE scope=?').bind(f.scope),
 db.prepare('UPDATE budgets SET reserved_cents=0,spent_cents=0,limit_cents=10000 WHERE scope=?').bind(f.scope),
]);}
const action=(f,actionName,fields={},actor='maya',idempotencyKey=key())=>service.executeAction(db,f.owner,{action:actionName,actor,org:f.org,...fields},idempotencyKey);
async function submitted(f,amountCents=7000,actor='maya'){
 const result=await action(f,'create',{title:'PostgreSQL test purchase',vendor:'Test vendor',amountCents,department:'Engineering',category:'Equipment',neededBy:'2026-11-30',description:'An isolated PostgreSQL acceptance fixture.'},actor);
 await action(f,'submit',{requestId:result.requestId},actor);return result.requestId;
}
async function approved(f,amount=7000){const requestId=await submitted(f,amount);const result=await action(f,'approve',{requestId},'alex');return {requestId,orderId:result.orderId};}
const budget=f=>db.prepare("SELECT * FROM budgets WHERE scope=? AND id='eng'").bind(f.scope).first();
const count=async(f,table)=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scope=?`).bind(f.scope).first()).n;
async function rejected(promise,code){try{await promise;assert.fail('Expected '+code);}catch(error){if(error.code==='ERR_ASSERTION')throw error;assert.equal(error.code,code,error.message);}}
async function receipt(f,orderId,options={}){
 const secret=(await db.prepare('SELECT secret FROM workspaces WHERE scope=?').bind(f.scope).first()).secret;
 const raw=JSON.stringify({eventId:'evt-'+randomUUID(),orderId,amountCents:7000,currency:'USD',...options}),timestamp=String(Math.floor(Date.now()/1000));
 return [f.scope,raw,timestamp,await service.signReceipt(secret,raw,timestamp)];
}

test('PG01: 25 independent-connection approval races preserve one reservation',{timeout:600000},async()=>{
 const f=await fixture();
 for(let repetition=0;repetition<25;repetition++){
  if(repetition)await clear(f);
  const ids=[await submitted(f),await submitted(f)];
  const outcomes=await race(ids.map(requestId=>[f.owner,{action:'approve',actor:'alex',org:f.org,requestId},key()]));
  assert.equal(outcomes.filter(x=>x.ok).length,1,JSON.stringify(outcomes));
  assert.equal(outcomes.find(x=>!x.ok).error.code,'BUDGET_EXCEEDED');
  const b=await budget(f);assert.equal(b.reserved_cents,7000);assert.equal(b.spent_cents,0);assert.equal(b.limit_cents-b.reserved_cents-b.spent_cents,3000);
  assert.equal(await count(f,'purchase_orders'),1);assert.equal(await count(f,'outbox'),1);
 }
});
test('PG02: first-use seeding and request-number allocation survive concurrent connections',{timeout:180000},async()=>{
 const owner='pg-integration-'+randomUUID();owners.add(owner);
 const seeded=await race([[owner,'atlas'],[owner,'atlas']],{ensure:true});assert.ok(seeded.every(x=>x.ok),JSON.stringify(seeded));
 const scope=await service.scopeFor(owner,'atlas');assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM requests WHERE scope=?').bind(scope).first()).n,12);
 const input={action:'create',actor:'maya',org:'atlas',title:'Concurrent draft allocation',vendor:'Test vendor',amountCents:100,department:'Engineering',category:'Equipment',neededBy:'2026-11-30',description:'Both valid creates must get different request numbers.'};
 const creates=await race([[owner,input,key()],[owner,input,key()]]);assert.ok(creates.every(x=>x.ok),JSON.stringify(creates));
 const numbers=await db.prepare('SELECT number FROM requests WHERE scope=? AND id IN (?,?)').bind(scope,...creates.map(x=>x.value.requestId)).all();assert.equal(new Set(numbers.results.map(x=>x.number)).size,2);
});
test('PG03: concurrent approval keys and input collisions roll back atomically',{timeout:180000},async()=>{
 const f=await fixture(),requestId=await submitted(f),sharedKey=key();
 const args=[f.owner,{action:'approve',actor:'alex',org:f.org,requestId},sharedKey];
 const outcomes=await race([args,args]);assert.ok(outcomes.every(x=>x.ok),JSON.stringify(outcomes));assert.equal(await count(f,'purchase_orders'),1);assert.equal((await budget(f)).reserved_cents,7000);
 const otherId=await submitted(f,1000);await rejected(action(f,'approve',{requestId:otherId},'alex',sharedKey),'IDEMPOTENCY_CONFLICT');assert.equal((await budget(f)).reserved_cents,7000);
});
test('PG04: tenant isolation and persona authorization remain server-side',{timeout:180000},async()=>{
 const f=await fixture(),requestId=await submitted(f);
 await rejected(action(f,'approve',{requestId},'jordan'),'FORBIDDEN');await rejected(action(f,'approve',{requestId},'maya'),'FORBIDDEN');
 await rejected(service.executeAction(db,f.owner,{action:'approve',actor:'alex',org:'nova',requestId},key()),'NOT_FOUND');
 const otherOwner='pg-integration-'+randomUUID();owners.add(otherOwner);await rejected(service.executeAction(db,otherOwner,{action:'approve',actor:'alex',org:'atlas',requestId},key()),'NOT_FOUND');
 const own=await submitted(f,1000,'alex');await rejected(action(f,'approve',{requestId:own},'alex'),'SELF_APPROVAL');
 assert.equal((await budget(f)).reserved_cents,0);
});
test('PG05: concurrent early signed receipts transfer once; acknowledgement cannot regress',{timeout:180000},async()=>{
 const f=await fixture(),{requestId,orderId}=await approved(f),args=await receipt(f,orderId);
 const outcomes=await race([args,args],{receipt:true});assert.ok(outcomes.every(x=>x.ok),JSON.stringify(outcomes));assert.equal(await count(f,'receipts'),1);
 assert.equal((await budget(f)).reserved_cents,0);assert.equal((await budget(f)).spent_cents,7000);
 await service.processDispatch(db,f.scope);
 assert.equal((await db.prepare('SELECT status FROM requests WHERE scope=? AND id=?').bind(f.scope,requestId).first()).status,'received');
 const altered=[...args];altered[3]='0'.repeat(64);await rejected(service.handleReceipt(db,...altered),'WEBHOOK_SIGNATURE_INVALID');
 const collision=await receipt(f,orderId,{eventId:JSON.parse(args[1]).eventId,amountCents:6999});await rejected(service.handleReceipt(db,...collision),'EVENT_CONFLICT');assert.equal((await budget(f)).spent_cents,7000);
});
test('PG06: different receipt events racing on one order cannot double-transfer',{timeout:180000},async()=>{
 const f=await fixture(),{orderId}=await approved(f),one=await receipt(f,orderId),two=await receipt(f,orderId);
 const outcomes=await race([one,two],{receipt:true});assert.ok(outcomes.every(x=>x.ok),JSON.stringify(outcomes));assert.equal(await count(f,'receipts'),2);assert.equal((await budget(f)).reserved_cents,0);assert.equal((await budget(f)).spent_cents,7000);
});
test('PG07: receipt key reuse for two orders commits only one movement',{timeout:180000},async()=>{
 const f=await fixture(),a=await approved(f,3000),b=await approved(f,3000),sharedKey=key();
 const outcomes=await race([a,b].map(({orderId})=>[f.owner,{action:'receive',actor:'alex',org:f.org,orderId},sharedKey]));assert.equal(outcomes.filter(x=>x.ok).length,1,JSON.stringify(outcomes));assert.equal(outcomes.find(x=>!x.ok).error.code,'IDEMPOTENCY_CONFLICT');assert.equal(await count(f,'receipts'),1);assert.equal((await budget(f)).spent_cents,3000);assert.equal((await budget(f)).reserved_cents,3000);
});
test('PG08: crashed delivery, stale leases, exhaustion, requeue and separate dispatch stay safe',{timeout:180000},async()=>{
 const f=await fixture(),{requestId,orderId}=await approved(f),now=Date.now();
 const first=await service.claimDispatch(db,f.scope,now),second=await service.claimDispatch(db,f.scope,now+31000);assert.ok(first&&second);assert.notEqual(first.leaseToken,second.leaseToken);
 await db.prepare('INSERT INTO vendor_orders(scope,order_id,amount_cents,accepted_at) VALUES(?,?,?,?)').bind(f.scope,orderId,7000,new Date(now).toISOString()).run();
 await service.acknowledgeDispatch(db,f.scope,second.id,second.leaseToken,now+32000);assert.equal((await service.acknowledgeDispatch(db,f.scope,first.id,first.leaseToken,now+33000)).acknowledged,false);
 assert.equal(await count(f,'vendor_orders'),1);assert.equal((await db.prepare('SELECT status FROM requests WHERE scope=? AND id=?').bind(f.scope,requestId).first()).status,'ordered');
 await clear(f);const fresh=await approved(f);
 for(let attempt=0;attempt<5;attempt++)await service.processDispatch(db,f.scope,{crashAfterAccept:true,nowMs:now+attempt*31000});
 await service.processDispatch(db,f.scope,{nowMs:now+5*31000});const failed=await db.prepare('SELECT * FROM outbox WHERE scope=? AND order_id=?').bind(f.scope,fresh.orderId).first();assert.equal(failed.status,'failed');assert.equal(failed.attempts,5);
 const before=await budget(f);await action(f,'retry',{jobId:failed.id},'alex');assert.equal((await db.prepare('SELECT status FROM outbox WHERE scope=? AND id=?').bind(f.scope,failed.id).first()).status,'pending');assert.deepEqual(await budget(f),before);assert.equal(await count(f,'vendor_orders'),1);
 const sent=await action(f,'dispatch',{},'alex');assert.equal(sent.orderId,fresh.orderId);assert.equal(await count(f,'vendor_orders'),1);assert.deepEqual(await budget(f),before);
});
test('PG09: database constraints and transaction-local row-count guard roll back',{timeout:180000},async()=>{
 const f=await fixture();await assert.rejects(db.prepare("UPDATE budgets SET reserved_cents=10001 WHERE scope=? AND id='eng'").bind(f.scope).run());
 await assert.rejects(db.batch([db.prepare("UPDATE budgets SET spent_cents=100 WHERE scope=? AND id='eng'").bind(f.scope),db.prepare('UPDATE requests SET reason=? WHERE scope=? AND id=?').bind('No record',f.scope,'missing'),db.prepare('INSERT INTO operation_guards(id,ok) VALUES(?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(key())]));
 assert.equal((await budget(f)).spent_cents,0);assert.equal((await budget(f)).reserved_cents,0);
});
test('PG10: receipt races with another approval and with dispatch preserve the ledger',{timeout:180000},async()=>{
 const f=await fixture(),first=await approved(f),waiting=await submitted(f);
 const outcomes=await race([
  [f.owner,{action:'receive',actor:'alex',org:f.org,orderId:first.orderId},key()],
  [f.owner,{action:'approve',actor:'alex',org:f.org,requestId:waiting},key()],
 ]);
 assert.equal(outcomes[0].ok,true,JSON.stringify(outcomes));assert.equal(outcomes[1].ok,false);assert.equal(outcomes[1].error.code,'BUDGET_EXCEEDED');
 assert.equal((await budget(f)).reserved_cents,0);assert.equal((await budget(f)).spent_cents,7000);assert.equal(await count(f,'purchase_orders'),1);
 await clear(f);const second=await approved(f);
 const dispatchAndReceipt=await race([
  [f.owner,{action:'dispatch',actor:'alex',org:f.org},key()],
  [f.owner,{action:'receive',actor:'alex',org:f.org,orderId:second.orderId},key()],
 ]);
 assert.ok(dispatchAndReceipt.every(x=>x.ok),JSON.stringify(dispatchAndReceipt));
 assert.equal((await db.prepare('SELECT status FROM requests WHERE scope=? AND id=?').bind(f.scope,second.requestId).first()).status,'received');
 assert.equal((await db.prepare('SELECT status FROM outbox WHERE scope=? AND order_id=?').bind(f.scope,second.orderId).first()).status,'delivered');
 assert.equal((await budget(f)).reserved_cents,0);assert.equal((await budget(f)).spent_cents,7000);assert.equal(await count(f,'vendor_orders'),1);
});
