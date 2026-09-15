# Project instructions
<!-- template-sync: project-owned; migrated from CLAUDE.md at v3.1.0; migration-base: 1450034; rendered: yes -->

## Migrated from CLAUDE.md — review, then keep or delete
```diff
--- CLAUDE.md@1450034
+++ CLAUDE.md@project
@@ -42,13 +42,13 @@
 
 **Per-workstream pipeline:** Developer -> Code Reviewer -> Tester -> Developer merges PR. All developer agents have `Bash` plus the GitHub PR tools. See `AGENT_TEAM.md` → Merge Protocol.
 
-**Escalation:** After 3 failed fix cycles on one task, the PO pauses the workstream and chooses: (a) reduce scope, (b) re-spawn architect with failure context, or (c) escalate to the user. See `AGENT_TEAM.md` → *Escalation Protocol*.
+**Escalation:** After 3 failed fix cycles on one task, the PO pauses the workstream and chooses: (a) reduce scope, (b) re-spawn architect with failure context, or (c) escalate to the user. See Escalation Protocol in `AGENT_TEAM.md`.
 
 Full details: `AGENT_TEAM.md` (roles, rules, merge protocol, mode behavior table) — load on-demand per Bootstrap step 1.
 
 Spawn-prompt contracts: `AGENT_TEAM.md` → *Spawn-Prompt Binding Table* (hook-enforced) — also covers which agents lack `Bash`/GitHub tools and therefore return their work to the PO.
 
-Open Brain search/capture guidance for spawns: `AGENT_TEAM.md` §Open Brain Context for Agents.
+Open Brain search/capture guidance for spawns: `AGENT_TEAM.md` §Open Brain.
 
 ---
 
@@ -77,12 +77,14 @@
 ## Quick Start
 
 ```bash
-{{BUILD_COMMAND}}               # Build the project
-{{TEST_COMMAND}}                # Run tests
-{{FORMAT_COMMAND}}              # Format code
+npx tsc --noEmit                # Build the project (typecheck)
+npx vitest run                  # Run tests
+npx prettier --write .          # Format code
+bash hooks/run-gate.sh          # Full gate — all of the above plus the migration SQL lint
 ```
 
-> Replace placeholders above with your project's actual commands from `PROJECT_CONTEXT.md`.
+> Per-component variants: `cd cli && npx tsc --noEmit`, `cd mcp-server && npx tsc --noEmit`; tests likewise per component.
+> `PROJECT_CONTEXT.md` is the source of truth for these — if they disagree, that file wins.
 
 Language and framework conventions belong in `.claude/rules/*.md` with a `paths:` frontmatter list — those load only when you read or edit a matching file, so they cost nothing on turns that don't touch them. CLAUDE.md holds facts that apply to every turn.
 
```
