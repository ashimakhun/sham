---
name: "sham-qa"
description: "Test Sham Linear stories and bug fixes that are Ready for QA, file each failure as a Bug issue routed to the dev agent (code) or requirements analysis (requirements), and pass work to Done. Use for the Sham testing agent."
---

# Sham QA agent

Repo: ashimakhun/sham (Expo SDK 58, React Native, TypeScript, Supabase). Roles: student, mentor, teacher; access rules are in README.md and supabase/migrations.

## Pipeline (Linear, team Sham)
Idea → Requirements ready → Ready for Dev → In Dev → Ready for QA → Done. Side status: Needs Clarification.
This skill owns **Ready for QA → Done**. Every failure becomes a **Bug** issue in Linear (see "Filing bugs"). (The QA agent's other job, reviewing stories before coding, is the separate `sham-requirements-analysis` skill.)

## Bugs and their routing
A bug is a Linear issue with the label `Bug` and one `bug-cause` label:
- `bug-cause/code`: the code doesn't meet a clear acceptance criterion, crashes, regresses existing behaviour, or breaks the documented access rules. Goes to **Ready for Dev**; the dev agent fixes it.
- `bug-cause/requirements`: the criterion is ambiguous, contradictory, silent about the case, or the code does what it says but that is wrong (conflicts with the README access table, another story, or existing behaviour). Goes to **Requirements ready**; requirements analysis reviews it first.
- When unsure, use `requirements`: analysis can reroute it to dev; a guessed code fix can't be undone as easily.

Each bug `blocks` the story it was found in. The story waits in **In Dev** until all its bugs are closed. **Rule for every agent: whoever closes the last open bug of a story (Done or Canceled) moves that story to Ready for QA for a re-test.**

## Choosing the issue
1. Using the Linear connector, list Sham issues in **Ready for QA** without `agent:working`.
2. Take **bug fixes first** (label `Bug`), oldest first. Otherwise take the oldest story that isn't blocked by an open bug. If none, stop and report "nothing to do".
3. Add `agent:working`.

## A. Testing a story
1. Read the acceptance criteria, any `ANALYSIS: CRITERION CHANGE` comments (they amend the criteria), the PR link, and the `TEST DESIGN` comment from requirements analysis. Use the test design as the plan, adding cases only where the PR changed something it didn't foresee.
2. Clone ashimakhun/sham and check out the PR branch. On a re-test, first fix or remove any test named in an `ANALYSIS: NOT A BUG` comment on this story's closed bugs.
3. **Update older tests to the new requirements before checking anything.** Newer stories change behaviour that older tests still expect (for example ARU-126 replaced the "Mark canceled" button with a ✕ "Cancel meeting" icon, and an ARU-129 test kept pressing the old button).
   - Merge the latest `main` into the branch locally (`git fetch origin main && git merge origin/main`), so tests from stories merged since the PR was opened run too.
   - Run `npm ci` (with the proxy setting from step 5), then `npm test` and `npm run test:db` once. For every failing test that is **not** one of this story's own new tests, decide:
     - **The story's criteria (or an `ANALYSIS: CRITERION CHANGE`) deliberately changed that behaviour** (a renamed or replaced button, new wording, a removed action, a changed rule): rewrite the old test to the new behaviour. Keep what it was checking; change only the expectation the new requirement replaced. Never delete a test unless the feature it covers was removed by the story.
     - **Nothing in the story explains the change:** don't touch the test. It's a regression, and it gets a Bug (`bug-cause/code`, "Regression: <feature>").
     - **Unsure whether the change was intended:** don't touch the test; file a `bug-cause/requirements` Bug so analysis decides.
   - Also search the tests for old texts, button names and catalog keys the story removed or renamed (`grep -rn` in `__tests__/` and `supabase/tests/`), and update the ones that only pass by accident.
   - Commit these updates separately from the new tests, with a message that names each old test and the AC that changed it.
4. Review the diff against every acceptance criterion and the roles/access table. Check new migrations have RLS policies that match the access rules.
5. Run `npm ci`, then `npm run typecheck` and `npx expo lint`.
   In the cloud sandbox, npm only reaches the registry through the proxy: run `export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 npm_config_noproxy=localhost,127.0.0.1` before `npm ci`, `npm install` or `npx expo install`. A "getaddrinfo ENOTFOUND registry.npmjs.org" error means this step was skipped.
6. Write automated tests for the criteria: screen tests in `__tests__/` (jest-expo + Testing Library, reuse `__tests__/helpers/`) and access-rule tests in `supabase/tests/*.test.sql` (real Postgres, see `supabase/tests/run.sh`). Cover each role that the criteria mention, including the denied cases. Run `npm test` and `npm run test:db`.
7. Commit the tests to the PR branch, including the ones that fail: a failing test is the bug's reproduction, and the dev agent fixes the code until it passes.
8. Report on the story as a checklist, one line per acceptance criterion: pass/fail with evidence. Add a short **Tests updated for new requirements** list (`file › test: old expectation → new, AC n`), or "none".
   - **All pass:** comment starting `QA PASSED`, move the story to **Done**, and note that the PR is ready for a person to merge.
   - **Any failure:** file one Bug per distinct problem (below), then comment starting `QA FAILED` that lists the bugs (`ARU-x: one line`) and move the story to **In Dev**.
   - **Third failing round** (the story already has 2 `QA FAILED` comments): still file the bugs, but put the bugs and the story in **Needs Clarification** and say a person should look at why it keeps failing.

## B. Verifying a bug fix
1. Read the bug, its comments (the dev agent's fix comment names the branch and commit) and, for a requirements bug, the `ANALYSIS: CRITERION CHANGE` comment.
2. Check out that branch and merge the latest `main` locally. Update older tests that the bug's agreed behaviour (the bug itself or its `ANALYSIS: CRITERION CHANGE`) deliberately changed, using the rules in A step 3. Then run the bug's reproduction test and the full checks: typecheck, lint, `npm test`, `npm run test:db`.
3. **Fixed and nothing else broke:** comment starting `BUG VERIFIED` with the evidence and move the bug to **Done**. If it was the story's last open bug, move the story to **Ready for QA** with a comment `All bugs fixed (ARU-x, …), ready for re-test`.
4. **Still failing:** comment starting `BUG REOPENED` with what still fails (expected vs actual, test output) and move it back to **Ready for Dev** (or to **Requirements ready** with `bug-cause/requirements`, if it now looks like a criteria problem). If the bug already has 2 `BUG REOPENED` comments, move it to **Needs Clarification** instead.
5. **Fixed, but the fix broke something else:** verify this bug as in step 3 and file the new problem as its own Bug.

## Filing bugs
Before filing, list the open bugs that block this story (or, for a bug found outside any story, open bugs with a similar title). If one already describes the same problem, add a comment with the new evidence instead of a duplicate.

Create the issue in team Sham:
- **Title:** `Bug: <what is wrong, in user terms>` (for example `Bug: mentor can mark their own homework as checked`).
- **Labels:** `Bug` and `bug-cause/code` or `bug-cause/requirements`. Copy the story's difficulty label only if the fix is obviously that size; otherwise leave it unrated.
- **Status:** code → **Ready for Dev**; requirements → **Requirements ready**; third round → **Needs Clarification**.
- **Relations:** the bug `blocks` the story; for a regression in another feature, also `related` to that feature's story if there is one.
- **Project:** the story's project.
- **Description:**

  ```
  ## Found in
  ARU-<story> · PR <link> · branch <branch> · commit <short sha>

  ## Acceptance criterion
  AC <n>: <criterion text, copied>   (or: "Not covered by any criterion" / "Regression: <feature>")

  ## Steps to reproduce
  1. Role: <student|mentor|teacher>, data: <what exists>
  2. …

  ## Expected
  ## Actual

  ## Evidence
  Test: <file> › <test name> (committed on the branch). Output:
  <the relevant lines>

  ## Severity
  blocker (can't use the feature, or an access rule is broken) | major (wrong result, workaround exists) | minor (cosmetic, wording)

  ## Cause: code | requirements
  <one or two sentences on why>
  ```

## Rules
- Never change app code to make a test pass; only add or fix tests.
- Never change or delete a test the dev agent relies on as a reproduction unless a bug was closed as not a bug.
- Update an older test only when a newer story's criteria (or a criterion change) deliberately changed that behaviour, and list every such update in the report. A test that fails for any other reason is a bug, not a test to rewrite.
- Never merge a PR.
- One story or one bug fix per run (a story can produce several bugs).
- Finally remove `agent:working`. In the run summary list the verdict and any bugs filed or verified.
