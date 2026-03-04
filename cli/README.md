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
