# Execution environment

Implementation date: November 23, 2026.

| Component | Executed / pinned version |
| --- | --- |
| Local OS | Windows x64 |
| Local Node.js | 26.13.1 |
| Local npm | 11.20.0 |
| CI Node.js target | 24 |
| React | 19.2.6 |
| Next.js API compatibility | 16.3.4 |
| Vinext | 1.0.0-beta.5 |
| Vite | 8.0.13 |
| TypeScript | 5.9.3 |
| Drizzle ORM | 0.45.2 |
| Wrangler | 4.92.0 |
| Worker compatibility date | 2026-05-15 |
| Hosted SQL store | Cloudflare D1 |
| Local integration store | Node.js built-in SQLite, real database files |

The committed npm lockfile is the reproducible dependency source. The application extends the bundled Sites Vinext starter; application UI, domain services, schema, failure lab, and integration tests were implemented for ProcureDesk. Vinext is a beta runtime; framework compatibility should be checked before extending its Next.js API surface.

No Docker, PostgreSQL, AWS credentials, vendor account, AI API, or third-party authentication secret is needed for this release. Hosted identity and database bindings are supplied by Sites. The local-only sign-in adapter and database files are excluded from deployment/source artifacts.

See VERIFICATION.md for executed acceptance evidence. The initial [GitHub CI run](https://github.com/nirajmohabey/procuredesk/actions/runs/45281320661) completed successfully on Ubuntu with Node.js 24.22.3 for commit `aa5360ffd7e3bbd63dcbdd1c6973c0e43df28673`: dependency installation, type checking, 16 integration tests, and the production build passed. Later executions retain their own commit and run references; historical results are not relabeled as new runs.
