# @open-brain/cli

Command-line tool for capturing thoughts to the Open Brain system.

## Prerequisites

- Node.js 18+ to run; 22.12+ to build and test

## Installation

The package is not published to npm. Build it from a clone of the repository:

```bash
npm ci --prefix cli
npm run build --prefix cli
npm install -g --install-links=false ./cli       # from the repo root; links `brain` onto your PATH (PowerShell: npm install -g --install-links=false .\cli)
brain "your thought here"
```

Without the global install, run `node cli/dist/brain.js "your thought here"` or point a launcher script at it.

**After every `git pull`, rebuild:** `npm ci --prefix cli && npm run build --prefix cli`. `brain` runs the compiled `cli/dist/`, so until you rebuild it keeps running the old code.

Node.js 18+ is enough to run the CLI; building and testing it (vitest 5) needs Node.js 22.12+.

## Configuration

The CLI looks for configuration in this order:

### 1. Environment Variables

```bash
export BRAIN_API_URL="https://<project>.supabase.co/functions/v1/capture-thought"
export BRAIN_SERVICE_KEY="<your-service-role-key>"
```

### 2. Config File

Create `~/.brain/config.json`:

```json
{
  "api_url": "https://<project>.supabase.co/functions/v1/capture-thought",
  "service_key": "<your-service-role-key>"
}
```

### Service key (`brain sync-vault`, `brain wiki get/list/refresh`, `brain audit`)

Database access is closed to the anon key, so `sync-vault`, `wiki get`, `wiki list`, `wiki refresh`, `audit` and `audit --resolve` all need the service key. `brain "<thought>"`, `import` and `wiki reject` call `capture-thought`, which is also service-role only. `audit` and `wiki refresh` also call `detect-contradictions` / `compile-wiki`, which accept only the **legacy `service_role` JWT** (`eyJ...`, Dashboard → Settings → API), not an `sb_secret_...` key. Set `BRAIN_SERVICE_KEY` or add `"service_key": "<service-role-jwt>"` to `~/.brain/config.json` (the env var wins). `api_url` is required; `api_key` / `BRAIN_API_KEY` is optional and no command sends it, so you can leave it out. When a server call fails, the CLI prints the HTTP status and the function's error message; on 401/403 it also points at `BRAIN_SERVICE_KEY` / `service_key`.

### Getting Your Credentials

1. Go to your Supabase project dashboard
2. Navigate to Settings > API
3. Copy the **Project URL** and append `/functions/v1/capture-thought` for the API URL
4. Copy the **service_role** key (legacy JWT) for `BRAIN_SERVICE_KEY` / `service_key`

## Usage

```bash
brain "Met with Sarah today, she's considering consulting"
```

On success, the CLI displays extracted metadata:

```
✓ Thought captured
  Type: decision
  People: Sarah Johnson
  Topics: consulting
  Action: Follow up with Sarah about consulting timeline
```

If the thought was already captured (duplicate idempotency key):

```
∼ Duplicate thought (already captured)
```

## Error Handling

- **No API config**: Prints setup instructions
- **Network error**: "Could not reach the API. Check your connection and BRAIN_API_URL."
- **Any failed server call**: prints `HTTP <status>: <error from the response>` (for `wiki refresh`, per slug)
- **401/403**: the same line plus a hint to check `BRAIN_SERVICE_KEY` / `service_key`

## Wiki & Contradictions (v0.3.0)

These commands target the `compile-wiki` and `detect-contradictions` Supabase edge functions plus the `current_wiki_pages`, `topic_counts`, and `contradictions` PostgREST endpoints.

### `brain wiki get <slug>`

Print the latest compiled wiki page for a topic slug.

```bash
brain wiki get open-brain
```

### `brain wiki list [--limit N]`

List the latest compiled pages, newest first.

```bash
brain wiki list --limit 10
```

### `brain wiki refresh <slug> | --all`

Recompile pages on demand. The cluster size must be ≥ 3 thoughts; smaller topics are refused.

```bash
brain wiki refresh open-brain                    # one slug
brain wiki refresh --all                         # top 25 slugs by thought_count
brain wiki refresh --all --top 50                # tweak top-N
brain wiki refresh --dry-run --all               # preview, write nothing
```

`--dry-run` returns the compile/refuse split without invoking the LLM or persisting pages — use it to predict cost before a full refresh.

### `brain wiki reject <page_id> --reason "<text>"`

Reject a compiled page. Captures a `wiki-feedback` thought (via metadata.kind) that nudges the next `wiki refresh` for that slug.

```bash
brain wiki reject <page-uuid> --reason "Too much detail on the Sprint 6 work"
```

### `brain audit [options]`

Scan recent thoughts for contradictions. Walks candidate thoughts, fetches embedding-similar neighbours, asks `gpt-4o-mini` whether each pair contradicts, persists rows above the confidence floor.

```bash
brain audit                                       # last 50 candidates
brain audit --since 2026-04-01                   # only thoughts since
brain audit --candidate-limit 30                 # cap candidates
brain audit --verbose                            # print per-row detail
```

### `brain audit --resolve <id>`

Mark a contradiction as resolved/ignored/false_positive. Also captures an audit thought via the capture-thought edge function.

```bash
brain audit --resolve <id> --decision resolved --note "B supersedes A"
brain audit --resolve <id> --decision ignored
brain audit --resolve <id> --decision false_positive
```

The decision flows into future wiki compilations — `open` contradictions exclude both source thoughts; resolved/ignored/false_positive let them flow back.

> **Note:** the resolve path updates `contradictions` through PostgREST, so it needs the service key (`BRAIN_SERVICE_KEY`).
