# Open Brain MCP Server

A local MCP (Model Context Protocol) server for Open Brain memory retrieval. Provides semantic search, recent thought listing, soft-delete, and system status tools.

## Prerequisites

- Node.js 18+
- npm
- A Supabase project with the Open Brain schema deployed
- An OpenAI API key (for embedding-based semantic search)

## Setup

### 1. Install dependencies

cd mcp-server, then run npm install and npm run build.

### 2. Configure environment variables

SUPABASE_URL - Your Supabase project URL
SUPABASE_SERVICE_ROLE_KEY - Supabase service role key (NOT the anon key)
OPENAI_API_KEY - OpenAI API key for generating embeddings

### 3. Install the database function

Run the SQL in sql/match_thoughts.sql in your Supabase SQL Editor or add as a migration. This creates the match_thoughts function used by semantic search.

### 4. Configure Claude Code

Add to your .claude/mcp.json or claude_desktop_config.json:

{
  mcpServers: {
    open-brain: {
      command: node,
      args: [/absolute/path/to/mcp-server/dist/index.js],
      env: {
        SUPABASE_URL: https://your-project.supabase.co,
        SUPABASE_SERVICE_ROLE_KEY: your-service-role-key,
        OPENAI_API_KEY: sk-your-openai-key
      }
    }
  }
}

## Tools

### thoughts_search
Search thoughts by semantic similarity. Embeds query via OpenAI and matches against stored embeddings.
Parameters: query (string, required), limit (number, default 10), thought_type (string, optional), people (string[], optional), topics (string[], optional), days (number, optional)

### thoughts_recent
List recent thoughts ordered by creation date. No embedding needed.
Parameters: days (number, default 7), limit (number, default 20)

### thoughts_delete
Soft-delete a thought by UUID. Sets deleted_at timestamp.
Parameters: id (string UUID, required)

### thoughts_people
List all unique people mentioned across thoughts, with mention count and last mentioned date.
Parameters: limit (number, default 50)

### thoughts_topics
List all unique topics mentioned across thoughts, with mention count and last mentioned date.
Parameters: limit (number, default 50)

### thoughts_review
Generate a structured summary of thoughts captured over a time period.
Parameters: days (number, default 7)

### thoughts_capture
Capture a thought, decision, insight, or note into Open Brain memory.
Parameters: text (string, required), metadata (object, optional)

### system_status
Returns system overview: total thoughts, counts by status/source, recent failures, embedding config. No parameters.
