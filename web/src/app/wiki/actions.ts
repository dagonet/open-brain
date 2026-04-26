"use server";

// Server actions for the wiki dashboard routes.
//
// Inspired by Andrej Karpathy's LLM Wiki gist
//   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// via Nate B Jones
//   https://www.youtube.com/watch?v=dxq7WtWxi44

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";

const CAPTURE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/capture-thought`
  : "";
const COMPILE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/compile-wiki`
  : "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function rejectWikiPage(formData: FormData): Promise<void> {
  const pageId = String(formData.get("page_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!pageId || !slug || !reason) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // Idempotency key: page id + first 80 chars of reason — same reason on the
  // same page is a no-op.
  const idempotencyInput = pageId + ":" + reason.slice(0, 80).toLowerCase();
  const encoder = new TextEncoder();
  const buf = encoder.encode(idempotencyInput);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const idempotency_key = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const captureRes = await fetch(CAPTURE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: `Wiki page ${pageId} (slug: ${slug}) rejected: ${reason}`,
      source: "mcp",
      idempotency_key,
      metadata: {
        kind: "wiki-feedback",
        page_id: pageId,
        slug,
        decision: "invalidate",
      },
    }),
  });
  if (!captureRes.ok) {
    throw new Error(
      `Failed to record rejection: HTTP ${captureRes.status} ${captureRes.statusText}`,
    );
  }

  revalidatePath(`/wiki/${slug}`);
}

export async function refreshWikiPage(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  if (!slug) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const refreshRes = await fetch(COMPILE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slug }),
  });
  if (!refreshRes.ok) {
    throw new Error(
      `Failed to refresh wiki page: HTTP ${refreshRes.status} ${refreshRes.statusText}`,
    );
  }

  revalidatePath(`/wiki/${slug}`);
}

export async function resolveContradiction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!id || !["resolved", "ignored", "false_positive"].includes(decision)) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // RLS on `contradictions` is intentionally open for authenticated users
  // (single-user deployment per migration 005). If multi-user support is
  // added later, also filter by an ownership column here.
  const { error: updateErr } = await supabase
    .from("contradictions")
    .update({
      status: decision,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateErr) {
    throw new Error(`Failed to resolve contradiction: ${updateErr.message}`);
  }

  // Capture an audit thought so the resolution is itself a memory.
  if (note) {
    const idempotencyInput = `${id}:${decision}:${note.slice(0, 80)}`;
    const buf = new TextEncoder().encode(idempotencyInput);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const idempotency_key = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const captureRes = await fetch(CAPTURE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: `Resolved contradiction ${id} as ${decision}. Note: ${note}`,
        source: "mcp",
        idempotency_key,
        metadata: {
          kind: "contradiction-resolution",
          contradiction_id: id,
          decision,
        },
      }),
    });
    if (!captureRes.ok) {
      // Resolution succeeded; only the audit thought failed. Log but don't
      // throw, so the user-visible action stays "resolved".
      console.error(
        `Failed to capture contradiction-resolution audit thought: HTTP ${captureRes.status}`,
      );
    }
  }

  revalidatePath("/contradictions");
  revalidatePath(`/contradictions/${id}`);
}
