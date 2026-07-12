// Root-level vitest config so `npx vitest run` from the repo root (used by the
// pre-commit hook and CI) has deterministic test discovery across packages.
//
// Without this file vitest runs on version-dependent defaults, and stale
// compiled test copies under */dist/ have been observed to double the suite
// (190/28 reported vs the real 95/14 at the v0.5 baseline).
//
// NOTE: plain object export (no `import { defineConfig } from 'vitest/config'`)
// because the repo root has no package.json/node_modules — the import cannot
// resolve when vitest is invoked via bare `npx vitest run`.
export default {
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
    ],
  },
};
