---
name: "sham-qa"
description: "Test Sham Linear issues that are Ready for QA against their acceptance criteria and the linked PR, then pass them to Done or send them back to dev. Use for the Sham testing agent."
---

# Sham QA agent

Repo: ashimakhun/sham (Expo SDK 58, React Native, TypeScript, Supabase). Roles: student, mentor, teacher; access rules are in README.md and supabase/migrations.

## Pipeline (Linear, team Sham)
Idea → Requirements ready → Ready for Dev → In Dev → Ready for QA → Done. Side status: Needs Clarification.
This skill owns **Ready for QA → Done**, or back to **In Dev** on failure. (The QA agent's other job, reviewing stories before coding, is the separate `sham-requirements-analysis` skill.)

## Steps
1. Using the Linear connector, list Sham issues with status **Ready for QA** and no `agent:working` label. Take the oldest. If none, stop.
2. Add `agent:working`. Read the acceptance criteria, find the PR link in the comments, and find the `TEST DESIGN` comment written during requirements analysis: use it as the test plan, adding cases only where the PR changed something it didn't foresee.
3. Clone ashimakhun/sham and check out the PR branch.
4. Review the diff against every acceptance criterion and the roles/access table. Check new migrations have RLS policies that match the access rules.
5. Run `npm ci`, then `npm run typecheck` and `npx expo lint`.
   In the cloud sandbox, npm only reaches the registry through the proxy: run `export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 npm_config_noproxy=localhost,127.0.0.1` before `npm ci`, `npm install` or `npx expo install`. A "getaddrinfo ENOTFOUND registry.npmjs.org" error means this step was skipped.
6. Write automated tests for the criteria: screen tests in `__tests__/` (jest-expo + Testing Library, reuse `__tests__/helpers/`) and access-rule tests in `supabase/tests/*.test.sql` (real Postgres, see `supabase/tests/run.sh`). Cover each role that the criteria mention, including the denied cases. Run `npm test` and `npm run test:db`.
7. Commit the tests to the same PR branch.
8. Report on the Linear issue as a checklist, one line per acceptance criterion: pass/fail with evidence.
   - All pass: comment starting "QA PASSED", move to **Done**, and note that the PR is ready for a human to merge.
   - Any fail: comment starting "QA FAILED" with steps to reproduce, expected vs actual, and move back to **In Dev**.
9. Remove `agent:working`.

## Rules
- Never change app code to make a test pass; only add or fix tests.
- Never merge the PR.
- One issue per run.