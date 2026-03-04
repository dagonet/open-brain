import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { processThought } from "../_shared/process-thought.ts";
import { ThoughtSource } from "../_shared/types.ts";
const ALLOWED_SOURCES: ThoughtSource[] = ["slack", "cli", "mcp"];
serve(async (req: Request): Promise<Response> => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    );
  }
  // Reject browser-origin requests
  if (req.headers.get("Origin")) {
    return new Response(
      JSON.stringify({ success: false, error: "Browser requests are not allowed" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  try {
    const body = await req.json();
    // Validate required fields
    if (!body.text || typeof body.text !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "text is required and must be a string" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!body.source || !ALLOWED_SOURCES.includes(body.source)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "source is required and must be one of: slack, cli, mcp",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const result = await processThought({
      text: body.text,
      source: body.source,
      idempotency_key: body.idempotency_key,
      metadata: body.metadata,
    });
    return new Response(
      JSON.stringify({
        success: true,
        thought: result.thought,
        is_duplicate: result.is_duplicate,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    // Validation errors from processThought
    if (err instanceof Error && (
      err.message.includes("required") ||
      err.message.includes("exceeds maximum")
    )) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    console.error("Capture thought error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
