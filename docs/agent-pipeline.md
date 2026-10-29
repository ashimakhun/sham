# Agent pipeline

Sham is built by three Claude agents (requirements, dev and QA; the QA agent has two jobs) that move work through Linear. They never talk to each other directly: the issue status in Linear is the handoff, and a person reviews and merges every PR.

- Linear workspace: team **Sham** (key `ARU`), project **Sham**. The project document "Sham: what is already done" describes the current state of the app.
- Agent instructions: [`.claude/skills/`](../.claude/skills/) (`sham-requirements` with `sham-merge-issues`, `sham-requirements-analysis`, `sham-dev`, `sham-qa`).

## Workflow

```
Idea → Requirements ready → Ready for Dev → In Dev → Ready for QA → Done
  ↑              │
  └──────────────┘ analysis sends a story back with CHANGES NEEDED
                     ↘ Needs Clarification (any agent, when a person must decide)
```

QA files every failure as a **Bug** issue that blocks its story (the story waits in In Dev):

```
QA finds a failure ─┬─ bug-cause/code ─────────→ Ready for Dev ─→ dev fixes on the story's PR branch ─→ Ready for QA ─→ QA verifies ─→ Done
                    └─ bug-cause/requirements ─→ Requirements ready ─→ analysis decides:
                                                   code bug after all ─→ Ready for Dev
                                                   CRITERION CHANGE (new/revised AC) ─→ Ready for Dev
                                                   not a bug ─→ Canceled
                                                   needs a decision ─→ Needs Clarification
When a story's last open bug is closed, the story goes back to Ready for QA for a re-test.
```

| Agent | Skill | Picks up | Does | Hands off to |
| --- | --- | --- | --- | --- |
| Requirements | `sham-requirements` (+ `sham-merge-issues`) | Idea (revisions sent back by analysis first) | Merges overlapping ideas, then writes the user story, testable acceptance criteria, roles and access, dependencies, edge cases and out of scope | Requirements ready |
| QA: requirements analysis | `sham-requirements-analysis` | Requirements ready (requirements bugs first) | Independent review against the code: testable criteria, roles and RLS, data impact, dependencies, edge cases, size. Never edits the story; posts `ANALYSIS: READY` plus a `TEST DESIGN`, or the problems found. For a requirements bug: reroutes it to dev, writes an `ANALYSIS: CRITERION CHANGE`, or cancels it | Ready for Dev, back to Idea, Canceled, or Needs Clarification |
| Dev | `sham-dev` | Ready for Dev (bugs first) | Fixes bugs on the story's PR branch until QA's reproduction test passes. For stories: applies the analysis notes, implements on branch `sham-<issue>-<slug>`, runs typecheck and lint, opens a PR and links it in the issue | Ready for QA |
| QA: testing | `sham-qa` | Ready for QA (bug fixes first) | Checks the PR against every acceptance criterion and the access rules, writes and runs tests from the `TEST DESIGN`, posts a pass/fail checklist, files each failure as a Bug issue, verifies bug fixes | Done; story to In Dev with its bugs |

### How the requirements agent picks an idea

1. Rates every unrated idea with a `difficulty` label.
2. Skips ideas blocked by an issue still in Idea or Needs Clarification.
3. Sorts the rest by difficulty (current policy: **easy first**, set in the skill's "Current priority policy" line), then by how many issues each one unblocks, then related work already in progress, then oldest.
4. Lists its top 3 candidates and why in each run, and adds blocks / blocked-by links when it finds a missing dependency.

## Linear setup

**Statuses (team Sham):** Idea, Requirements ready, Ready for Dev, In Dev, Ready for QA, Done, Needs Clarification (plus Linear's Canceled and Duplicate).

**Labels:**

- `agent:working`: lock while an agent works on an issue, so two runs never take the same one. If a run crashes, remove it by hand.
- `difficulty` group, single select:
  - `easy`: UI or text change in one or two existing screens; no database or new package.
  - `medium`: several screens or `src/lib/store.tsx`, or a new column/table with RLS.
  - `hard`: native modules (for example push notifications), realtime features (for example chat), access model changes, or anything needing a development build or external service.

  A difficulty label set by a person is an override the agent never changes.
- `Bug`: an issue the QA agent filed for a failure, with one label from the `bug-cause` group:
  - `code`: the code doesn't meet a clear criterion, crashes, regresses, or breaks the access rules → dev agent.
  - `requirements`: the criterion is ambiguous, contradictory, silent about the case, or wrong → requirements analysis first.

## Guardrails

- Agents never push to `main` and never merge a PR.
- One issue per agent per run.
- The QA agent only adds or fixes tests, never app code.
- A story failing QA a third time goes to Needs Clarification (with its new bugs) for a person.
- A bug reopened twice goes to Needs Clarification.
- The dev agent never edits a QA test to make it pass; if it thinks the test is wrong, the bug goes to requirements analysis.
- After two `ANALYSIS: CHANGES NEEDED` rounds on the same story, the third problem goes to Needs Clarification instead of back to Idea.
- The dev agent never codes a story that hasn't passed analysis.

## How the agents run

### Cloud runs (Claude routines)

Each agent is a Claude routine (shown as a scheduled task) that runs in a fresh cloud session with Claude Code tools (shell, git, npm). Runs act without asking for approval; this can be changed in each routine's settings.

- **Requirements agent: started by Linear.** When an issue is created in, or moved to, **Idea** in the Sham team, Linear calls the `linear-webhook` Supabase Edge Function, which starts the routine through its API trigger (see [Event trigger setup](#event-trigger-setup)).
- **QA agent, requirements analysis: hourly at :43.** Reviews one Requirements ready issue per run (requirements bugs first).
- **Dev agent: started by Linear** when an issue is created in, or moved to, **Ready for Dev** (stories that passed analysis and bugs routed to dev), through the same Edge Function. A fallback run every 6 hours picks up anything a missed start left behind.
- **QA testing: hourly at :06** (paused).

The prompts are:

**Sham requirements agent**

> You are the Sham requirements agent. Load the sham-requirements skill with the Skill tool and follow it exactly for one run.
>
> Context: Linear team "Sham" (key ARU). Statuses: Idea, Requirements ready, Ready for Dev, In Dev, Ready for QA, Done, Needs Clarification. Lock label: agent:working. Difficulty labels: difficulty/easy, difficulty/medium, difficulty/hard. Repo: ashimakhun/sham (attach it read-only to read the code).
>
> Runs are usually started by Linear: a message after this prompt like "Started by Linear: ARU-12 ... was created in Idea" means new work arrived. Still choose the issue with the skill's prioritisation (revisions sent back by analysis first, then difficulty per its current policy, then issue relations), not simply the issue named; the named issue gets rated in this run and written up in a later run if it isn't first. If the named issue is already locked or no longer in Idea, just run normally.
>
> Write requirements for at most one issue per run; rating other Idea issues' difficulty is fine. If nothing is eligible, end the run quietly with "nothing to do". Never write code or change the repo.

**Sham requirements analysis (QA agent)**

> You are the Sham QA agent doing requirements analysis. Load the sham-requirements-analysis skill with the Skill tool and follow it exactly for one run.
>
> Context: Linear team "Sham" (key ARU). Statuses: Idea, Requirements ready, Ready for Dev, In Dev, Ready for QA, Done, Needs Clarification, Canceled. Lock label: agent:working. Bug labels: Bug, bug-cause/code, bug-cause/requirements. Difficulty labels: difficulty/easy, difficulty/medium, difficulty/hard. Repo: ashimakhun/sham (attach it read-only to read the code).
>
> Review at most one issue in Requirements ready that does not have the agent:working label: requirements bugs (Bug + bug-cause/requirements) first, then stories. If there is none, end the run quietly with "nothing to do". If the team has no Ready for Dev status yet, stop and say it must be added in Linear. Never write code or tests and never change the repo.

**Sham dev agent**

> You are the Sham dev agent. Load the sham-dev skill with the Skill tool and follow it exactly for one run.
>
> Context: Linear team "Sham" (key ARU). Statuses: Idea, Requirements ready, Ready for Dev, In Dev, Ready for QA, Done, Needs Clarification, Canceled. Lock label: agent:working. Bug labels: Bug, bug-cause/code, bug-cause/requirements. Repo: ashimakhun/sham — attach it with push access, clone it, and read AGENTS.md before coding.
>
> Runs are usually started by Linear: a message after this prompt like "Started by Linear: ARU-12 ... was moved to Ready for Dev" means new work arrived. Without such a message this is the fallback run every 6 hours, which picks up anything a missed start left behind. Either way, choose with the skill's order, not simply the issue named: bugs first (by severity, then oldest), otherwise the oldest story. If the named issue is already locked or no longer in Ready for Dev, just run normally.
>
> Take at most one issue in Ready for Dev without the agent:working label. Never pick up anything still in Requirements ready. Fix bugs on the open PR branch of the story they block. If there is none, end the run quietly with "nothing to do". Never push to main, never change QA tests to make them pass, and never merge a PR.

**Sham QA agent**

> You are the Sham QA agent. Load the sham-qa skill with the Skill tool and follow it exactly for one run.
>
> Context: Linear team "Sham" (key ARU). Statuses: Idea, Requirements ready, Ready for Dev, In Dev, Ready for QA, Done, Needs Clarification, Canceled. Lock label: agent:working. Bug labels: Bug, bug-cause/code, bug-cause/requirements. Repo: ashimakhun/sham — attach it with push access, clone it, and check out the branch linked in the issue comments.
>
> Take at most one issue in Ready for QA without the agent:working label: bug fixes to verify first, otherwise the oldest story not blocked by an open bug. File every failure as a Bug issue in Linear, routed by cause (code → Ready for Dev, requirements → Requirements ready). If there is none, end the run quietly with "nothing to do". Only add or fix tests, never app code, and never merge a PR.

### Event trigger setup

Linear webhooks can't send a routine's bearer token, so a small relay sits in between:

```
Linear webhook (Issue events, team Sham)
  → Supabase Edge Function supabase/functions/linear-webhook  (deployed, no JWT check)
      checks the Linear signature, then routes "entered status" events:
        entered Idea          → POST <requirements routine API trigger>
        entered Ready for Dev → POST <dev routine API trigger>
```

"Entered" means the issue was created in that status or moved into it; editing an issue already there starts nothing. Each run handles one issue, so five issues entering Ready for Dev start five runs.

One-time setup:

1. **Routine API triggers.** At [claude.ai/code/routines](https://claude.ai/code/routines), open **Sham requirements agent** → **Add another trigger** → **API** → **Generate token**, and copy the URL and the token (shown once). Do the same for **Sham dev agent**.
2. **Function.** Already deployed to the Sham Supabase project at `https://qokeforjnowgqhdhmrjv.supabase.co/functions/v1/linear-webhook`. To redeploy after changing it: `npx supabase functions deploy linear-webhook --no-verify-jwt`.
3. **Linear webhook.** In Linear: Settings → API → Webhooks → New webhook. URL: the function URL above. Team: Sham. Data change events: **Issues** only. Save, then copy its **signing secret**.
4. **Secrets.** In Supabase: Edge Functions → Secrets (or `npx supabase secrets set NAME=value …`):

   | Name | Value |
   | --- | --- |
   | `LINEAR_WEBHOOK_SECRET` | the Linear webhook's signing secret |
   | `REQUIREMENTS_ROUTINE_FIRE_URL` | requirements routine API trigger URL |
   | `REQUIREMENTS_ROUTINE_FIRE_TOKEN` | requirements routine token |
   | `DEV_ROUTINE_FIRE_URL` | dev routine API trigger URL |
   | `DEV_ROUTINE_FIRE_TOKEN` | dev routine token |

   An agent whose two secrets are missing is simply skipped, so you can connect one at a time.
5. **Test:** move an issue into Ready for Dev (or create one in Idea). The function's logs (Supabase → Edge Functions → linear-webhook → Logs) show `started dev agent for ARU-…`, and a new run appears for the routine.

Notes:

- A paused routine can't be started (the log shows `start failed 400`), and a routine accepts up to 30 starts per hour (`429`). Either way the issue stays in its status and the routine's fallback schedule picks it up.
- Generating a new routine token revokes the old one; update the matching `…_FIRE_TOKEN` secret when you do.

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
