[Back to README](../README.md)

# The `brain` command

Capture thoughts from a shell, import notes in bulk, export to Obsidian, compile wiki pages and audit contradictions. The CLI is TypeScript with zero runtime dependencies (`cli/`, version 1.3.0). It talks to your Supabase project's edge functions and REST API.

## Install and rebuild

The package is not published to npm. Build it from a clone of the repository:

```bash
npm ci --prefix cli
npm run build --prefix cli
npm install -g --install-links=false ./cli       # from the repo root; links `brain` onto your PATH (PowerShell: npm install -g --install-links=false .\cli)
brain "your thought here"
```

Without the global install, run `node cli/dist/brain.js "your thought here"` or point a launcher script at it.

**After every `git pull`, rebuild:** `npm ci --prefix cli && npm run build --prefix cli`. `brain` runs the compiled `cli/dist/`, so until you rebuild it keeps running the old code.

Node.js 18+ runs the CLI and builds it, but `npm ci` warns below 22.12 and the CLI test suite (vitest 5) needs 22.12+.

## Configuration

The CLI reads environment variables first, then `~/.brain/config.json`. Each field is resolved on its own.

| Setting | Environment variable | Config file field | Notes |
| ------- | -------------------- | ----------------- | ----- |
| API base URL | `BRAIN_API_URL` | `api_url` | Required. |
| Service-role key | `BRAIN_SERVICE_KEY` | `service_key` | Required by every command. |
| Anon key | `BRAIN_API_KEY` | `api_key` | Unused: no command sends it. Old configs may keep it. |

```bash
export BRAIN_API_URL="https://<project-ref>.supabase.co"
export BRAIN_SERVICE_KEY="<service-role-key>"
```

Or create `~/.brain/config.json`:

```json
{
  "api_url": "https://<project-ref>.supabase.co",
  "service_key": "<service-role-key>"
}
```

**`api_url` is the API base URL.** The CLI uses `<base>/rest/v1` for REST and `<base>/functions/v1/<name>` for functions, so a local Supabase stack works with `"api_url": "http://127.0.0.1:54321"`. A trailing slash is ignored, and any other path is treated as a base prefix (for a reverse proxy). The older capture function URL form (`https://<project-ref>.supabase.co/functions/v1/capture-thought`) is still supported.

- Plain `http` to a non-loopback host is refused: only `localhost`, `127.0.0.1` and `[::1]` may use `http`; any other host must use `https`. The CLI then exits with an error before sending anything. The message names the source (`BRAIN_API_URL` or `api_url in ~/.brain/config.json`) and does not print the value. `import --dry-run` sends nothing and is not affected.
- The CLI does not follow redirects, so the service key is never forwarded to another host. If a call is refused for that reason, the error shows the cause, for example `Could not reach the API (unexpected redirect)`.

**The service key.** Database access is closed to the anon key, so `sync-vault`, `wiki get`, `wiki list`, `wiki refresh`, `audit` and `audit --resolve` all need the service-role key. `brain "<thought>"`, `import` and `wiki reject` call `capture-thought`, which is also service-role only; `audit` and `wiki refresh` call `detect-contradictions` / `compile-wiki`, which accept only the **legacy `service_role` JWT** (`eyJ...`, Dashboard > Settings > API), not an `sb_secret_...` key ([`security.md`](security.md#keys)). If neither `BRAIN_SERVICE_KEY` nor `service_key` is set, the CLI exits with an error.

## Capture

```bash
brain "Met with Sarah today, she's considering consulting"
brain "Switch the build to esbuild" --project my-repo     # scope to a project
```

On success it prints what was extracted:

```
✓ Thought captured
  Type: decision
  People: Sarah Johnson
  Topics: consulting
  Action: Follow up with Sarah about consulting timeline
```

If a retried request reuses the idempotency key (a fresh `brain "<thought>"` run never does):

```
∼ Duplicate thought (already captured)
```

If a near-duplicate of a recent thought exists, the CLI also prints a `ℹ Near-duplicate of <id> (<similarity>): "<preview>" — consider superseding.` line. The MCP tool `thoughts_supersede` marks the new thought as replacing the old one. (The hint needs `capture-thought` from release 0.9.0 deployed.)

Options: `--project <name>` stores the thought under a project; put it **after** the text.

## Flags, help and version

```bash
brain --version              # also: brain -V; prints the CLI version
brain help                   # also: brain --help, brain -h; prints usage
brain -- "-x is a flag"      # capture text that starts with a dash
```

- If the **first** argument starts with `-` and is not known (for example `brain --bogus`), it is an error: a message with a hint on stderr, exit code 1, nothing is captured. Put `--` first to capture such text, e.g. `brain -- "- buy milk"`. Wrappers that pass arbitrary text should call `brain -- "$TEXT"`. (`--project` before the text is reported as such: it must come after the text.)
- `--help` / `-h` also work on `import`, `sync-vault`, `audit` and `wiki ...`: they print usage and exit 0 without importing, exporting or calling the server. For `wiki`, `--help` / `-h` in any position wins (so `brain wiki refresh --all -h` only prints help). Side effect: a `wiki reject --reason` value of exactly `-h` or `--help` prints help too; the wiki parsers have no `--` escape, so word the reason differently. `import` and `sync-vault` reject an unknown dash-prefixed argument where the path goes; write `./-name` for a path that really starts with a dash.
- The bare word `help` is reserved only when it is the **only** argument. `brain "help me remember X"` is one argument and is captured as a thought; to capture the single word, use `brain -- help`.
- The same goes for text beginning with a dash inside quotes, such as `brain "--version"`: it is the flag, not a thought. Use `brain -- "--version"`.

## Import

Import memories from a file, one per line (a leading `[YYYY-MM-DD]` is stored as metadata):

```bash
brain import memories.txt
brain import claude-export.txt --source import-claude      # provenance tag
brain import chatgpt-export.txt --source import-chatgpt
brain import memories.txt --dry-run                        # preview, send nothing
```

| Option | Meaning |
| ------ | ------- |
| `--source <name>` | Source tag, default `import`. Use `import-claude` or `import-chatgpt` for provenance. |
| `--delay <ms>` | Delay between API calls, default 500. |
| `--dry-run` | Parse and preview without importing. |
| `--project <name>` | Store every imported thought under a project. |

Re-running is safe: the idempotency key is a SHA-256 of `source:normalized_text`.

## Export to Obsidian

```bash
brain sync-vault ~/vaults/brain               # write one markdown file per thought
brain sync-vault ~/vaults/brain --dry-run     # preview changes
```

## Wiki

These commands use the `compile-wiki` edge function and the `current_wiki_pages` and `topic_counts` views.

```bash
brain wiki get open-brain                     # print the latest page for a slug
brain wiki list --limit 10                    # newest first
brain wiki refresh open-brain                 # recompile one slug
brain wiki refresh --all                      # top 25 slugs by thought count
brain wiki refresh --all --top 50             # change the top-N
brain wiki refresh --dry-run --all            # compile/refuse split, no LLM, writes nothing
brain wiki reject <page_id> --reason "..."    # log a rejection that nudges the next refresh
```

A topic needs at least 3 thoughts to be compiled; smaller ones are refused. `--dry-run` predicts cost before a full refresh. `wiki reject` captures a `wiki-feedback` thought (via `metadata.kind`).

## Audit contradictions

```bash
brain audit                                   # last 50 candidates
brain audit --since 2026-04-01                # only thoughts since
brain audit --candidate-limit 30              # cap candidates
brain audit --verbose                         # per-row detail
```

The audit walks candidate thoughts, fetches embedding-similar neighbours, asks `gpt-4o-mini` whether each pair contradicts, and stores pairs above the confidence floor. (`--topic <slug>` is reserved and has no effect yet.)

Resolve one (this also captures an audit thought):

```bash
brain audit --resolve <id> --decision resolved --note "B supersedes A"
brain audit --resolve <id> --decision ignored
brain audit --resolve <id> --decision false_positive
```

The decision flows into future wiki compilations: `open` contradictions exclude both source thoughts; `resolved`, `ignored` and `false_positive` let them flow back. The resolve path updates `contradictions` through PostgREST, so it needs the service key.

## Errors

- **No API config:** prints the setup instructions.
- **Network error:** `Could not reach the API` plus the cause when Node reports one, and a hint to check your connection and `BRAIN_API_URL`.
- **Any failed server call:** `HTTP <status>: <error from the response>` (for `wiki refresh`, per slug).
- **401 / 403:** the same line plus a hint to check `BRAIN_SERVICE_KEY` / `service_key`.

More symptoms: [`troubleshooting.md`](troubleshooting.md).
