import { DatabaseSync } from 'node:sqlite';

/** Actual SQLite database adapter for the D1 surface used by the application.
 * Each instance owns an independent database connection. D1 batches are atomic,
 * so batch uses BEGIN IMMEDIATE and rolls back the complete batch on failure.
 * This does not emulate D1 network latency, replicas, or Cloudflare dispatch.
 */
export class SQLiteD1 {
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000;');
    if (path !== ':memory:') this.sqlite.exec('PRAGMA journal_mode=WAL;');
  }
  prepare(sql) { return new SQLiteStatement(this, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  async exec(sql) { this.sqlite.exec(sql); return { count: 0, duration: 0 }; }
  close() { this.sqlite.close(); }
}

class SQLiteStatement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new SQLiteStatement(this.database, this.sql, values); }
  statement() { return this.database.sqlite.prepare(this.sql); }
  execute() {
    const statement = this.statement();
    let results;
    let changes = 0;
    let lastRowId = 0;
    if (statement.columns().length) {
      results = statement.all(...this.values).map(row => ({ ...row }));
      changes = Number(this.database.sqlite.prepare('SELECT changes() AS n').get().n);
    } else {
      const result = statement.run(...this.values);
      changes = Number(result.changes);
      lastRowId = Number(result.lastInsertRowid);
      results = [];
    }
    return { success: true, results, meta: { changes, last_row_id: lastRowId, duration: 0 } };
  }
  async run() { return this.execute(); }
  async all() { return this.execute(); }
  async first(column) {
    const row = this.statement().get(...this.values);
    if (!row) return null;
    return column === undefined ? { ...row } : row[column];
  }
  async raw() { return this.statement().all(...this.values).map(row => Object.values(row)); }
}
