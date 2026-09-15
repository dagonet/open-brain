# Project rules (yours; sync never overwrites this file)

<!-- template-sync: project-owned, and never overwritten by a sync; introduced in v3.1.0 -->

Add `paths:`-scoped conventions here — style, language and file-type rules that
should arrive when a matching file is opened.

A rules file is delivered ONLY when a tool call touches a file its `paths:` key
matches, and it is never present when a session or a subagent starts. A rules
file with no `paths:` key is delivered to nobody. So anything that must be true
BEFORE work begins — safety rules, prohibitions, which tool to reach for —
belongs in CLAUDE.md's PROJECT-CUSTOM region, not here.
