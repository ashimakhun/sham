---
name: "sham-requirements-analysis"
description: "Review Sham Linear stories in Requirements ready before coding: check acceptance criteria, roles and access, data impact, dependencies and size against the code, then pass them to Ready for Dev or send them back. Run by the Sham QA agent."
---

# Sham requirements analysis (QA agent)

An independent review of each story the requirements agent wrote, done by the QA agent before any code is written. The reviewer did not write the story, so it checks it with fresh eyes: can every criterion be built and tested as written?

Sham is an Expo SDK 58 (React Native, TypeScript, Expo Router) + Supabase app. Roles: student, mentor, teacher. Repo: ashimakhun/sham. The real access rules are the RLS policies in `supabase/migrations`; README.md has the summary table.

## Pipeline (Linear, team Sham, key ARU)
Idea → Requirements ready → **Ready for Dev** → In Dev → Ready for QA → Done. Side status: Needs Clarification.
This skill owns **Requirements ready → Ready for Dev**, or back to **Idea** (the requirements agent fixes it) or **Needs Clarification** (a person decides).

If the team has no **Ready for Dev** status, stop and report that it must be added in Linear first.

## 1. Choose the issue
1. Using the Linear connector, list Sham issues in **Requirements ready** without the `agent:working` label.
2. Sort: by difficulty label (easy → medium → hard, unrated last), then issues that block the most other open issues, then oldest.
3. Take the first. If none, stop and report "nothing to do".
4. Add `agent:working` before anything else.

## 2. Gather context
- The issue description, all comments (including earlier `ANALYSIS:` comments, if it came back before), labels and relations.
- Every blocking, blocked-by, related, parent and sub-issue, with its status.
- Other open stories in Requirements ready, Ready for Dev and In Dev (titles and criteria), to spot conflicts.
- The code the story touches: screens in `src/app`, data and live updates in `src/lib/store.tsx`, types in `src/lib/types.ts`, schema and RLS in `supabase/migrations`.

## 3. Analyse
Go through every point. Record each problem with the criterion number it concerns.

1. **Story fit**: every acceptance criterion serves the user story, and the story is fully covered by the criteria.
2. **Testable and unambiguous**: each criterion has a clear Given / When / Then with an observable result. Flag vague words ("fast", "easy", "properly"), missing values (limits, lengths, formats, sort order) and undefined UI states.
3. **Roles and access**: for each role (student, mentor, teacher, and a signed-out user where relevant) the story says what is allowed **and what is denied**. Compare with the existing RLS policies: is a new or changed policy needed, and does the story say so? Mentors see only their own students; check that rule still holds.
4. **Data impact**: new tables, columns, enums or storage buckets; what happens to existing rows; whether realtime (`supabase_realtime` publication) and `src/lib/store.tsx` need to change.
5. **Consistency with the app**: screens, fields and names in the story exist (or the story says they're new); no criterion contradicts current behaviour without saying so.
6. **Dependencies**: blockers are linked and their status allows starting; nothing conflicts with another open story; missing links get added (blocks / blocked-by / related) with a comment.
7. **Edge cases**: empty states, long text, invalid input, offline / failed requests, permission denied, double submit, iOS vs Android, photo upload failures, live updates arriving while a screen is open. Flag the ones that matter for this story and are missing.
8. **Size and difficulty**: fits in one PR (about 12 criteria or fewer). If not, propose a split into named sub-stories. Check the difficulty label against the scale in `sham-requirements`; a label a person set is never changed, just comment if it looks wrong.
9. **Out of scope**: things a developer might reasonably assume are included are listed as out of scope.

Classify each problem:
- **Blocker**: the dev agent would have to guess (ambiguous or contradictory criterion, missing access rule, undefined data change, an oversized story).
- **Minor**: an improvement the developer can handle without guessing (wording, an extra edge case with an obvious answer).
- **Needs a person**: a product decision the requirements agent can't make from the idea (which role may do X, a business rule, a priority call).

## 4. Decide and report
Never edit the issue description: requirements stay owned by the requirements agent. Everything goes in comments.

Count earlier comments on this issue that start with `ANALYSIS: CHANGES NEEDED`.

**A. No blockers and nothing needs a person → Ready for Dev**
1. Post a comment starting `ANALYSIS: READY`, with a one-line verdict and any minor notes as a short list (the dev agent applies them).
2. Post a second comment starting `TEST DESIGN` for the QA agent to reuse later:
   - per acceptance criterion: the scenarios to test, positive and negative, and which roles each covers;
   - access checks per role, including the denied cases;
   - data checks (migration applies, RLS enforced, existing data unaffected);
   - regression areas: existing features this change could break.
3. Move the issue to **Ready for Dev**.

**B. Blockers the requirements agent can fix from the idea and the code → back to Idea**
(Only if there are fewer than 2 earlier `ANALYSIS: CHANGES NEEDED` comments; otherwise use C.)
1. Post a comment starting `ANALYSIS: CHANGES NEEDED`, with a numbered list: criterion number, the problem, and a concrete suggestion. Add minor notes separately at the end.
2. Move the issue to **Idea**. The requirements agent will revise it and send it back.

**C. Anything needs a person, or this would be the 3rd round → Needs Clarification**
1. Post a comment starting `ANALYSIS: NEEDS A DECISION`, with specific questions (offer options where possible) and the blockers found so far.
2. Move the issue to **Needs Clarification**.

Finally remove `agent:working`. In the run summary, give the issue, the verdict, and the blocker count.

## Rules
- Never write code, tests or change the repo in this skill.
- Never edit an issue description, title or difficulty label set by a person.
- One issue per run.
- Judge against the code as it is on `main`, not against stories that aren't built yet (but do flag conflicts with them).
