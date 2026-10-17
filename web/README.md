# @open-brain/web

The Open Brain dashboard. Next.js 15 (App Router) + Supabase SSR + Tailwind. Read-only views of your thoughts, compiled wiki pages, and detected contradictions, with server actions for refreshing wiki pages, rejecting bad compilations, and resolving contradictions.

> Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) via Nate B Jones — [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44). The footer of every page links to both.

## Prerequisites

- Node.js 18+
- A Supabase project with the Open Brain schema deployed (migrations 001–006)
- **Email auth provider enabled** in Supabase (Authentication → Providers → Email → ON)
- At least one user created (Authentication → Users → Add user → Auto Confirm User → ON)

## Configuration

The app reads two public environment variables. Copy the example and fill in:

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Find both in Supabase Dashboard → Project Settings → API.

## Local development

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, sign in with the user you created, and you'll land on the Thoughts dashboard. The sidebar nav has Thoughts / Wiki / Contradictions (with badges showing wiki page count and open-contradictions count).

Other useful commands:

```bash
npm run build       # production build
npm run start       # serve the production build
npm run lint        # ESLint
```

## Routes

| Route | Server actions | Purpose |
|---|---|---|
| `/` | — | Thoughts list with topic / person / type filters and full-text search |
| `/login` | — | Email + password sign-in |
| `/auth/callback` | — | OAuth/magic-link callback (only used if you enable those providers) |
| `/wiki` | — | List of compiled wiki pages, newest first |
| `/wiki/[slug]` | `refreshWikiPage`, `rejectWikiPage` | Markdown page with inline source quotes, staleness banner, "Refresh now" + "Reject this page" |
| `/contradictions` | — | List filterable by `status` query param |
| `/contradictions/[id]` | `resolveContradiction` | Side-by-side source thoughts with a resolve form |

All routes redirect to `/login` when not authenticated. Server actions also re-check auth before mutating.

## Architecture notes

- Reads use the signed-in user's session (the `authenticated` role) + RLS policies. The anon key only serves the login page and auth; it has no table, view or function access (migration 016). RLS also limits the `authenticated` role to the accounts listed in `public.owners` (migration 017), so keep that table and `OWNER_USER_IDS` in sync. Since migration 018 that role can only SELECT, plus UPDATE `status` and `resolved_at` on `contradictions`; a web feature that writes anything else needs a migration that grants it. No service role key in the browser.
- Server actions (`refreshWikiPage`, `rejectWikiPage`, `resolveContradiction`) live in `src/app/wiki/actions.ts` and run on the Next.js server. `resolveContradiction` updates `contradictions` as the signed-in user; calls to the `capture-thought` and `compile-wiki` edge functions use the server-only `SUPABASE_SERVICE_ROLE_KEY`.
- The Sidebar (`src/components/Sidebar.tsx`) is a client component using `usePathname()` to highlight the active route. Counts come from `src/lib/dashboard-counts.ts` — a single Promise.all HEAD-count fetch per page.
- Markdown content (`wiki_pages.content_md`) renders as plain text inside an `<article>` with `whitespace-pre-wrap`. Citations are emitted as `*Sources: [[#thought-id]]*` markdown italics; no HTML tags. A future improvement could pipe the content through `react-markdown` for richer rendering.

## Deploy (Vercel)

Connect the repo to a Vercel project; auto-deploys from `main`. Required env vars in **Project Settings → Environment Variables** (Production scope):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (the legacy `service_role` JWT `eyJ...`, not `sb_secret_...`; server-only, mark sensitive, never `NEXT_PUBLIC_`): the wiki refresh and note-saving actions send it to `compile-wiki` / `capture-thought`, which accept the service-role key only. If unset, the actions fall back to the anon key with a console warning and will fail once those functions are redeployed.

Vercel will pick up the same Next.js build script as `npm run build`. No special build flags needed.
