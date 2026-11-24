# Vercel entry URL

ProcureDesk's application runtime remains Sites/Cloudflare Workers with Cloudflare D1. Its Vinext build produces a Worker, not the `.next/routes-manifest.json` expected by Vercel's Next.js adapter. Importing this repository with that adapter caused `NEXT_NO_ROUTES_MANIFEST` after a successful application build.

The repository's `vercel.json` selects the Other/static preset, skips dependency installation and the application build, and publishes the small `vercel-entry` directory. A temporary HTTP 307 redirect forwards the Vercel entry URL and path to the existing canonical Sites application. The HTML is a fallback launch link. Vercel does not run the purchasing services, hold a second database, proxy authentication, or claim a second working D1 deployment.

The canonical application is https://procuredesk-niraj.flowerycider4.chatgpt.site. ChatGPT sign-in and sandbox isolation are enforced there. Portfolio links may continue to use that canonical URL directly.

After a Vercel configuration change, verify the new deployment is Ready, the production aliases resolve to its exact Git commit, `/` and `/api/health` return a 307 to the matching canonical path, and following the root redirect opens the application. A preview deployment alone does not verify the production alias. Earlier failed builds remain in deployment history; a new Ready deployment supersedes them.
