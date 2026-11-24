import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import {verifiedPostgresConnectionString} from '../src/server/postgres.ts';

try { process.loadEnvFile?.('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const connectionString=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!connectionString){console.error('Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL for the dedicated ProcureDesk PostgreSQL database.');process.exit(1);}
const client=new pg.Client({connectionString:verifiedPostgresConnectionString(connectionString),connectionTimeoutMillis:15000});
try {
 await client.connect();
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(742315981)');
 await client.query('CREATE TABLE IF NOT EXISTS _procuredesk_migrations (id text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
 const files=(await fs.readdir(resolve('postgres'))).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
 const applied=[],alreadyApplied=[];
 for(const file of files){
  const sql=await fs.readFile(resolve('postgres',file),'utf8');
  const hash=createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');
  const existing=await client.query('SELECT sha256 FROM _procuredesk_migrations WHERE id=$1',[file]);
  if(existing.rows.length){if(existing.rows[0].sha256!==hash)throw new Error('Applied migration content differs: '+file);alreadyApplied.push(file);continue;}
  await client.query(sql);
  await client.query('INSERT INTO _procuredesk_migrations(id,sha256) VALUES($1,$2)',[file,hash]);
  applied.push(file);
 }
 await client.query('COMMIT');
 console.log(JSON.stringify({status:'migrated',database:'dedicated ProcureDesk PostgreSQL',applied,alreadyApplied}));
}catch(error){
 try{await client.query('ROLLBACK');}catch{}
 const message=String(error.message||'Migration failed').replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[redacted connection]');
 console.error(JSON.stringify({status:'failed',code:error.code||'MIGRATION_FAILED',message}));
 process.exitCode=1;
}finally{await client.end();}
