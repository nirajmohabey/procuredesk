import { Pool, types, type PoolClient, type QueryResult } from "pg";
import type { Database, Statement } from "./service";

type BatchContext = { lastChanges: number };
type Result = { success: true; results: Record<string, unknown>[]; meta: { changes: number; last_row_id: number; duration: number } };

// PostgreSQL returns int8 values as strings by default. This application uses
// int8 for epoch-millisecond leases and COUNT; retain unsafe integers as strings.
const integerParser = (value: string) => { const n = Number(value); return Number.isSafeInteger(n) ? n : value; };

export function verifiedPostgresConnectionString(connectionString:string){
  const url=new URL(connectionString);
  // Preserve local development options, but explicitly retain certificate and
  // hostname verification for hosted connections across future pg upgrades.
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){
    url.searchParams.set('sslmode','verify-full');
    url.searchParams.delete('uselibpqcompat');
  }
  return url.toString();
}

/** Convert the existing prepared-statement placeholder notation, never values.
 * Quoted SQL strings/identifiers and comments are left intact. */
export function postgresPlaceholders(sql: string): string {
  let output = "", number = 0, quote = "", lineComment = false, blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (lineComment) { output += c; if (c === "\n") lineComment = false; continue; }
    if (blockComment) { output += c; if (c === "*" && next === "/") { output += next; i++; blockComment = false; } continue; }
    if (quote) { output += c; if (c === quote) { if (next === quote) { output += next; i++; } else quote = ""; } continue; }
    if (c === "'" || c === '"') { quote = c; output += c; continue; }
    if (c === "-" && next === "-") { lineComment = true; output += c + next; i++; continue; }
    if (c === "/" && next === "*") { blockComment = true; output += c + next; i++; continue; }
    output += c === "?" ? `$${++number}` : c;
  }
  return output;
}

function translate(source: string, values: unknown[], context?: BatchContext) {
  let sql = source.trim().replace(/;\s*$/, ""), args = [...values];
  if (/^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)) {
    if (/\bON\s+CONFLICT\b/i.test(sql)) throw new Error("Ambiguous INSERT OR IGNORE translation");
    sql = sql.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO") + " ON CONFLICT DO NOTHING";
  }
  if (/\bchanges\s*\(/i.test(sql)) {
    // This is the one deliberately supported SQLite connection-local function.
    // Its PostgreSQL equivalent is the previous command's actual rowCount on
    // THIS checked-out transaction client, never a global or pooled counter.
    const guard = /^INSERT INTO operation_guards\(id,ok\) VALUES\(\?,CASE WHEN changes\(\)=1 THEN 1 ELSE 0 END\)$/i;
    if (!context || !guard.test(sql)) throw new Error("changes() is supported only by the atomic operation guard");
    sql = sql.replace("changes()", "?");
    args.push(context.lastChanges);
  }
  return { text: postgresPlaceholders(sql), values: args };
}

/** Native Node PostgreSQL implementation of the domain's small database API.
 * Every batch owns one connection from BEGIN until COMMIT/ROLLBACK. */
export class PostgresDatabase implements Database {
  readonly dialect = "postgres" as const;
  readonly pool: Pool;
  constructor(connectionString: string) {
    if (!connectionString || !/^postgres(?:ql)?:\/\//.test(connectionString)) throw new Error("DATABASE_URL must be a PostgreSQL connection string");
    this.pool = new Pool({
      connectionString:verifiedPostgresConnectionString(connectionString),
      max: 3,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 20000,
      allowExitOnIdle: true,
      types: { getTypeParser: (oid: number, format?: "text" | "binary") => oid === 20 && format !== "binary" ? integerParser : types.getTypeParser(oid, format) },
    });
    // Do not crash an otherwise healthy request on an idle serverless socket.
    // The failed connection is discarded by pg; credentials/payloads stay out.
    this.pool.on("error", () => console.error(JSON.stringify({ code: "POSTGRES_IDLE_CONNECTION_CLOSED" })));
  }
  prepare(sql: string): PostgresStatement { return new PostgresStatement(this, sql); }
  async execute(statement: PostgresStatement, client?: PoolClient, context?: BatchContext): Promise<Result> {
    if (statement.database !== this) throw new Error("Statement belongs to another database");
    const started = Date.now(), query = translate(statement.sql, statement.values, context);
    const response: QueryResult = client ? await client.query(query) : await this.pool.query(query);
    const changes = response.rowCount ?? 0;
    if (context) context.lastChanges = changes;
    return { success: true, results: response.rows, meta: { changes, last_row_id: 0, duration: Date.now() - started } };
  }
  async batch(statements: Statement[]): Promise<Result[]> {
    for(let attempt=0;;attempt++){
      try{return await this.transaction(statements);}
      catch(error){
        const code=(error as {code?:string}).code;
        if(attempt>=2||!['40P01','40001'].includes(code||''))throw error;
        await new Promise(resolve=>setTimeout(resolve,20*2**attempt+Math.floor(Math.random()*20)));
      }
    }
  }
  private async transaction(statements: Statement[]): Promise<Result[]> {
    const client = await this.pool.connect();
    let discarded=false;
    try {
      await client.query("BEGIN");
      const context: BatchContext = { lastChanges: 0 }, results: Result[] = [];
      for (const statement of statements) {
        if (!(statement instanceof PostgresStatement) || statement.database !== this) throw new Error("A PostgreSQL batch requires statements from the same database");
        results.push(await this.execute(statement, client, context));
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { client.release(true); discarded=true; throw error; }
      throw error;
    } finally {
      if(!discarded)client.release();
    }
  }
  async close() { await this.pool.end(); }
}

export class PostgresStatement implements Statement {
  readonly database: PostgresDatabase;
  readonly sql: string;
  readonly values: unknown[];
  constructor(database: PostgresDatabase, sql: string, values: unknown[] = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values: unknown[]): PostgresStatement { return new PostgresStatement(this.database, this.sql, values); }
  async run() { return this.database.execute(this); }
  async all<T = Record<string, unknown>>() { const result = await this.database.execute(this); return { ...result, results: result.results as T[] }; }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.database.execute(this), row = result.results[0];
    if (!row) return null;
    return (column === undefined ? row : row[column]) as T;
  }
}

export function createPostgresDatabase(connectionString: string) { return new PostgresDatabase(connectionString); }
