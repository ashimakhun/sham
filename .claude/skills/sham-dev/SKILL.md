---
name: "sham-dev"
description: "Fix Sham bugs and implement Sham stories that are Ready for Dev in the ashimakhun/sham Expo repo, then hand them to QA. Use for the Sham coding agent."
---

# Sham dev agent

Repo: ashimakhun/sham (Expo SDK 58, React Native, TypeScript, Expo Router, Supabase). Follow AGENTS.md in the repo exactly: check versioned Expo docs instead of memory, use `npx expo install` for packages, never hand-edit ios/ or android/.

## Pipeline (Linear, team Sham)
Idea → Requirements ready → Ready for Dev → In Dev → Ready for QA → Done. Side status: Needs Clarification.
Only reviewed work reaches **Ready for Dev**: stories that passed requirements analysis, code bugs filed by the QA agent (`Bug` + `bug-cause/code`), and requirements bugs that analysis resolved (`Bug` + `bug-cause/requirements` with an `ANALYSIS:` comment). This agent owns **Ready for Dev → In Dev → Ready for QA**.

## Choosing the issue
1. Using the Linear connector, list Sham issues in **Ready for Dev** without `agent:working`. Never pick up anything in Requirements ready: it hasn't been reviewed.
2. Take **bugs first** (label `Bug`): severity blocker → major → minor (from the bug's Severity section), then oldest. Otherwise the oldest story. If none, stop and report "nothing to do".
3. Add `agent:working` and move the issue to **In Dev**.

## Setup (both cases)
Attach and clone ashimakhun/sham. Before `npm ci`, `npm install` or `npx expo install`, run `export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 npm_config_noproxy=localhost,127.0.0.1`: in the cloud sandbox npm only reaches the registry through the proxy, and a "getaddrinfo ENOTFOUND registry.npmjs.org" error means this step was skipped.

Checks, used below: `npm ci`, then `npm run typecheck`, `npx expo lint`, `npm test` and `npm run test:db`.

## A. Fixing a bug
1. Read the bug fully: steps, expected vs actual, the evidence test, earlier `BUG REOPENED` comments, and for a requirements bug the `ANALYSIS: CRITERION CHANGE` comment (that is the agreed behaviour to build).
2. Find the story the bug `blocks` and its PR.
   - **PR still open:** check out the PR branch and fix there, so the story ships with the fix.
   - **PR merged or closed, or no story:** branch `sham-<bug-id>-fix-<short-slug>` from main; you'll open a new PR.
3. Run the bug's reproduction test and confirm it fails for the reason described. If it passes already, or you believe the test or the expected result is wrong, **don't change the test**: comment why, switch the label to `bug-cause/requirements`, move the bug to **Requirements ready**, remove `agent:working` and stop.
4. Fix the code with the smallest change that makes the expected behaviour true. Database changes go in a new numbered migration with RLS policies; never edit old migrations.
5. Run the checks. Fix until all pass, the reproduction test included.
6. Commit as `[<bug-id>] Fix: <bug title>` and push. On a new branch, open a PR titled `[<bug-id>] <bug title>` that links the bug.
7. Comment on the bug starting `FIX READY` with the branch, commit, PR link, and one or two lines on the cause and the change. Move the bug to **Ready for QA**. Leave the story where it is: QA verifies the bug, then sends the story back for re-test.

## B. Implementing a story
1. Read the `ANALYSIS: READY` comment and apply its minor notes, read any `ANALYSIS: CRITERION CHANGE` comments (they amend the criteria), and read the `TEST DESIGN` comment so the code covers the cases QA will test.
2. Create or reuse branch `sham-<issue-id>-<short-slug>` from main.
3. Implement the acceptance criteria. Any database change goes in a new numbered file in supabase/migrations with RLS policies; never edit old migrations.
4. Run the checks. Fix until all pass.
5. Commit, push the branch, and open a PR titled `[<issue-id>] <issue title>` whose body lists each acceptance criterion and how it was met, plus any migration to run.
6. Comment on the story with the PR link and move it to **Ready for QA**.

Finally remove `agent:working`.

## Rules
- Never merge a PR; a person merges after QA passes.
- Never push to main.
- Never change or delete a QA test to make it pass.
- One bug or one story per run.
- If a story's requirements are contradictory or impossible, comment the problem, move it to **Needs Clarification**, and stop.
