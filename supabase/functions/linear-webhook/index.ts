// Linear webhook → starts the Sham requirements agent (a Claude Code routine) when an
// issue enters the "Idea" status in the Sham team, either by being created there or
// by being moved there. See docs/agent-pipeline.md.
//
// Secrets (supabase secrets set ...):
//   LINEAR_WEBHOOK_SECRET   signing secret shown when the webhook is created in Linear
//   ROUTINE_FIRE_URL        API trigger URL of the "Sham requirements agent" routine
//   ROUTINE_FIRE_TOKEN      API trigger token of that routine (sk-ant-oat01-...)
//
// Deploy without JWT verification, because Linear does not send a Supabase JWT:
//   supabase functions deploy linear-webhook --no-verify-jwt

const SHAM_TEAM_ID = "3a82811a-0cf4-42de-9c95-1646b239cab9";
const IDEA_STATE_ID = "607f5366-bdbb-42ee-ae76-82b3a742a8f7";
const MAX_AGE_MS = 60_000; // reject replayed deliveries

type LinearIssueEvent = {
  action: "create" | "update" | "remove" | string;
  type: string;
  webhookTimestamp?: number;
  data?: {
    identifier?: string;
    title?: string;
    teamId?: string;
    stateId?: string;
    state?: { id?: string; name?: string };
  };
  updatedFrom?: { stateId?: string };
};

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function enteredIdea(event: LinearIssueEvent): boolean {
  if (event.type !== "Issue" || !event.data) return false;
  if (event.data.teamId !== SHAM_TEAM_ID) return false;
  const stateId = event.data.stateId ?? event.data.state?.id;
  if (stateId !== IDEA_STATE_ID) return false;
  if (event.action === "create") return true;
  // Only status changes into Idea, not every edit of an issue already in Idea.
  return event.action === "update" && event.updatedFrom?.stateId !== undefined &&
    event.updatedFrom.stateId !== IDEA_STATE_ID;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("LINEAR_WEBHOOK_SECRET");
  const fireUrl = Deno.env.get("ROUTINE_FIRE_URL");
  const fireToken = Deno.env.get("ROUTINE_FIRE_TOKEN");
  if (!secret || !fireUrl || !fireToken) return new Response("not configured", { status: 500 });

  const body = await req.text();
  const signature = req.headers.get("linear-signature") ?? "";
  if (!timingSafeEqual(await hmacHex(secret, body), signature)) {
    return new Response("bad signature", { status: 401 });
  }

  let event: LinearIssueEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (event.webhookTimestamp && Math.abs(Date.now() - event.webhookTimestamp) > MAX_AGE_MS) {
    return new Response("stale", { status: 400 });
  }

  // Always answer 200 for events we ignore, so Linear doesn't retry them.
  if (!enteredIdea(event)) return new Response("ignored", { status: 200 });

  const id = event.data?.identifier ?? "unknown issue";
  const how = event.action === "create" ? "was created in" : "was moved to";
  const res = await fetch(fireUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fireToken}`,
      "anthropic-version": "2026-10-21",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: `Started by Linear: ${id} "${event.data?.title ?? ""}" ${how} Idea.`,
    }),
  });

  if (!res.ok) {
    console.error("routine fire failed", res.status, await res.text());
    // 429 = hourly fire limit; other ideas still get picked up by the next run.
    return new Response("fire failed", { status: 502 });
  }
  console.log("fired requirements agent for", id);
  return new Response("fired", { status: 200 });
});
