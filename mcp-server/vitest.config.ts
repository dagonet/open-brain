// Keep test discovery to src/. `tsc` also emits compiled copies of the tests into
// dist/__tests__, and without this exclude `npm test` ran them a second time.
//
// Plain object export (no `defineConfig` import), same as cli/vitest.config.ts.
export default {
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
};
