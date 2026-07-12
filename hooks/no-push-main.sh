#!/usr/bin/env bash
# PreToolUse hook: block push to main/master
# Matcher: mcp__git-tools__git_push
#
# Prevents direct pushes to main/master branches.
# Forces feature branch + PR workflow.

TOOL_INPUT=$(cat)
# Hook stdin nests tool args under .tool_input; keep top-level fallback for older harnesses.
REPO_PATH=$(node -e "const j=JSON.parse(process.argv[1]); console.log((j.tool_input&&j.tool_input.repo_path)||j.repo_path||'')" "$TOOL_INPUT" 2>/dev/null)
BRANCH=$(node -e "const j=JSON.parse(process.argv[1]); console.log((j.tool_input&&j.tool_input.branch)||j.branch||'')" "$TOOL_INPUT" 2>/dev/null)

# Resolve implicit branch when not specified
if [ -z "$BRANCH" ] && [ -n "$REPO_PATH" ]; then
  BRANCH=$(git -C "$REPO_PATH" branch --show-current 2>/dev/null)
fi

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "BLOCKED: Direct push to $BRANCH is not allowed. Use a feature branch and create a PR." >&2
  exit 2
fi

exit 0
