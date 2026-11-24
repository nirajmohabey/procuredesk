import { parentPort, workerData } from 'node:worker_threads';
import { createPostgresDatabase } from '../src/server/postgres.ts';
import * as service from '../src/server/service.ts';

const db=createPostgresDatabase(workerData.connectionString);
try{
 const barrier=new Int32Array(workerData.barrier);
 parentPort.postMessage({type:'ready'});
 while(Atomics.load(barrier,0)===0)Atomics.wait(barrier,0,0,30000);
 const value=workerData.receipt
  ? await service.handleReceipt(db,...workerData.args)
  : workerData.ensure
   ? await service.ensureWorkspace(db,...workerData.args)
   : await service.executeAction(db,...workerData.args);
 parentPort.postMessage({type:'result',ok:true,value});
}catch(error){parentPort.postMessage({type:'result',ok:false,error:{code:error.code||'UNEXPECTED',message:String(error.message).replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[redacted connection]')}});}
finally{await db.close();}
