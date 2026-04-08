# Open Brain: Agent-Readable Memory Architecture for AI

**Video:** "Your Second Brain Is Closed. Your AI Can't Use It." by Nate Herk
**Source:** [YouTube](https://www.youtube.com/watch?v=2JiMmye2ezg)
**Companion Guide:** [Nate's Substack](https://natesnewsletter.substack.com/p/every-ai-you-use-forgets-you-heres)

---

## Core Thesis

The biggest bottleneck in AI productivity today isn't model quality -- it's **memory architecture**. Every AI platform (Claude, ChatGPT, Gemini, Cursor) builds siloed memory that doesn't talk to each other and isn't accessible to autonomous agents. You need to own your own memory infrastructure.

## The Problem

- Every time you open a new chat or switch between AI tools, you start from zero.
- Platform-native memory features are designed as **lock-in mechanisms** -- they keep you dependent on one vendor.
- Existing note-taking tools (Notion, Apple Notes, Obsidian, Evernote) were built for the "human web" (visual layouts, folder structures) and are fundamentally **not designed for agent-readable semantic queries**.
- As autonomous agents go mainstream (OpenClaw surpassing 190k GitHub stars, Anthropic building agents), this gap becomes critical: **agents need structured, semantically searchable context** to be effective.
- A Harvard Business Review study found that digital workers toggle between applications nearly 1,200 times a day -- much of this is context transfer rather than real work.

## The Solution: "Open Brain" Architecture

Nate proposes a database-backed, MCP-connected knowledge system called **Open Brain**. The architecture consists of three core components:

### 1. PostgreSQL + pgvector as the Foundation

Your thoughts live in a Postgres database **you** control. pgvector enables vector embeddings, so every captured thought gets a mathematical representation of its meaning -- enabling **semantic search** rather than keyword matching. Postgres is chosen deliberately for being boring, battle-tested, and not dependent on any VC-backed SaaS.

### 2. Capture Pipeline (via Slack / any messaging app to Supabase)

You type a thought into a Slack channel (or any input). A Supabase edge function then **in parallel**:

- Generates a vector embedding of the meaning
- Extracts metadata (people, topics, type, action items)
- Stores everything in the Postgres database with pgvector

Confirmation comes back in-thread within ~10 seconds.

### 3. MCP Server for Retrieval

An MCP server connects to the database and exposes three tools to any compatible AI client:

- **Semantic search** -- find thoughts by meaning
- **List recent** -- browse what you captured this week
- **Stats** -- see your patterns

Any MCP-compatible client (Claude, Claude Code, ChatGPT, Cursor, VS Code) becomes both a capture point and a search tool.

## Architecture Diagram

```
Input (Slack, any messaging app)
    |
Supabase Edge Function
    |-- Generates vector embedding
    |-- Extracts metadata (people, topics, type, action items)
    +-- Stores both in PostgreSQL + pgvector
    |
MCP Server (8 tools: thoughts_search, thoughts_recent, thoughts_capture, etc.)
    |
Any AI Client (Claude, ChatGPT, Cursor, Claude Code, VS Code, etc.)
```

## Setup Requirements

- **Time:** ~45 minutes, copy-paste, no coding required
- **Infrastructure:** Supabase free tier + Slack free tier
- **Running cost:** $0.10-$0.30/month for ~20 thoughts/day in API calls
- Tested by a person with zero coding experience who completed setup in ~45 minutes

## Four Companion Prompts for the Memory Lifecycle

### 1. Memory Migration

Run once after setup. Extracts everything your existing AIs (Claude's memory, ChatGPT's memory) already know about you and saves it into Open Brain. Every new AI tool then starts with that foundation instead of zero.

### 2. Open Brain Spark

An interview prompt that discovers how the system fits your specific workflow. It asks about your tools, decisions, re-explanation patterns, and key people, then generates a personalized list organized by category of what you should be putting into Open Brain regularly. Useful for overcoming capture writer's block.

### 3. Quick Capture Templates

Five-sentence starters optimized for clean metadata extraction:

- **Decision capture:** `Decision: [what]. Context: [why]. Owner: [who].`
- **Person note:** `[Name] -- [what happened or what you learned about them].`
- **Insight capture**
- **Meeting debrief**

Each is designed to trigger the right classification in the processing pipeline. After about a week, you develop your own patterns and need the templates less.

### 4. Weekly Review

End-of-week synthesis across everything you captured:

- Clusters by topic
- Scans for unresolved action items
- Detects patterns across days
- Finds connections you missed
- Identifies gaps in what you're tracking

About 5 minutes on a Friday afternoon, becoming more valuable every week as the brain grows.

## Key Insights

- **Memory architecture determines agent capability** far more than model selection -- this is widely misunderstood.
- The internet is forking into a **human web** (fonts, layouts) and an **agent web** (APIs, structured data). Your memory needs to live on the agent web layer.
- MCP is described as the "USB-C of AI" -- one protocol, every AI, your data stays in one place.
- The compounding advantage: every thought captured makes the next search smarter and the next connection more likely to surface. Person B (with Open Brain) accumulates context advantage over Person A (starting from zero) every single week.
- Good context engineering for agents happens to produce good context engineering for humans -- clarity benefits everyone.
- MCP servers are not just for retrieval -- any MCP-compatible client becomes both a capture point and a search tool, enabling dashboards, daily digests, and custom tools on top of the same data.

## Relevance for Enterprise AI Integration

This architecture maps directly onto a multi-layered enterprise approach:

- **Foundation layer:** PostgreSQL + pgvector (equivalent to a RAG knowledge store)
- **Access layer:** MCP server (standardized protocol for any AI client)
- **Capture layer:** Edge functions for automated embedding and metadata extraction

For enterprise use cases, additional layers would be needed:

- Audit logging and compliance
- Authentication and role-based access control
- Central orchestrator for routing between multiple MCP servers
- Integration with existing tools (GitLab, Jira, Confluence, Artifactory)

The core principle -- **invest in foundational memory infrastructure before optimizing individual AI tools** -- applies at both personal and enterprise scale.
