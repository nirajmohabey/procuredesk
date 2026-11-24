# Native Next.js deployment on Vercel

## Current release status

The current source runs the application directly on native Next.js App Router and Node.js, with Neon PostgreSQL. Its canonical application URL is https://procuredesk-xi.vercel.app. The root page and purchasing APIs are served by that deployment; `vercel.json` selects the Next.js preset and contains no external redirect.

**Publication and hosted acceptance are pending verification.** This document describes the source and operating procedure, not a claim that a new production deployment has already passed. The maintainer must add the native commit, deployment ID, timestamp, exact production aliases, commands, and observed outcomes to the release receipt.

| Native acceptance scope | Status |
| --- | --- |
| Dependency installation and type checking | Pending recorded native result |
| Next.js production build | Pending recorded native result |
| Explicit Neon/PostgreSQL migration | Pending recorded native result |
| PostgreSQL independent-connection approval and recovery checks | Pending recorded native result |
| First-party session issuance, tamper/expiry rejection, and owner isolation | Pending recorded native result |
| Same-host application/API response with no Sites redirect | Pending recorded hosted result |
| Draft, submit, separate approval, dispatch, receipt, and finance read-only journey | Pending recorded hosted result |
| Live reliability lab and responsive/keyboard observations | Pending recorded hosted result |
| Production aliases identify the exact verified commit | Pending recorded production result |

## First-party demo access

No ChatGPT, Google, or other external account is required. The initial workspace request issues a server-verified signed session in a first-party HttpOnly cookie. Vercel uses a Secure `__Host-` cookie with path `/` and SameSite=Lax. The session lasts 30 days and identifies a randomly assigned private demo owner; it does not verify a human identity or company membership.

That owner scopes Atlas and Nova sample organizations in PostgreSQL. Maya, Alex, Jordan, and Niraj remain fictional employee, approver, finance, and administrator personas within the same owner's sandbox. The server checks their allowed operations.

Another browser gets a different private workspace. Clearing the site's cookies, session expiry, or changing the signing secret loses access to the prior demo workspace; creating a new session does not recover it. Records are not stored in browser localStorage. This release has no account-recovery or cross-browser workspace transfer flow.

## Environment contract

Configure these names in local ignored `.env.local` and the corresponding Vercel environment. Do not commit their values.

| Name | Use |
| --- | --- |
| `DATABASE_URL` | Runtime PostgreSQL connection for the dedicated ProcureDesk database; use the intended Neon endpoint with its required TLS settings. |
| `DATABASE_URL_UNPOOLED` | Optional direct connection preferred by the migration script; it falls back to `DATABASE_URL`. |
| `SESSION_SECRET` | Stable, randomly generated signing secret of at least 32 UTF-8 bytes. Rotation invalidates existing demo access. |
| `POSTGRES_TEST_DATABASE_URL` | Optional dedicated native-test connection; the suite otherwise falls back to the migration/runtime connection. Use an explicitly selected test environment. |

`VERCEL` is platform-provided and controls production cookie security; it is not a user-provided account credential. Database/session configuration remains server-side. No client bundle or public configuration should contain connection strings, signing secrets, or cookie tokens.

## Local execution and explicit migration

Use Node.js 24 or newer and the committed lockfile. Configure the environment above, then run from the repository root:

```sh
npm ci --no-audit --no-fund
node scripts/migrate-postgres.mjs
npm run dev
```

The migration script loads `.env.local` when present, uses `DATABASE_URL_UNPOOLED` in preference to `DATABASE_URL`, and applies ordered `postgres/*.sql` files in an explicit transaction with a migration advisory lock. It stores a SHA-256 hash for each applied file and refuses a changed applied migration. Append a new migration rather than modifying applied SQL.

Ordinary API requests may seed a new browser owner's fictional data after migration. They do not create or alter database tables. The old `npm run db:migrate` and Drizzle SQLite assets belong to the legacy local D1 workflow; they do not migrate Neon.

```sh
npm run typecheck
npm run build
npm start
```

The production build writes native Next.js output under `.next`. `next.config.ts` scopes the build to this checkout. Default Vercel dependency installation and its Next.js adapter are retained. The old `vercel-entry` redirect HTML is not the application or a fallback runtime.

## Verify PostgreSQL independently

The native database adapter is `src/server/postgres.ts`; its batches keep one checked-out PostgreSQL connection from BEGIN through COMMIT/ROLLBACK. PostgreSQL triggers and constraints in `postgres/` implement the accounting rules, including the budget-row lock for competing approvals. Native tests use `tests/postgres.integration.test.mjs` and separate race workers.

Once the dedicated test database is configured and migrated, the native suite can be invoked separately:

```sh
node --test --test-concurrency=1 tests/postgres.integration.test.mjs
node --test tests/session.test.mjs
```

Record the command, source commit, runtime, database environment, fixture repetitions, counts, failures/skips, and raw output. Include matching-key and conflicting-key approvals, independent connections, budget accounting, receipt deduplication, lease fencing, and cross-owner/organization denial as implemented by the suite. Do not claim a scenario passed merely because its test file exists.

The historical 16-test SQLite result and 25 race fixtures are not PostgreSQL proof. Any newly executed compatibility, native database, session, browser, and hosted lab results remain separate scopes. A native race test is not a cloud throughput benchmark.

## Promotion checklist

1. Identify the native source commit and confirm `DATABASE_URL` points to the dedicated intended Neon database. Keep `SESSION_SECRET` stable across the candidate and promotion when retaining browser access is intended.
2. Run the explicit PostgreSQL migration as a maintainer operation **before promotion**. Retain its applied-file/hash result. Do not add automatic runtime DDL to make a request succeed.
3. Run and record the native checks above and build the actual Next.js application. Publish a candidate with the intended runtime environment.
4. Verify the candidate directly serves `/` and `/api/health`, with `runtime: nextjs-node` and `storage: PostgreSQL`, and does not send visitors or API requests to the historical Sites host.
5. Verify fresh browser access requires no external login, the session is HttpOnly/Secure on Vercel, a separate browser has a separate owner scope, and tampered or expired session material does not recover another workspace.
6. Exercise the purchasing journey, permissions, simulated recovery, receipt accounting, and reliability lab. Match visible purchase-order numbers because dispatch handles one eligible job, oldest first.
7. Promote only the verified candidate. Confirm the production alias and deployment metadata identify that exact Git commit; a passing preview alone does not establish the production release. Repeat a bounded same-host/read/write check on the production URL and record the outcome.

Production observations remain pending until their actual results are attached. Do not convert this checklist into a passed report without execution.

## Data boundary and rollback

The native Neon database starts with fresh fictional data for new browser sessions. Existing ChatGPT-owned workspaces on the prior Sites/D1 deployment stay there. No account linkage, data copy, or silent migration occurs. Historical Sites identity and D1 credentials are not the native application's authentication or storage boundary.

For a regression, choose a previously verified **native Vercel deployment** that is compatible with the current PostgreSQL schema and environment. Rollback changes application code; it does not reverse migrations or accounting events. Keep applied migration files and hashes immutable. If no compatible candidate exists, prepare a forward fix instead of altering the database to fit an older binary. Session-secret rotation is a separate access-impacting operation, not an application rollback.

No backup restoration drill, external vendor contract, production availability SLA, real-company membership management, customer adoption, or business savings is established by this migration. See [operator handoff](OPERATOR_HANDOFF.md) for the unchanged purchasing/recovery workflow.

## Historical release evidence

[VERIFICATION.md](VERIFICATION.md), [PURCHASING_PILOT.md](PURCHASING_PILOT.md), and their screenshots describe the earlier **Sites/D1 release**. Preserve their dates, commits, 16 SQLite tests, 25 race fixtures, five hosted checks, and internal AI-assisted simulated pilot scope. They do not establish native Vercel/PostgreSQL acceptance. [ARCHITECTURE.md](ARCHITECTURE.md) and [ENVIRONMENT.md](ENVIRONMENT.md) also retain the earlier Sites/D1 context; this document describes the native deployment instead.
