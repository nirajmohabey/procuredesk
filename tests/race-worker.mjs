import { parentPort, workerData } from 'node:worker_threads';
import { SQLiteD1 } from './d1-adapter.mjs';

const service = await import(workerData.serviceUrl);
const db = new SQLiteD1(workerData.path);
const barrier = new Int32Array(workerData.barrier);
parentPort.postMessage({ ready: true });
Atomics.wait(barrier, 0, 0);
try {
  const value = workerData.receipt
    ? await service.handleReceipt(db, ...workerData.args)
    : await service.executeAction(db, ...workerData.args);
  parentPort.postMessage({ result: { ok: true, value } });
} catch (error) {
  parentPort.postMessage({ result: { ok: false, error: { message: error.message, code: error.code, status: error.status } } });
} finally { db.close(); }
