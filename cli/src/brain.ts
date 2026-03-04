#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

interface Config {
  api_url: string;
  api_key: string;
}

interface ThoughtResponse {
  success: boolean;
  error?: string;
  thought?: {
    thought_type: string | null;
    people: string[];
    topics: string[];
    action_items: string[];
  };
  is_duplicate?: boolean;
}

function loadConfig(): Config | null {
  // 1. Environment variables
  const envUrl = process.env.BRAIN_API_URL;
  const envKey = process.env.BRAIN_API_KEY;
  if (envUrl && envKey) {
    return { api_url: envUrl, api_key: envKey };
  }

  // 2. Config file ~/.brain/config.json
  try {
    const configPath = join(homedir(), ".brain", "config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as { api_url?: string; api_key?: string };
    if (parsed.api_url && parsed.api_key) {
      return { api_url: parsed.api_url, api_key: parsed.api_key };
    }
  } catch {
    // Config file not found or invalid
  }

  return null;
}

function printSetupInstructions(): void {
  console.error(
    [
      "",
      "Open Brain CLI - Setup Required",
      "",
      "Configure via environment variables:",
      '  export BRAIN_API_URL="https://<project>.supabase.co/functions/v1/capture-thought"',
      '  export BRAIN_API_KEY="<your-supabase-anon-key>"',
      "",
      "Or create ~/.brain/config.json:",
      "  {",
      '    "api_url": "https://<project>.supabase.co/functions/v1/capture-thought",',
      '    "api_key": "<your-supabase-anon-key>"',
      "  }",
      "",
    ].join("\n"),
  );
}

function printUsage(): void {
  console.error(
    [
      'Usage: brain "<your thought>"',
      "",
      "Example:",
      '  brain "Met with Sarah today, she\'s considering consulting"',
      "",
    ].join("\n"),
  );
}

function formatConfirmation(thought: ThoughtResponse["thought"]): string {
  if (!thought) return "";
  const lines: string[] = [];
  if (thought.thought_type) {
    lines.push("  Type: " + thought.thought_type);
  }
  if (thought.people.length > 0) {
    lines.push("  People: " + thought.people.join(", "));
  }
  if (thought.topics.length > 0) {
    lines.push("  Topics: " + thought.topics.join(", "));
  }
  for (const item of thought.action_items) {
    lines.push("  Action: " + item);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const text = process.argv[2];
  if (!text) {
    printUsage();
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }

  const idempotency_key = randomUUID();

  try {
    const response = await fetch(config.api_url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        source: "cli",
        idempotency_key,
      }),
    });

    if (response.status === 401 || response.status === 403) {
      console.error(
        "\u2717 Failed to capture thought: Authentication failed. Check your BRAIN_API_KEY.",
      );
      process.exit(1);
    }

    if (response.status >= 500) {
      console.error(
        "\u2717 Failed to capture thought: Server error. Please try again later.",
      );
      process.exit(1);
    }

    const data = (await response.json()) as ThoughtResponse;

    if (!response.ok || !data.success) {
      const msg = data.error || "HTTP " + response.status;
      console.error("\u2717 Failed to capture thought: " + msg);
      process.exit(1);
    }

    if (data.is_duplicate) {
      console.log("\u223C Duplicate thought (already captured)");
    } else {
      console.log("\u2713 Thought captured");
    }

    const details = formatConfirmation(data.thought);
    if (details) {
      console.log(details);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND")) {
      console.error(
        "\u2717 Failed to capture thought: Could not reach the API. Check your connection and BRAIN_API_URL.",
      );
    } else {
      console.error("\u2717 Failed to capture thought: " + message);
    }
    process.exit(1);
  }
}

main();
