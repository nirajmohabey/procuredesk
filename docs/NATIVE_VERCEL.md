# Native Next.js deployment on Vercel

## Current release status

The current source runs the application directly on native Next.js App Router and Node.js, with Neon PostgreSQL. Its canonical application URL is https://procuredesk-xi.vercel.app. The root page and purchasing APIs are served by that deployment; `vercel.json` selects the Next.js preset and contains no external redirect.

**Observed production acceptance: passed on November 24, 2026.** The tested runtime source is [`f89a3de0519315bddd2e7230376e838a1a8524e3`](https://github.com/nirajmohabey/procuredesk/commit/f89a3de0519315bddd2e7230376e838a1a8524e3). Vercel deployment `dpl_C2kCtcwR2KrhJMmHBDia4V4fCuWQ` was READY, and deployment metadata matched the public `https://procuredesk-xi.vercel.app` alias to it. Its immutable deployment URL is `https://procuredesk-nt5k2xctv-niraj-mohabeys-projects.vercel.app`; generated team aliases may retain Vercel protection, so use the public configured alias for the demo.

The user's explicit request for the actual application on Vercel superseded the earlier handbook guidance to preserve Sites hosting. Historical Sites/D1 evidence remains archived; it is not native release evidence.

| Native acceptance scope | Observed result and boundary |
| --- | --- |
| Dependency installation and type checking | PASS — clean CI installation and `npm run typecheck`, Node.js 24 on Ubuntu. |
| Next.js production build | PASS — `npm run build` in CI and the READY native Vercel production build. |
| Explicit Neon/PostgreSQL migration | PASS — applied explicitly to the new dedicated Free-plan Neon resource before promotion; no request-time DDL. Other applications' databases and credentials were not reused or modified. |
| PostgreSQL independent-connection approval and recovery checks | PASS — 10 PostgreSQL cases, including 25 approval-race fixtures, on dedicated Neon during local verification and PostgreSQL 17 in CI. |
| First-party session issuance, tamper/expiry rejection, and owner isolation | PASS — 5 session tests; production HTTP verified Secure/HttpOnly/host-only cookie issuance, persistent valid cookies, separate owner scopes, and tamper/malformed-cookie rejection. Expiry was exercised by the session tests. |
| Same-host application/API response with no Sites redirect | PASS — public root loaded the actual app without external login; direct `/api/health` returned `nextjs-node` / `PostgreSQL`. Production HTTP checks passed 14/14. `/favicon.ico` returned an internal 308 to the working SVG. |
| Draft, submit, separate approval, dispatch, receipt, and finance read-only journey | PASS — live Nova UI: Maya submitted $199.99 REQ-1043; Alex approved PO-1043, dispatched it after the older eligible job, and recorded its receipt. Jordan had no create, dispatch, or receipt controls and could not run the lab. |
| Live reliability lab and responsive/keyboard observations | PASS — hosted PostgreSQL lab 5/5, unchanged ledger afterward; six views at 320×844 had no page overflow; closed navigation was inert; Escape restored navigation/Help focus; 844×390 sidebar scrolled Help into view; 1280×900 had no horizontal overflow. These are bounded observations, not a full accessibility audit. |
| Production alias identifies the exact verified commit | PASS — public alias matched the deployment and source above; [CI run 45337425498](https://github.com/nirajmohabey/procuredesk/actions/runs/45337425498) succeeded for that source. |

CI passed **34 test cases**: 24 regressions (16 legacy SQLite integration, 5 session, 3 origin) plus 10 PostgreSQL cases, with zero failures. The 25 PostgreSQL race fixtures are repetitions inside one of the 10 cases, not 25 additional cases. The SQLite suite separately retains its own 25 race fixtures and process-exit/commit-boundary tests. Native PostgreSQL crash recovery was tested through the service's fault/lease fixtures; no new PostgreSQL OS-process-kill repeat was performed.

Production HTTP acceptance ran at **2026-11-24 06:03:13–06:03:16 UTC** with fresh private cookie jars. Its separate $70 Atlas request `REQ-15BFADF4` created one PO-1043/outbox job, one simulated vendor acceptance, and one accounting transfer despite retries and duplicate receipt events. These records are in a different owner scope from the UI exercise below.

| Live Nova UI ledger | Reserved | Spent | Available |
| --- | ---: | ---: | ---: |
| Before the $199.99 exercise | $1,440.00 | $3,200.00 | $43,360.00 |
| After Alex approved PO-1043 | $1,639.99 | $3,200.00 | $43,160.01 |
| After receipt; unchanged after the 5/5 lab | $1,440.00 | $3,399.99 | $43,160.01 |

The browser's approved record survived reload across the native deployment update. The simulated vendor did not contact a supplier. This is an internal AI-assisted acceptance exercise, with no external customer, participant feedback, or measured savings claim.

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

The historical 16-test SQLite result and 25 race fixtures are not PostgreSQL proof. The executed compatibility, native database, session, browser, and hosted lab results above remain separate scopes. A native race test is not a cloud throughput benchmark.

## Promotion checklist

1. Identify the native source commit and confirm `DATABASE_URL` points to the dedicated intended Neon database. Keep `SESSION_SECRET` stable across the candidate and promotion when retaining browser access is intended.
2. Run the explicit PostgreSQL migration as a maintainer operation **before promotion**. Retain its applied-file/hash result. Do not add automatic runtime DDL to make a request succeed.
3. Run and record the native checks above and build the actual Next.js application. Publish a candidate with the intended runtime environment.
4. Verify the candidate directly serves `/` and `/api/health`, with `runtime: nextjs-node` and `storage: PostgreSQL`, and does not send visitors or API requests to the historical Sites host.
5. Verify fresh browser access requires no external login, the session is HttpOnly/Secure on Vercel, a separate browser has a separate owner scope, and tampered or expired session material does not recover another workspace.
6. Exercise the purchasing journey, permissions, simulated recovery, receipt accounting, and reliability lab. Match visible purchase-order numbers because dispatch handles one eligible job, oldest first.
7. Promote only the verified candidate. Confirm the production alias and deployment metadata identify that exact Git commit; a passing preview alone does not establish the production release. Repeat a bounded same-host/read/write check on the production URL and record the outcome.

The completed release observations are recorded above. Repeat this checklist for future runtime or infrastructure releases; the current result does not establish acceptance for an untested deployment.

## Data boundary and rollback

The native Neon database starts with fresh fictional data for new browser sessions. Existing ChatGPT-owned workspaces on the prior Sites/D1 deployment stay there. No account linkage, data copy, or silent migration occurs. Historical Sites identity and D1 credentials are not the native application's authentication or storage boundary.

For a regression, choose a previously verified **native Vercel deployment** that is compatible with the current PostgreSQL schema and environment. Rollback changes application code; it does not reverse migrations or accounting events. Keep applied migration files and hashes immutable. If no compatible candidate exists, prepare a forward fix instead of altering the database to fit an older binary. Session-secret rotation is a separate access-impacting operation, not an application rollback.

No backup restoration drill, production-load benchmark, external vendor contract, production availability SLA, real-company membership management, customer adoption, or business savings is established by this migration. Read results remain bounded at 500 requests, 250 events, and 100 outbox jobs, without pagination. See [operator handoff](OPERATOR_HANDOFF.md) for the unchanged purchasing/recovery workflow.

## Historical release evidence

[VERIFICATION.md](VERIFICATION.md), [PURCHASING_PILOT.md](PURCHASING_PILOT.md), and their screenshots describe the earlier **Sites/D1 release**. Preserve their dates, commits, 16 SQLite tests, 25 race fixtures, five hosted checks, and internal AI-assisted simulated pilot scope. They do not establish native Vercel/PostgreSQL acceptance. [ARCHITECTURE.md](ARCHITECTURE.md) and [ENVIRONMENT.md](ENVIRONMENT.md) also retain the earlier Sites/D1 context; this document describes the native deployment instead.
