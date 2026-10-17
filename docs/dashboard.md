[Back to README](../README.md)

# The dashboard

A Next.js 16 app (App Router, Supabase SSR, Tailwind) in `web/`. It lets you browse your thoughts, compiled wiki pages, contradictions and the entity graph in a browser, with actions to refresh wiki pages, reject bad compilations and resolve contradictions. It is private to you: only accounts on the owner list see data.

> Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) via Nate B Jones — [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44). The footer of every page links to both.

## Prerequisites

- Node.js 20.9+ (Next.js 16).
- A Supabase project with all migrations (001 to 018) applied.
- The **Email auth provider** enabled (Authentication > Providers > Email > ON).
- At least one user (Authentication > Users > Add user > Auto Confirm User ON), listed in `public.owners` ([`install.md`](install.md#7-set-up-the-dashboard), step 2).
- On a hosted project: sign-ups and anonymous sign-ins turned off ([`security.md`](security.md#dashboard)).

## Configuration

Copy the example and fill it in:

```bash
cp web/.env.local.example web/.env.local
```

| Variable | Scope | Purpose |
| -------- | ----- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Your project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | The anon key. Serves the login page and auth only. |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | The legacy `service_role` JWT (`eyJ...`, not `sb_secret_...`). Wiki refresh sends it to `compile-wiki`; refresh, reject and the contradiction note send it to `capture-thought`. Never prefix it with `NEXT_PUBLIC_`; mark it sensitive in Vercel. |
| `OWNER_USER_IDS` | **server-only** | Comma-separated Supabase auth user ids allowed to use the refresh, reject and resolve buttons. Unset or empty means refused (fail closed). Keep it equal to `public.owners`. |

Find the URL and keys under Project Settings > API; user ids under Authentication > Users.

## Run locally

```bash
npm ci --prefix web
npm run dev --prefix web          # http://localhost:3000
```

Other commands: `npm run build` (production build), `npm run start` (serve it), `npm run lint`, `npm test` (vitest), all with `--prefix web`.

Sign in with the user you created. Every route redirects to `/login` when you are not signed in; server actions re-check auth before changing anything.

## Routes

| Route | Server actions | Purpose |
| ----- | -------------- | ------- |
| `/` | none | Thoughts list with topic, person and type filters, full-text search and pagination. |
| `/login` | none | Email and password sign-in. |
| `/auth/callback` | none | OAuth / magic-link callback (used only if you enable those providers). |
| `/wiki` | none | Compiled wiki pages, newest first. |
| `/wiki/[slug]` | `refreshWikiPage`, `rejectWikiPage` | Markdown page with inline source quotes, a staleness banner, "Refresh now" and "Reject this page". |
| `/contradictions` | none | List, filterable by status (open / resolved / ignored / false_positive / all). |
| `/contradictions/[id]` | `resolveContradiction` | The two source thoughts side by side, with a resolve form (decision plus optional note, which captures an audit thought). |
| `/graph` | none | Two tabs. **Contradictions:** a force-directed network (nodes are thoughts, coloured by type and sized by how many contradictions they are in; edges are contradictions, thicker for higher severity). **Entities:** a force-directed co-occurrence graph of the top 60 entities (node radius by mention count, edge thickness by co-occurrence, colour by entity type). Click to drill in. |

The left sidebar lists Thoughts, Wiki, Contradictions and Graph with badges (wiki page count, open contradictions). The bottom of the rail shows the total thoughts captured and a Sign out button.

## Actions and the owner guard

The server actions live in `web/src/app/wiki/actions.ts` and run on the Next.js server.

- `refreshWikiPage` and `rejectWikiPage` call `compile-wiki` and `capture-thought` with the service-role key. They spend LLM tokens, so being logged in is not enough: the caller's user id must be in `OWNER_USER_IDS`.
- `resolveContradiction` updates `contradictions` as the signed-in user (database policy: the id must be in `public.owners`) and sends its audit note with the service-role key.
- If an action reports **"no row was updated"**, the database refused the write: your id is in `OWNER_USER_IDS` but not in `public.owners`. Add it ([`troubleshooting.md`](troubleshooting.md#the-dashboard-shows-no-data-or-refuses-a-button)).

## Architecture notes

- Reads use the signed-in user's session (the `authenticated` role) and row-level security. The anon key has no table, view or function access (migration 016); RLS limits `authenticated` to `public.owners` (017); and that role can only SELECT, plus UPDATE `status` and `resolved_at` on `contradictions` (018). A new web feature that writes anything else needs a migration that grants it. There is no service-role key in the browser.
- The sidebar (`src/components/Sidebar.tsx`) is a client component using `usePathname()` to highlight the active route. Counts come from `src/lib/dashboard-counts.ts`, a single `Promise.all` HEAD-count fetch per page.
- Wiki markdown (`wiki_pages.content_md`) renders as plain text in an `<article>` with `whitespace-pre-wrap`. Citations are emitted as `*Sources: [[#thought-id]]*` italics; no HTML. Piping the content through `react-markdown` would give richer rendering.
- The graph views share one force simulation (`useSimulation` in `graph-common.ts`).

## Deploy to Vercel

Connect the repo to a Vercel project; it auto-deploys from `main` with the same Next.js build script as `npm run build`, no special flags.

In **Project Settings > Environment Variables** set, for both **Production** and **Preview**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (the legacy JWT; server-only, sensitive)
- `OWNER_USER_IDS` (server-only)

If `SUPABASE_SERVICE_ROLE_KEY` is unset the actions fall back to the anon key with a console warning and fail, because the functions accept the service-role key only. The app lives in `web/`, so the Vercel project's Root Directory must be `web`.
