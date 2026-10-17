// Keep test discovery to src/. `tsc` also emits compiled copies of the tests into
// dist/__tests__, and without this exclude `npm test` ran them a second time
// (202 tests reported instead of the real 101).
//
// Plain object export (no `defineConfig` import), same as the repo-root config.
export default {
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
};
