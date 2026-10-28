---
name: "sham-merge-issues"
description: "Find Sham Linear ideas that describe the same or overlapping work and combine them into one issue, marking the others Duplicate. Run by the Sham requirements agent at the start of each run, before rating and choosing an issue."
---

# Combine similar Sham issues

Called by the `sham-requirements` skill as step 0 of each run. The goal: one Idea issue per piece of work, so the requirements agent never writes two overlapping stories (for example "add students to courses" and "course has listeners", or two issues that both define who owns a course).

Linear team **Sham** (key ARU). Lock label: `agent:working`. Merged issues end in status **Duplicate**.

## 1. Collect
1. List Sham issues with status **Idea**. Also list issues in **Requirements ready**, **Ready for Dev**, **In Dev**, **Ready for QA** and **Done** (titles and descriptions only) to compare against.
2. For each Idea issue fetch its comments, relations, parent and sub-issues, assignee and labels.

## 2. Find candidates
Two issues are **similar** when a single user story with one set of acceptance criteria would naturally cover both. That means at least one of:
- they describe the same user-facing outcome in different words;
- one idea is fully contained in the other;
- they define the same data or rule (for example both say who a course's owner is, or both add people to a course).

They are **not** similar just because they are in the same area. Four separate course features (create courses, meetings, chat, owner reassignment) stay separate even though they all mention courses; use blocks / related links for that, not merging.

Do **not** merge if the combined issue would be too big for one PR: if merging would raise the difficulty above the highest difficulty of the parts, or the combined story would need more than about 12 acceptance criteria, leave them separate and add a **related** link instead.

## 3. Decide per group
For each group of similar issues:

- **Both (or all) in Idea → merge automatically**, unless a guard below applies.
- **An Idea issue fully covered by an issue already in Requirements ready or later → mark the Idea a Duplicate of that issue** (same steps as a merge, but never edit the later issue's description; put what the idea adds, if anything, in a comment on the later issue for a person to decide).
- **An Idea issue that only partly overlaps a later issue → do not merge.** Add a **related** link and a comment on the Idea saying which part is already covered.

**Guards: never merge automatically, only comment a proposal, when any issue in the group:**
- has the `agent:working` label (another run is on it);
- has an assignee;
- has a comment starting `ANALYSIS:` (its story was already reviewed; merging would invalidate that review);
- has a comment written by a person (anything other than the agents' own comments: requirements summaries, merge notes, analysis reports, QA reports, PR links) — a discussion may already have shaped it;
- is a parent or sub-issue of an issue outside the group;
- has a project, cycle or due date that differs from the others.

A proposal comment goes on each issue in the group, starting with `Merge proposal:` and naming the other issues, why they overlap, and which one would be kept. Post it only once: skip the group if that comment already exists.

**Limit:** at most 3 merges per run. Leave the rest for later runs.

## 4. Merge (automatic case)
1. **Lock:** add `agent:working` to every issue in the group.
2. **Pick the keeper:** the oldest issue in the group, unless another one has more relations (blocks / blocked by / related), in which case keep that one.
3. **Keeper description:** keep its current text, and add a section at the top:

   ```
   ## Merged ideas
   This issue combines:
   - ARU-<n> — <original title>: <original description, verbatim, or "(no description)">
   - ARU-<m> — <original title>: <original description, verbatim, or "(no description)">
   ```

   Include the keeper's own original title and description in that list too. Never drop text from any issue.
4. **Keeper title:** keep it if it already covers the merged idea; otherwise rewrite it in plain words to cover both (the old titles stay in the Merged ideas list).
5. **Relations:** copy every blocks, blocked-by and related link from the duplicates onto the keeper (skip links between issues in the group). Re-parent sub-issues of a duplicate to the keeper.
6. **Labels:** copy non-agent labels from the duplicates to the keeper. For difficulty, keep the **highest** difficulty among the group (never lower one); if none is rated, leave it for the rating step.
7. **Close the duplicates:** set each duplicate as `duplicateOf` the keeper and move it to status **Duplicate**.
8. **Comments:**
   - On each duplicate: `Merged into ARU-<keeper>: <one line on why they overlap>. Its title and description were copied into ARU-<keeper> under "Merged ideas". To undo, move this issue back to Idea, clear "Duplicate of", and delete its entry from ARU-<keeper>.`
   - On the keeper: `Merged ARU-<n>, ARU-<m> into this issue: <one line on why>. Relations and labels were carried over.`
9. **Unlock:** remove `agent:working` from every issue in the group.

If any step fails part-way, stop merging that group, post a comment on the keeper listing what was done and what was not, remove `agent:working`, and continue the run.

## 5. Report
Add a "Merges" line to the run summary: each merge (kept issue ← merged issues, one line why), each proposal posted, or "none". Then return to the `sham-requirements` skill and continue with its step 1; issues closed as Duplicate are no longer candidates.

## Rules
- Never write code or change the repo.
- Never edit the description of an issue in Requirements ready or later, and never change its status.
- Never delete an issue or a comment; merging only uses the Duplicate status, so it can always be undone.
- When unsure whether two issues are similar, do not merge: add a related link at most.
