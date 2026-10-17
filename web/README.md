# @open-brain/web

The Open Brain dashboard: a Next.js 16 app (App Router, Supabase SSR, Tailwind) for browsing your thoughts, wiki pages, contradictions and entity graph. It is not published; it deploys from `main` to Vercel.

```bash
cp .env.local.example .env.local     # fill in the two public and two server-only variables
npm ci
npm run dev                          # http://localhost:3000
```

Everything else (prerequisites, the environment variables, routes, the owner guard, Vercel setup) is in [`docs/dashboard.md`](../docs/dashboard.md). Install guide: [`docs/install.md`](../docs/install.md#7-set-up-the-dashboard).

> Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) via Nate B Jones — [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44). The footer of every page links to both.
