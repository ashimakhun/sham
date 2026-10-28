# Agent pipeline

Sham is built by three Claude agents that move work through Linear. They never talk to each other directly: the issue status in Linear is the handoff, and a person reviews and merges every PR.

- Linear workspace: team **Sham** (key `ARU`), project **Sham**. The project document "Sham: what is already done" describes the current state of the app.
- Agent instructions: [`.claude/skills/`](../.claude/skills/) (`sham-requirements`, `sham-dev`, `sham-qa`).

## Workflow

```
Idea → Requirements ready → In Dev → Ready for QA → Done
                     ↘ Needs Clarification (any agent, when stuck)
```

| Agent | Skill | Picks up | Does | Hands off to |
| --- | --- | --- | --- | --- |
| Requirements | `sham-requirements` | Idea | Writes the user story, testable acceptance criteria, roles and access, dependencies, edge cases and out of scope | Requirements ready |
| Dev | `sham-dev` | Requirements ready, or In Dev issues QA sent back | Implements on branch `sham-<issue>-<slug>`, runs typecheck and lint, opens a PR and links it in the issue | Ready for QA |
| QA | `sham-qa` | Ready for QA | Checks the PR against every acceptance criterion and the access rules, writes and runs tests, posts a pass/fail checklist | Done, or back to In Dev |

### How the requirements agent picks an idea

1. Rates every unrated idea with a `difficulty` label.
2. Skips ideas blocked by an issue still in Idea or Needs Clarification.
3. Sorts the rest by difficulty (current policy: **easy first**, set in the skill's "Current priority policy" line), then by how many issues each one unblocks, then related work already in progress, then oldest.
4. Lists its top 3 candidates and why in each run, and adds blocks / blocked-by links when it finds a missing dependency.

## Linear setup

**Statuses (team Sham):** Idea, Requirements ready, In Dev, Ready for QA, Done, Needs Clarification (plus Linear's Canceled and Duplicate).

**Labels:**

- `agent:working`: lock while an agent works on an issue, so two runs never take the same one. If a run crashes, remove it by hand.
- `difficulty` group, single select:
  - `easy`: UI or text change in one or two existing screens; no database or new package.
  - `medium`: several screens or `src/lib/store.tsx`, or a new column/table with RLS.
  - `hard`: native modules (for example push notifications), realtime features (for example chat), access model changes, or anything needing a development build or external service.

  A difficulty label set by a person is an override the agent never changes.

## Guardrails

- Agents never push to `main` and never merge a PR.
- One issue per agent per run.
- The QA agent only adds or fixes tests, never app code.
- After two QA failures on the same issue, it goes to Needs Clarification for a person.

## How the agents run

### Cloud runs (Claude routines)

Each agent is a Claude routine (shown as a scheduled task) that runs in a fresh cloud session with Claude Code tools (shell, git, npm). Runs act without asking for approval; this can be changed in each routine's settings.

- **Requirements agent: started by Linear.** When an issue is created in, or moved to, **Idea** in the Sham team, Linear calls the `linear-webhook` Supabase Edge Function, which starts the routine through its API trigger (see [Event trigger setup](#event-trigger-setup)).
- **Dev and QA agents: hourly at :06** (paused while the backlog is being prepared).

The prompts are:

**Sham requirements agent**

> You are the Sham requirements agent. Load the sham-requirements skill with the Skill tool and follow it exactly for one run.
>
> Context: Linear team "Sham" (key ARU). Statuses: Idea, Requirements ready, In Dev, Ready for QA, Done, Needs Clarification. Lock label: agent:working. Difficulty labels: difficulty/easy, difficulty/medium, difficulty/hard. Repo: ashimakhun/sham (attach it read-only to read the code).
>
> Runs are usually started by Linear: a message after this prompt like "Started by Linear: ARU-12 ... was created in Idea" means new work arrived. Still choose the issue with the skill's prioritisation (difficulty per its current policy, then issue relations), not simply the issue named; the named issue gets rated in this run and written up in a later run if it isn't first. If the named issue is already locked or no longer in Idea, just run normally.
>
> Write requirements for at most one issue per run; rating other Idea issues' difficulty is fine. If nothing is eligible, end the run quietly with "nothing to do". Never write code or change the repo.

**Sham dev agent**

> You are the Sham dev agent. Load the sham-dev skill with the Skill tool and follow it exactly for one run.
>
> Context: Linear team "Sham" (key ARU). Statuses: Idea, Requirements ready, In Dev, Ready for QA, Done, Needs Clarification. Lock label: agent:working. Repo: ashimakhun/sham — attach it with push access, clone it, and read AGENTS.md before coding.
>
> Take at most one issue: first an In Dev issue sent back by QA (a comment starting "QA FAILED"), otherwise the oldest Requirements ready issue, skipping any with the agent:working label. If there is none, end the run quietly with "nothing to do". Never push to main and never merge a PR.

**Sham QA agent**

> You are the Sham QA agent. Load the sham-qa skill with the Skill tool and follow it exactly for one run.
>
> Context: Linear team "Sham" (key ARU). Statuses: Idea, Requirements ready, In Dev, Ready for QA, Done, Needs Clarification. Lock label: agent:working. Repo: ashimakhun/sham — attach it with push access, clone it, and check out the PR branch linked in the issue comments.
>
> Take at most one issue in status Ready for QA that does not have the agent:working label. If there is none, end the run quietly with "nothing to do". Only add or fix tests, never app code, and never merge a PR.

### Event trigger setup

Linear webhooks can't send the routine's bearer token, so a small relay sits in between:

```
Linear webhook (Issue events, team Sham)
  → Supabase Edge Function supabase/functions/linear-webhook
      checks the Linear signature, keeps only "entered Idea" events
  → POST <routine API trigger URL>  (starts the requirements agent)
```

One-time setup:

1. **Routine API trigger.** At [claude.ai/code/routines](https://claude.ai/code/routines), open **Sham requirements agent** → **Add another trigger** → **API** → **Generate token**. Copy the URL and the token (the token is shown once).
2. **Deploy the function** from the repo folder:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase functions deploy linear-webhook --no-verify-jwt
   ```
   Its URL is `https://<your-project-ref>.supabase.co/functions/v1/linear-webhook`.
3. **Linear webhook.** In Linear: Settings → API → Webhooks → New webhook. URL: the function URL above. Team: Sham. Data change events: **Issues** only. Save, then copy its **signing secret**.
4. **Secrets:**
   ```bash
   npx supabase secrets set \
     LINEAR_WEBHOOK_SECRET=<signing secret> \
     ROUTINE_FIRE_URL=<routine API trigger URL> \
     ROUTINE_FIRE_TOKEN=<routine token>
   ```
5. **Test:** create an issue in Idea. The function's logs (Supabase dashboard → Edge Functions → linear-webhook) should show `fired requirements agent for ARU-…`, and a new run appears for the routine.

Notes:

- Only creation in Idea, or a status change into Idea, starts a run. Editing an issue that is already in Idea doesn't.
- Each run writes up one issue, so adding five ideas starts five runs.
- A routine accepts up to 30 starts per hour. If that is ever exceeded, the remaining ideas wait for the next start.
- Generating a new routine token revokes the old one; update `ROUTINE_FIRE_TOKEN` when you do.

### By hand (Claude Code)

The skills in `.claude/skills/` load automatically when Claude Code runs in this repo. With the Linear connector available, run one agent step yourself:

```bash
cd sham
claude
> /sham-dev
```

Use this when an issue needs you watching, or for anything that needs a local simulator.

## Keeping things in sync

The skills exist in two places: in this repo (used by Claude Code here) and in your Claude account (used by the scheduled tasks). **Treat this repo as the source of truth**: when you change an agent's behaviour, change the skill here and update the account copy to match (ask Claude to propose the updated skill from the repo file).

## How to use it

1. Create an issue in the Sham team with status **Idea**. A short title and a sentence or two is enough.
2. Optionally set a difficulty label or link related issues.
3. Within the hour the requirements agent turns it into a full story. Review it; edit or move it back if needed.
4. Review the dev agent's PR and the QA checklist, then merge.
