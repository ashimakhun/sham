// Linear webhook → starts a Sham agent (a Claude routine) when an issue in the Sham team enters a status:
//   Idea          → requirements agent
//   Ready for Dev → dev agent
// "Enters" means it was created in that status or moved into it. See docs/agent-pipeline.md.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or `supabase secrets set ...`):
//   LINEAR_WEBHOOK_SECRET           signing secret shown when the webhook is created in Linear
//   REQUIREMENTS_ROUTINE_FIRE_URL   API trigger URL of the "Sham requirements agent" routine
//   REQUIREMENTS_ROUTINE_FIRE_TOKEN API trigger token of that routine (sk-ant-oat01-...)
//   DEV_ROUTINE_FIRE_URL            API trigger URL of the "Sham dev agent" routine
//   DEV_ROUTINE_FIRE_TOKEN          API trigger token of that routine
// A route whose two secrets are missing is skipped (logged), so each agent can be connected separately.
//
// Deploy without JWT verification, because Linear does not send a Supabase JWT:
//   supabase functions deploy linear-webhook --no-verify-jwt

const SHAM_TEAM_ID = "3a82811a-0cf4-42de-9c95-1646b239cab9";
const MAX_AGE_MS = 60_000; // reject replayed deliveries

type Route = { stateId: string; stateName: string; agent: string; urlEnv: string; tokenEnv: string };

export const ROUTES: Route[] = [
  {
    stateId: "607f5366-bdbb-42ee-ae76-82b3a742a8f7",
    stateName: "Idea",
    agent: "requirements agent",
    urlEnv: "REQUIREMENTS_ROUTINE_FIRE_URL",
    tokenEnv: "REQUIREMENTS_ROUTINE_FIRE_TOKEN",
  },
  {
    stateId: "99c327c5-8a2b-4198-a8eb-527200ca220a",
    stateName: "Ready for Dev",
    agent: "dev agent",
    urlEnv: "DEV_ROUTINE_FIRE_URL",
    tokenEnv: "DEV_ROUTINE_FIRE_TOKEN",
  },
];

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

// The route whose status the issue just entered, or null.
export function routeFor(event: LinearIssueEvent): Route | null {
  if (event.type !== "Issue" || !event.data) return null;
  if (event.data.teamId !== SHAM_TEAM_ID) return null;
  const stateId = event.data.stateId ?? event.data.state?.id;
  const route = ROUTES.find((r) => r.stateId === stateId);
  if (!route) return null;
  if (event.action === "create") return route;
  // Only status changes into the status, not every edit of an issue already there.
  if (
    event.action === "update" && event.updatedFrom?.stateId !== undefined &&
    event.updatedFrom.stateId !== route.stateId
  ) return route;
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("LINEAR_WEBHOOK_SECRET");
  if (!secret) return new Response("not configured", { status: 500 });

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
  const route = routeFor(event);
  if (!route) return new Response("ignored", { status: 200 });

  const fireUrl = Deno.env.get(route.urlEnv);
  const fireToken = Deno.env.get(route.tokenEnv);
  const id = event.data?.identifier ?? "unknown issue";
  if (!fireUrl || !fireToken) {
    console.warn(`${route.agent} not connected (${route.urlEnv} / ${route.tokenEnv} missing); skipped ${id}`);
    return new Response("route not configured", { status: 200 });
  }

  const how = event.action === "create" ? "was created in" : "was moved to";
  const res = await fetch(fireUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fireToken}`,
      "anthropic-version": "2026-10-21",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: `Started by Linear: ${id} "${event.data?.title ?? ""}" ${how} ${route.stateName}.`,
    }),
  });

  if (!res.ok) {
    // 400 = routine paused, 429 = hourly start limit. The routine's fallback schedule picks the issue up later.
    console.error(`${route.agent} start failed`, res.status, await res.text());
    return new Response("fire failed", { status: 502 });
  }
  console.log(`started ${route.agent} for ${id}`);
  return new Response("fired", { status: 200 });
});
