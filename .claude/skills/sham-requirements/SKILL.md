---
name: "sham-requirements"
description: "Turn Sham ideas in Linear into user stories with acceptance criteria, then hand them to the dev agent. Use for Linear issues in the Sham team with status Idea."
---

# Sham requirements agent

Sham is an Expo (React Native, TypeScript) + Supabase mobile app where students submit homework, mentors review it, and teachers share materials. Repo: ashimakhun/sham. Read README.md for roles and the access table before writing anything.

## Pipeline (Linear, team Sham, key ARU)
Idea → Requirements ready → Ready for Dev → In Dev → Ready for QA → Done. Side status: Needs Clarification.
This agent owns **Idea → Requirements ready**. The QA agent then reviews each story (`sham-requirements-analysis`) and either moves it to Ready for Dev or sends it back to Idea with an `ANALYSIS: CHANGES NEEDED` comment for you to fix.

## Current priority policy
**Difficulty order: easy → medium → hard** (easiest first). To change the policy later, edit only this line.

## Difficulty scale
Rate every Idea issue that has no difficulty label yet, using the code in the repo:
- **easy**: UI or copy change within one or two existing screens; no database, RLS or new package.
- **medium**: touches several screens or src/lib/store.tsx, or adds a column/table with RLS in a new migration; no native modules.
- **hard**: new native module or Expo config plugin (for example push notifications), new realtime feature (for example chat), new roles or access model changes, or anything needing a development build or external service.
Apply it as the label difficulty/easy, difficulty/medium or difficulty/hard. A difficulty label a human set is an override: never change it.

## Combining similar issues (step 0)
Before choosing, load the `sham-merge-issues` skill with the Skill tool and follow it. It merges Idea issues that describe the same or overlapping work into one and marks the rest Duplicate (at most 3 merges per run; merges don't count as the run's one requirements issue). Then continue below; Duplicate issues are no longer candidates.

## Choosing the issue for this run
1. Using the Linear connector, list Sham issues with status **Idea**. Skip any with the `agent:working` label.
2. Rate every unrated Idea issue (difficulty label only; do not rewrite them yet). This keeps the whole backlog sorted for you and for later runs.
3. Fetch each candidate's relations (blocks / blocked by, related, parent / sub-issues).
4. Drop a candidate if it is **blocked by** an issue that is still in Idea or Needs Clarification. Its blocker's requirements must be written first. (A blocker already in Requirements ready or later is fine.)
5. Sort what remains:
   a. **revisions first**: issues the analysis sent back (the latest agent comment starts with `ANALYSIS: CHANGES NEEDED`), oldest first;
   b. then by difficulty, following the priority policy above;
   c. then issues that **block** other open issues first, the more they unblock the higher;
   d. then issues that are sub-issues of, or related to, an issue already in Requirements ready or later (keeps one area moving together);
   e. then oldest first.
6. Take the first one. If none is left, stop and report "nothing to do".
7. In the run summary, list the merges made (from step 0), then the top 3 candidates in order with one line each on why, so the choice is visible.

## Writing the requirements
1. Add the label `agent:working` before doing anything else.
2. Read the issue, its comments, and its related and blocking issues. Read the relevant code (screens in src/app, data in src/lib/store.tsx, access rules in supabase/migrations) so the requirements match what exists.
   **If this is a revision** (latest agent comment starts with `ANALYSIS: CHANGES NEEDED`): keep the existing story and fix every numbered point in that comment, plus its minor notes where they make sense. Don't start from scratch. In step 7's comment, answer each point by number (fixed how, or why not).
3. Rewrite the issue description in this structure:
   - **User story**: As a <student|mentor|teacher>, I want …, so that …
   - **Acceptance criteria**: numbered, each one testable (Given / When / Then).
   - **Roles and access**: which roles can and cannot do this; note any Supabase RLS change needed.
   - **Dependencies**: blocking and related issues and what this one relies on from them.
   - **Edge cases**: empty states, offline, permission denied, iOS and Android differences.
   - **Out of scope**.
4. If writing it reveals a dependency on another issue that isn't linked, add the blocks / blocked-by relation in Linear and mention it in a comment.
5. If writing it shows the difficulty rating was wrong, update the label (unless a human set it) and say so in the comment.
6. If the idea is too vague to write testable criteria, post a comment with specific questions, move it to **Needs Clarification**, remove `agent:working`, and stop.
7. Otherwise post a short comment summarising the criteria and the difficulty, move the issue to **Requirements ready**, and remove `agent:working`.

## Rules
- Never write code or change the repo.
- Write requirements for one issue per run (rating and merging others per `sham-merge-issues` is fine).
- Do not invent features beyond the idea; put extras under Out of scope.