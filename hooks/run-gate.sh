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
for dir in cli mcp-server; do
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
for dir in cli mcp-server; do
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
# ---------------------------------------------------------------------------
sha="$(git rev-parse HEAD)"
cat > .gate/last-pass.json <<EOF
{
  "sha": "$sha",
  "passed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
}
EOF
echo ""
echo "GATE PASS $sha"
