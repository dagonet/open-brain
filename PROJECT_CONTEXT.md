# Project Context

## Project

- **Name**: Open Brain (AI Memory)
- **Tech stack**: TypeScript, Deno (edge functions), Node.js (MCP server + CLI), PostgreSQL + pgvector, Supabase, OpenAI API, Slack Events API, MCP SDK
- **Repository**: https://github.com/dagonet/open-brain
- **Branch strategy**: feature branches per task, PR into the trunk — the branch named on the `**Protected branches**:` line directly below (see AGENT_TEAM.md Mode Behavior Table for naming convention). Prose for humans — **no hook reads this line**.
<!-- THE line the protection hooks read; space- or comma-separated names.
     EDIT THIS if your trunk is not main/master — nothing fills it in for you,
     and a trunk that is not named here is NOT protected.
     Absent, empty, or an unfilled {{...}} all fall back to `main master`;
     `none` protects nothing (branch rules only; a PR merge stays gated). -->
- **Protected branches**: main master
<!-- Extends the fresh-artifact requirement to branches that are NOT protected:
     a branch matching one of these globs is refused a merge unless
     `.gate/last-pass.json` matches HEAD. Space- or comma-separated globs.
     `none` = only the protected branches are artifact-checked (today's
     behaviour, chosen deliberately 2026-09-15). This is `none` and NOT the
     template's `{{GATE_CHECKED_BRANCHES}}`: an unfilled placeholder also reads
     as none, but emits a WARN on every hook invocation and leaves the reader
     inert without saying so. Set e.g. `feat/* fix/*` to tighten. -->
- **Gate-checked branches**: none

## Commands

- **Build**: `npx tsc --noEmit`
- **Test**: `npx vitest run`
- **Format**: `npx prettier --write .`
- **Lint**: `npx eslint .`
<!-- Run by hooks/post-edit-build.sh after every Edit/Write. `none` is a real
     opt-out here (unlike **Test**), and is the deliberate choice: the
     TypeScript build already runs as step [3/6] of the Gate, and a full `tsc`
     on every single edit costs more than it catches on this repo. -->
- **Post-edit build**: none
<!-- Points at a PROJECT-owned script, never at hooks/run-gate.sh. run-gate.sh is
     the template-owned RUNNER: it reads this line and executes the value, then
     mints the pass artifact. So it cannot BE the value — it exports
     RUN_GATE_ACTIVE and refuses re-entry (exit 78) at any nesting depth, which
     makes a wrapper a hard block rather than a clever workaround. Until
     2026-09-15 this line read `bash hooks/run-gate.sh`, and the six gate steps
     lived inside that template-owned path; they now live in scripts/gate.sh. -->
- **Gate**: `bash scripts/gate.sh`
<!-- Declaring BOTH means the Test runs on commit and the Gate does not, so no artifact is minted and every merge needs a separate `bash hooks/run-gate.sh`. Worth it only above roughly gate_seconds / (gate_seconds - test_seconds) commits per PR — measure yours. Below that, declare the Gate alone and leave the Test field empty (a literal `none` is NOT an opt-out here: it is eval'd as a command and blocks every commit — measured 2026-09-03). -->
<!-- Join Gate command steps with `&&`, never `;` — `;` discards an earlier step's failure status, so `<real gate> ; <anything>` exits 0 and the gate mints a pass artifact on a failing suite. -->

<!-- Per-component variants: `cd cli && npx tsc --noEmit`, `cd mcp-server && npx tsc --noEmit`; tests likewise per component -->

## Paths

- **Worktree base**: `.claude/worktrees` (repo-relative; this is where the harness actually creates `isolation: worktree` agents, as `.claude/worktrees/agent-<id>`)
- **Architecture docs**: `docs/`
- **Log location**: stdout

## Workflow Configuration

- **Task source**: `plan-files`
- **Max parallel workstreams**: 5
- **Commit convention**: `feat:`, `fix:`, `chore:`, `test:`, `docs:` prefixes
<!-- EXTRA path prefixes the PO may Edit/Write directly, on top of the built-in
     allow-list (docs/plans/, PROJECT_STATE.md, PROJECT_CONTEXT.md, .claude/,
     CLAUDE.md, AGENT_TEAM.md) that hooks/enforce-delegation.sh hardcodes.
     `none` = built-in list only, which is today's behaviour. Widening this is a
     delegation-policy decision, not a convenience: it is the supported way to
     let the PO touch more of the tree, so it belongs to the user, never to a
     session that finds itself blocked. -->
- **PO write surface**: none
- **Issue labels** (github-issues mode only): `feature`, `bug`, `tech-debt`

## Preprocessing

- **Ollama**: available (MCP: `ollama-tools`) -- see CLAUDE.local.md for usage rules
- **Context7**: available (MCP: `context7`)
