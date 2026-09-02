#!/usr/bin/env bash
# run-gate.sh -- pre-merge quality gate for the Open Brain project
#
# Checks, in order:
#   1. Dollar-quote balance in migration SQL files (closes issue #29)
#   2. TypeScript compilation (tsc --noEmit) in each component
#   3. Vitest unit tests in each component
#   4. Prettier formatting check
#   5. ESLint in each component
#
# On passing all checks, writes .gate/last-pass.json for
# gate-before-merge.sh to validate before allowing a merge.
#
# Usage: bash hooks/run-gate.sh
#   (run from repo root or any subdirectory)

set -euo pipefail

REPO_TOP="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"
cd "$REPO_TOP"

# Captured before any check runs, so it names the state actually tested.
# Re-verified at artifact-write time below: whatever key the artifact
# records must be captured before the gate command runs and re-verified
# after it, or the guard would compare something the artifact never
# records and pass silently. This artifact records `sha` only, so that is
# what we capture and re-verify.
START_SHA="$(git rev-parse HEAD)"

mkdir -p .gate
errors=0

# ---------------------------------------------------------------------------
# [1/5] Dollar-quote SQL lint -- issue #29
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
echo "=== [1/5] Dollar-quote SQL lint ==="
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
# [2/5] TypeScript build (tsc --noEmit) -- per component
# ---------------------------------------------------------------------------
echo ""
echo "=== [2/5] TypeScript build ==="
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
# [3/5] Unit tests (vitest) -- per component
# ---------------------------------------------------------------------------
echo ""
echo "=== [3/5] Unit tests ==="
for dir in cli mcp-server; do
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
# [4/5] Prettier format check
# ---------------------------------------------------------------------------
echo ""
echo "=== [4/5] Prettier format check ==="
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
# [5/5] ESLint
# ---------------------------------------------------------------------------
echo ""
echo "=== [5/5] ESLint ==="
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

# ---------------------------------------------------------------------------
# All checks passed -- write gate artifact
#
# HEAD-moved-during-gate guard: if the checkout moved out from under this
# run (a concurrent checkout, rebase, or overlapping gate run), the sha the
# checks ran against and the sha HEAD now points at differ. Writing the
# artifact at that point would record a state the run never tested. Exit 1
# (not a terminal exit code) because this is a race: settling the checkout
# and re-running the gate is genuinely correct advice, not a false promise.
# ---------------------------------------------------------------------------
end_sha="$(git rev-parse HEAD)"
if [ "$end_sha" != "$START_SHA" ]; then
  rm -f .gate/last-pass.json
  echo "" >&2
  echo "GATE ERROR: HEAD moved during gate run (started at $START_SHA, now at $end_sha)." >&2
  echo "The checkout changed while checks were running; the results do not describe a single, stable commit. Settle the checkout and re-run the gate." >&2
  exit 1
fi

cat > .gate/last-pass.json <<EOF
{
  "sha": "$START_SHA",
  "passed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
}
EOF
echo ""
echo "GATE PASS $START_SHA"
