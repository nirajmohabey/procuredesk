import { readFileSync } from 'node:fs';
import { SQLiteD1 } from './d1-adapter.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const service = await import(input.serviceUrl);
const db = new SQLiteD1(input.path);
const ordinaryBatch = db.batch.bind(db);
db.batch = async statements => {
  const approval = statements.some(statement => /UPDATE\s+requests\b/i.test(statement.sql));
  if (!approval) return ordinaryBatch(statements);
  if (input.boundary === 'beforeCommit') {
    db.sqlite.exec('BEGIN IMMEDIATE');
    for (const statement of statements) statement.execute();
    process.exit(88); // OS closes connection with an uncommitted transaction.
  }
  const result = await ordinaryBatch(statements);
  process.exit(89); // Durable COMMIT; HTTP response has not been produced.
  return result;
};
await service.executeAction(db, input.owner, input.body, input.key);
process.exit(90); // Failure: the intended transaction boundary was not reached.
