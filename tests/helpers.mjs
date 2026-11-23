import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

/** Start independent OS-thread SQLite connections and release them together. */
export async function runRace(path, servicePath, invocations, { receipt = false } = {}) {
  const barrier = new SharedArrayBuffer(4);
  const gate = new Int32Array(barrier);
  const workers = invocations.map(args => new Worker(new URL('./race-worker.mjs', import.meta.url), {
    workerData: { path, serviceUrl: pathToFileURL(servicePath).href, barrier, args, receipt },
  }));
  const ready = workers.map(worker => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Race worker readiness timeout')), 20000);
    worker.once('error', reject);
    worker.on('message', message => { if (message.ready) { clearTimeout(timeout); resolve(); } });
  }));
  const result = workers.map(worker => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Race worker result timeout')), 20000);
    worker.once('error', reject);
    worker.on('message', message => { if (message.result) { clearTimeout(timeout); resolve(message.result); } });
    worker.once('exit', code => { if (code) reject(new Error(`Race worker exited ${code}`)); });
  }));
  try {
    await Promise.all(ready);
    Atomics.store(gate, 0, 1);
    Atomics.notify(gate, 0, workers.length);
    return await Promise.all(result);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}
