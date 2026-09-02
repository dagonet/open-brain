# PROJECT-CUSTOM region fixture — planting recipe

Recreates real region content in this repo on any template baseline, for testing
the toolkit's region-preservation guards.

## Why this exists

Across three consumer repos surveyed (this one, panoscribe, and one other), **every
PROJECT-CUSTOM region measured placeholder-only**. That means a region guard that
silently drops content and a region guard that works are *indistinguishable* on any
real repo — the population cannot fail the test.

The toolkit's v3.0 work deletes agent files. All nine `.claude/agents/*.md` here carry
regions and are manifest-tracked, so `TEMPLATE_DELETED` × region-bearing is the modal
case in that release — and it has never run anywhere. This recipe produces the fixture
that can actually fail.

Deliberately a **recipe, not a branch**. A parked branch silently ages: it keeps looking
ready while describing an older baseline. Every base is a permanent tag (`v2.2.4`,
`v2.2.5`, `v2.3.0`, …), so re-planting on demand is strictly better than maintaining a
branch that goes stale the moment the next release lands.

## Mechanism

All 11 region-bearing files ship an identical placeholder block:

```
<!-- PROJECT-CUSTOM:BEGIN — sync-template preserves everything between these markers -->
<!-- Project-specific rules, routing blocks, and extensions go here. -->
<!-- PROJECT-CUSTOM:END -->
```

Planting is one exact string replacement per file: replace the **middle** line with the
content below, keeping both marker lines **verbatim**.

> **Do not "tidy" the BEGIN marker.** It carries an em-dash and trailing prose before
> `-->`. That is exactly what breaks a naive `PROJECT-CUSTOM:BEGIN\s*-->` extractor —
> which is the thing under test. A cleaned-up marker makes the fixture pass for the
> wrong reason.

Correct extraction pattern, for any check that reads these regions:

```python
re.search(r"PROJECT-CUSTOM:BEGIN.*?-->(.*?)<!--\s*PROJECT-CUSTOM:END", s, re.S)
```

Enumerate with `os.walk`, **not** `glob.glob('**/*.md')` — glob does not descend into
dot-directories and silently skips all of `.claude/`, i.e. every agent file.

## What to plant, and why these three files

Three different *shapes*, not three samples:

| File | Size | Sentinel | Shape it exercises |
|---|---|---|---|
| `.claude/agents/coder.md` | 767 B | `REGION-SENTINEL-CODER-7f3a` | agent file — the modal `TEMPLATE_DELETED` case once consolidation lands |
| `AGENT_TEAM.md` | 965 B | `REGION-SENTINEL-TEAM-9c58` | target of the ~97 % template-part shrink |
| `CLAUDE.md` | 929 B | `REGION-SENTINEL-CLAUDE-4b21` | also deviates *outside* its region — exercises deviation and preservation together |

**Keep synthesised content in the 750–1000 B range.** A 40-byte region and a 900-byte
region are not equally good at catching a truncating preserve.

The sentinels are the assertable part: grep for them after any sync to prove the region
survived byte-for-byte.

### `.claude/agents/coder.md`

```markdown
## Open Brain coder rules (REGION-SENTINEL-CODER-7f3a)

- `hooks/run-gate.sh` is project-owned and registered `keep-mine`. Never replace it
  with the template's version: ours IS the gate (migration dollar-quote lint for #29,
  per-component tsc/vitest), theirs reads `**Gate**:` and shells out to it.
- Migration SQL uses `$$` dollar-quoting exclusively. Tagged quoting (`$func$`) is not
  parsed by the gate's lint — do not introduce it.
- Edge functions under `supabase/functions/` are Deno, not Node. Do not add Node-only
  imports there; they are formatted by prettier but not type-checked by the CI matrix.
- `web/` is formatted but NOT linted (the gate's eslint loop covers `cli` and
  `mcp-server` only). Do not assume a lint rule protects code you add there.
```

### `AGENT_TEAM.md`

```markdown
## Open Brain team extensions (REGION-SENTINEL-TEAM-9c58)

**Merge ownership on this repo.** The gate artifact `.gate/last-pass.json` is checked at
the repo top of the *merging session's* cwd. A developer agent working in
`.claude/worktrees/agent-<id>` holds an artifact keyed to its own HEAD, so that agent
must perform its own merge — the PO's main checkout carries a different, usually stale
artifact and will be blocked correctly.

**Delegation boundary the PO hits most often.** `.mcp.json` and anything at the repo
root outside the PO write surface must be routed to `ops`, not edited by the PO. The
escape hatch `.claude/delegation-off` exists but using it to route around a guard that
fired correctly is never the right response.

**Three keep-mine files.** `hooks/run-gate.sh`, `hooks/gate-before-merge.sh` and
`PROJECT_CONTEXT.md` deviate from the template by design and are re-registered
`source="skip"` on every sync. Do not "clean up" their divergence.
```

### `CLAUDE.md`

```markdown
## Open Brain hard rules (REGION-SENTINEL-CLAUDE-4b21)

**Gate coverage is narrower than it looks.** A green `bash hooks/run-gate.sh` proves the
migration dollar-quote lint, per-component `tsc --noEmit`, and vitest. It does NOT prove
formatting or linting of `web/`, and CI runs neither prettier nor eslint at all. Do not
cite a green gate as evidence that lint passed.

**Verify the tool ran, not just that it exited 0.** `run-gate.sh` invokes prettier and
eslint through `npx`, which silently fetches the latest version from the registry when
the package is absent from `node_modules`. The tell is
`npm warn exec ... not found and will be installed` — its absence is what proves the
declared local version ran.

**Worktrees live at `.claude/worktrees/`,** inside the repo, and are excluded from
vitest, prettier, eslint and git. Never re-point `**Worktree base**:` outside the repo
without moving those four exclusions with it.
```

## Procedure

1. `git checkout -b test/<name> <base-tag-or-sha>` — any baseline.
2. Apply the three replacements above.
3. Commit as its own commit so the planting is unambiguously separable and reversible.
4. Verify before relying on it — **both arms**:
   - planted regions are found and non-empty (strip the shipped placeholder text
     `Project-specific rules, routing blocks, and extensions go here.` before judging);
   - a placeholder-only region is *not* reported as having content.
   A positive-only check passes just as happily against an extractor that returns
   everything.
5. Delete the branch when the test is done. Do not park it.

## Provenance

Content is real project knowledge from the v2.2.5 and v2.3.0 syncs rather than filler,
so byte counts are representative of a genuine consumer region. A copy is carried in the
toolkit's own fixtures (`.superpowers/sdd/simplify/region-fixture-recipe.md`) for its
v2.4.0 region-extractor work.
