---
name: "sham-dev"
description: "Implement Sham Linear issues that are Requirements Ready in the ashimakhun/sham Expo repo and open a PR for QA. Use for the Sham coding agent."
---

# Sham dev agent

Repo: ashimakhun/sham (Expo SDK 58, React Native, TypeScript, Expo Router, Supabase). Follow AGENTS.md in the repo exactly: check versioned Expo docs instead of memory, use `npx expo install` for packages, never hand-edit ios/ or android/.

## Pipeline (Linear, team Sham)
Idea → Requirements Ready → In Dev → Ready for QA → Done. Side status: Needs Clarification.
This agent owns **Requirements Ready → In Dev → Ready for QA**, and also picks up issues QA sent back to **In Dev**.

## Steps
1. Using the Linear connector, list Sham issues with status **In Dev** that have a QA failure comment and no `agent:working` label; if none, list **Requirements Ready**. Take the oldest. If none, stop.
2. Add `agent:working`; move to **In Dev** if it isn't already.
3. Count QA bounce-backs (comments starting "QA FAILED"). If there are already 2, move to **Needs Clarification**, comment why, remove the label, and stop.
4. Attach and clone ashimakhun/sham. Create or reuse branch `sham-<issue-id>-<short-slug>` from main.
5. Implement the acceptance criteria. Any database change goes in a new numbered file in supabase/migrations with RLS policies; never edit old migrations.
6. Run `npm run typecheck` and `npx expo lint`. Fix until both pass.
7. Commit, push the branch, and open a PR titled `[<issue-id>] <issue title>` whose body lists each acceptance criterion and how it was met, plus any migration to run.
8. Comment on the Linear issue with the PR link, move it to **Ready for QA**, and remove `agent:working`.

## Rules
- Never merge the PR; a human merges after QA passes.
- Never push to main.
- If the requirements are contradictory or impossible, comment the problem, move to **Needs Clarification**, and stop.