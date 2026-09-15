#!/usr/bin/env bash
# gate.sh -- project-specific quality gate command for the Open Brain project
#
# Checks, in order:
#   1. node_modules / package-lock.json drift check (per component)
#   2. Dollar-quote balance in migration SQL files (closes issue #29)
#   3. TypeScript compilation (tsc --noEmit) in each component
#   4. Vitest unit tests in each component
#   5. Prettier formatting check
#   6. ESLint in each component
#
# This script is the COMMAND referenced by `**Gate**:` in PROJECT_CONTEXT.md.
# It is invoked by the template's gate runner in hooks/, which mints the
# pass-artifact itself -- this script does not write it.
#
# Usage: bash scripts/gate.sh
#   (run from repo root or any subdirectory)

set -euo pipefail

REPO_TOP="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"
cd "$REPO_TOP"

errors=0

# ---------------------------------------------------------------------------
# [1/6] node_modules / package-lock.json drift check -- per component
#
# A merge that changes a component's package.json or package-lock.json
# leaves that component's node_modules stale in every checkout that does
# not re-run `npm ci`. Worktree checkouts get a fresh install and never
# see this; the long-lived main checkout does, silently, until some later
# check fails in a way that looks unrelated. Catch it here, before the
# expensive checks, and name the exact remedy.
#
# `npm ls --depth=0` is a read-only, no-network check: it walks the
# already-installed tree against package.json/package-lock.json and exits
# non-zero (ELSPROBLEMS) on UNMET DEPENDENCY / invalid entries. A missing
# node_modules directory is checked for separately so the failure message
# can distinguish "never installed" from "stale" -- both fail `npm ls` the
# same way, but they send the reader to the same remedy for different
# reasons.
# ---------------------------------------------------------------------------
echo ""
echo "=== [1/6] node_modules drift check ==="
for dir in . cli mcp-server web; do
  if [ ! -f "$dir/package.json" ]; then
    continue
  fi
  label="$dir"
  if [ "$dir" = "." ]; then
    label="root"
  fi
  if [ ! -d "$dir/node_modules" ]; then
    echo "FAIL: $label has never been installed (no node_modules). Run: (cd $dir && npm ci)"
    errors=$((errors + 1))
    continue
  fi
  ls_status=0
  ls_output="$(cd "$dir" && npm ls --depth=0 2>&1)" || ls_status=$?
  if [ "$ls_status" -eq 0 ]; then
    echo "  OK: $label"
  elif echo "$ls_output" | grep -q 'npm error code ELSPROBLEMS'; then
    echo "FAIL: $label node_modules does not match package-lock.json. Run: (cd $dir && npm ci) -- not npm install, which can rewrite the lockfile."
    errors=$((errors + 1))
  else
    echo "FAIL: $label -- npm ls could not be evaluated (unexpected output, npm missing, or similar). Investigate before trusting this gate run."
    echo "$ls_output" | head -20
    errors=$((errors + 1))
  fi
done
if [ "$errors" -gt 0 ]; then
  echo "node_modules drift check: FAILED"
  exit 1
fi
echo "  All components' node_modules match their lockfiles."

# ---------------------------------------------------------------------------
# [2/6] Dollar-quote SQL lint -- issue #29
#
# Checks every migration .sql file for:
#   - Unbalanced $$ (odd count -> mismatched function-body delimiters)
#   - Stray single-$ function delimiters outside of SQL string literals.
#
# String-literal filter: sed "s/'[^']*'//g" strips single-quoted strings
# BEFORE the $$-removal step so regex anchors like '^-+|-+$' are not flagged
# as stray dollar quotes.
#
# The two sed steps are intentionally separate commands (piped) to avoid
# double-quote BRE conflicts with the $$ literal match.
#
# NOTE: Assumes the $$-only convention used throughout this project's
# migrations.  Tagged dollar-quoting (e.g. $func$...$func$) is not parsed
# -- none of the existing migrations use it.
# ---------------------------------------------------------------------------
echo ""
echo "=== [2/6] Dollar-quote SQL lint ==="
for f in supabase/migrations/*.sql; do
  file_errors=0

  dq_count=$(grep -o '\$\$' "$f" 2>/dev/null | wc -l || true)
  if [ "$((dq_count % 2))" -ne 0 ]; then
    echo "FAIL: Unbalanced \$\$ in $f (count=$dq_count, expected even)"
    file_errors=$((file_errors + 1))
  fi

  stray=$(sed "s/'[^']*'//g" "$f" | sed 's/\$\$//g' | grep -n '\$' 2>/dev/null || true)
  if [ -n "$stray" ]; then
    echo "FAIL: Stray single-\$ delimiter in $f"
    echo "$stray" | head -20
    file_errors=$((file_errors + 1))
  fi

  if [ "$file_errors" -eq 0 ]; then
    echo "  OK: $f"
  fi
  errors=$((errors + file_errors))
done
if [ "$errors" -gt 0 ]; then
  echo "Dollar-quote lint: FAILED ($errors file(s))"
  exit 1
fi
echo "  All migration files pass dollar-quote lint."

# ---------------------------------------------------------------------------
# [3/6] TypeScript build (tsc --noEmit) -- per component
# ---------------------------------------------------------------------------
echo ""
echo "=== [3/6] TypeScript build ==="
for dir in cli mcp-server web; do
  if [ -f "$dir/package.json" ] && grep -q '"typescript"' "$dir/package.json" 2>/dev/null; then
    echo "  Building $dir..."
    (cd "$dir" && npx tsc --noEmit) || { echo "FAIL: tsc --noEmit in $dir"; errors=$((errors + 1)); }
  fi
done
if [ "$errors" -gt 0 ]; then
  exit 1
fi
echo "  All components compiled successfully."

# ---------------------------------------------------------------------------
# [4/6] Unit tests (vitest) -- per component
# ---------------------------------------------------------------------------
echo ""
echo "=== [4/6] Unit tests ==="
for dir in cli mcp-server web; do
  if [ -f "$dir/package.json" ] && grep -q '"vitest"' "$dir/package.json" 2>/dev/null; then
    echo "  Testing $dir..."
    (cd "$dir" && npx vitest run) || { echo "FAIL: vitest run in $dir"; errors=$((errors + 1)); }
  fi
done
if [ "$errors" -gt 0 ]; then
  exit 1
fi
echo "  All tests pass."

# ---------------------------------------------------------------------------
# [5/6] Prettier format check
# ---------------------------------------------------------------------------
echo ""
echo "=== [5/6] Prettier format check ==="
prettier_found=false
for dir in . cli mcp-server web; do
  if [ -f "$dir/package.json" ] && grep -q '"prettier"' "$dir/package.json" 2>/dev/null; then
    echo "  Format-checking $dir..."
    (cd "$dir" && npx prettier --check .) || { echo "FAIL: prettier --check in $dir"; errors=$((errors + 1)); }
    prettier_found=true
    break
  fi
done
if [ "$prettier_found" = false ]; then
  echo "  SKIP (no prettier found in any component)"
fi
if [ "$errors" -gt 0 ]; then
  exit 1
fi

# ---------------------------------------------------------------------------
# [6/6] ESLint
# ---------------------------------------------------------------------------
echo ""
echo "=== [6/6] ESLint ==="
eslint_found=false
for dir in cli mcp-server web; do
  if [ -f "$dir/package.json" ] && grep -q '"eslint"' "$dir/package.json" 2>/dev/null; then
    echo "  Linting $dir..."
    (cd "$dir" && npx eslint .) || { echo "FAIL: eslint in $dir"; errors=$((errors + 1)); }
    eslint_found=true
  fi
done
if [ "$eslint_found" = false ]; then
  echo "  SKIP (no eslint found in any component)"
fi
if [ "$errors" -gt 0 ]; then
  exit 1
fi

echo ""
echo "All gate steps passed."
