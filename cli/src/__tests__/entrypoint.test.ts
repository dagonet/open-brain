import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

// npm's global install links `<prefix>/bin/brain` to dist/brain.js; the entry-point check
// must follow that link. The gate only type-checks (tsc --noEmit), so build a private copy
// here. It lives under cli/ because brain.js reads ../package.json for its version.
describe('entry point via a bin symlink', () => {
  let buildDir: string;
  let tmp: string;

  beforeAll(() => {
    buildDir = mkdtempSync(join(CLI_ROOT, '.tmp-entrypoint-'));
    tmp = mkdtempSync(join(tmpdir(), 'brain-bin-'));
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--outDir', buildDir], {
      cwd: CLI_ROOT,
      stdio: 'pipe',
    });
  }, 120_000);

  afterAll(() => {
    rmSync(buildDir, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  // File symlinks need Developer Mode on Windows (EPERM otherwise). Windows starts the CLI through
  // npm's .cmd shim, and the realpath logic under test is unaffected there.
  it.skipIf(process.platform === 'win32')(
    'runs main() when started through a symlink without a .js suffix',
    () => {
      mkdirSync(join(tmp, 'bin'));
      const link = join(tmp, 'bin', 'brain');
      symlinkSync(join(buildDir, 'brain.js'), link);

      // Isolated env: temp HOME, no BRAIN_* variables, so nothing can reach a live server.
      const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: tmp };
      const out = execFileSync(process.execPath, [link, '--version'], { env, encoding: 'utf-8' });

      expect(out.trim()).toBe('1.3.0');
    },
  );
});
