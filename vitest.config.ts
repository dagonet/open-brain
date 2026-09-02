// Root-level vitest config so `npx vitest run` from the repo root (used by the
// pre-commit hook and CI) has deterministic test discovery across packages.
//
// Without this file vitest runs on version-dependent defaults, and stale
// compiled test copies under */dist/ have been observed to double the suite
// (190/28 reported vs the real 95/14 at the v0.5 baseline).
//
// NOTE: plain object export (no `import { defineConfig } from 'vitest/config'`)
// because the root package.json has no vitest dependency — the import cannot
// resolve when vitest is invoked via bare `npx vitest run`. `node:path` is a
// built-in, not a package, so it resolves regardless and is safe to use here.
//
// resolve.alias mirrors web/vitest.config.ts's '@' -> web/src alias: web/ code
// imports via '@/...' (see web/tsconfig.json paths), and this root-level run
// (used by the pre-commit hook and CI) walks into web/src too, so it needs the
// same alias to import those files successfully.
import path from 'node:path';

export default {
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'web/src'),
    },
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.claude/worktrees/**',
    ],
  },
};
