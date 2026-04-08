import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import type { z } from "zod";

export interface Deps {
  supabase: SupabaseClient;
  openai: OpenAI;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (deps: Deps, params: Record<string, unknown>) => Promise<string>;
}
