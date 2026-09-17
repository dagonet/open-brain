# Project rules (yours; sync never overwrites this file)

<!-- template-sync: project-owned, and never overwritten by a sync; introduced in v3.1.0 -->

This file has no `paths:` key, so Claude Code loads it at EVERY session start,
at the same priority as CLAUDE.md. Anything you write here is always on.

To scope it to files instead, add a frontmatter block at the very top:

    ---
    paths:
      - "src/**/*.py"
      - "pyproject.toml"
    ---

Always-on project rules belong in CLAUDE.md's PROJECT-CUSTOM region, not here;
a rule in both places exists twice and drifts.
