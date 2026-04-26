# @open-brain/cli

Command-line tool for capturing thoughts to the Open Brain system.

## Prerequisites

- Node.js 18+

## Installation

Install globally from npm:

```bash
npm install -g @open-brain/cli
```

Or build and run from the repository:

```bash
cd cli
npm install
npm run build
node dist/brain.js "your thought here"
```

## Configuration

The CLI looks for configuration in this order:

### 1. Environment Variables

```bash
export BRAIN_API_URL="https://<project>.supabase.co/functions/v1/capture-thought"
export BRAIN_API_KEY="<your-supabase-anon-key>"
```

### 2. Config File

Create `~/.brain/config.json`:

```json
{
  "api_url": "https://<project>.supabase.co/functions/v1/capture-thought",
  "api_key": "<your-supabase-anon-key>"
}
```

### Getting Your Credentials

1. Go to your Supabase project dashboard
2. Navigate to Settings > API
3. Copy the **Project URL** and append `/functions/v1/capture-thought` for the API URL
4. Copy the **anon public** key for the API key

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
- **401/403**: "Authentication failed. Check your BRAIN_API_KEY."
- **500+**: "Server error. Please try again later."
- **400**: Shows the specific validation error from the API

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

> **Note:** the resolve path requires migration `006_contradictions_anon_update.sql` (granting anon UPDATE on `contradictions`). It's part of v0.3.0 and applies idempotently via `supabase db push`.
