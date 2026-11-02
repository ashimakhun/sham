# Sham

An educational mobile app where teachers, mentors and students work together:

- **Teachers and mentors** create courses and add students and mentors to them as listeners.
- **The course owner** (or the teacher) schedules meetings; after a completed meeting they add notes and assign
  homework, and listeners mark that they attended.
- **Listeners** send homework (text + optional photo) for an assignment from the **New** list on the Homework tab.
- **Mentors and the teacher** see all homework, leave a comment and mark it as checked (never their own).
- **Each course** has a chat with a new-message counter for its owner, listeners and the teacher.
- **Teachers and mentors** share formatted posts (lessons, notes, links) with everyone on the Materials tab's
  **Blog**, filterable by author; a **Knowledge base** tab for PDF books is coming.

How each feature behaves today is described in the Linear project document **Sham: product documentation**.

Built with [Expo](https://expo.dev) (SDK 58, React Native, TypeScript), Expo Router and [Supabase](https://supabase.com) (auth, Postgres, storage, realtime).

## Setup

1. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable key.
2. In the Supabase SQL Editor run every file in `supabase/migrations`, in order:
   `0001_init.sql`, `0002_realtime.sql`, `0003_courses.sql`, `0004_course_members.sql`,
   `0005_homework_by_course.sql`, `0006_course_chat.sql`, `0007_course_owner.sql`,
   `0008_listener_functions_check_membership.sql` (ARU-16: listener functions act only on actual listeners),
   `0009_roles_screen.sql`,
   `0010_course_meetings.sql` (ARU-10: course meetings; adds a table, deletes nothing),
   `0011_edit_meetings.sql` (ARU-15: editing meetings; adds a column and a function),
   `0012_meeting_notes.sql` (ARU-28: meeting notes; adds three columns, a trigger and a function),
   `0013_mentor_materials.sql` (ARU-26: mentors share and delete their own materials; replaces two policies),
   `0014_homework_assignments.sql` (ARU-32: adds a table, a column, an index and a trigger; replaces the homework
   insert rule, so homework is only sent for an assignment; deletes nothing),
   `0015_assign_homework_anon_error.sql` (ARU-36: signed-out callers get the permission error when assigning homework),
   `0016_chat_read_positions.sql` (ARU-31: new message counts; adds a table and functions and sets everyone already in
   a chat to "read up to now"),
   `0017_meeting_attendance.sql` (ARU-33: listeners mark attendance of completed meetings; adds a table and two
   functions, deletes nothing),
   `0018_material_files.sql` (ARU-30: Knowledge base PDFs; adds a table, a trigger, the private `materials` storage
   bucket (PDF only, 25 MB) and its policies, deletes nothing),
   `0019_hidden_courses.sql` (ARU-40: hidden courses; adds a column (existing courses stay visible), three helper
   functions and restrictive policies, and updates the course functions to check visibility; deletes nothing),
   `0020_course_only_material_files.sql` (ARU-42: course-only Knowledge base PDFs; adds a column (existing items stay
   visible to everyone) and a function, replaces the two read policies, deletes nothing),
   `0021_account_approval.sql` (ARU-43: new accounts wait for the teacher's approval; adds an access status (every
   existing account is approved), two functions and a trigger, and adds the approval check to the helper functions
   and open read policies; deletes nothing),
   `0022_attendance_from_start.sql` (ARU-45: attendance can be marked once a meeting has started, not only when it is
   completed, and never on a canceled meeting; replaces two functions, deletes nothing),
   `0024_material_likes.sql` (ARU-52: likes on Blog posts; adds a table, deletes nothing; 0023 is reserved for the
   open Telegram branch, ARU-48, and 0024 doesn't depend on it),
   `0025_course_feedback.sql` (ARU-53: listeners rate a started course; adds a table, a helper and a trigger, deletes
   nothing; it doesn't depend on 0023 or 0024).
   Each migration has its own number; `npm run test:db` fails if two files share one.
3. For development, turn off **Authentication → Email → Confirm email**.

### Upgrading an existing project to 0005 (ARU-14)

`0005_homework_by_course.sql` **permanently deletes all homework** (homework now always belongs to a course).
Run it when nobody is using the app: every open app reloads once per deleted row. Right after it, empty the
`homework` bucket once in **Storage → homework → select all → Delete**, because SQL cannot delete Storage files.
The deleted homework and photos cannot be restored.

### Upgrading an existing project to 0009 (ARU-13)

There can be only one teacher. If your database already has two or more, `0009_roles_screen.sql` stops with
"More than one teacher exists: …; make all but one a mentor first". Run
`update profiles set role = 'mentor' where id = (select id from auth.users where email = '…');` for each extra
teacher in the SQL Editor, then run the migration again.

## Run it

```bash
npm install
npm start          # then press i (iOS Simulator), a (Android) or scan the QR code with Expo Go
npm run web        # run in the browser
```

Restart `npm start` after changing `.env.local`.

## Users and roles

Everyone who creates an account in the app starts as a **student** whose request to join **waits for the teacher**:
until the teacher accepts it (**Profile → Manage roles → Requests**), the account sees only a "Waiting for approval"
screen and the database returns nothing but its own profile. A declined account sees "Request declined"; the teacher
can still accept it later from the Declined section. Make the first teacher once with the query in
[`supabase/manage-roles.sql`](supabase/manage-roles.sql); there is exactly one teacher, and after that the database
rejects any change to or from teacher. The teacher then switches users between student and mentor in the app
(**Profile → Manage roles**). A mentor who owns courses can't be made a student until their courses are given a
new owner. A user sees their new role after pull-to-refresh or reopening the app. There is no per-student
mentor: adding someone to a course as a listener makes the course owner their mentor for that course.

## Checks

```bash
npm run typecheck
npx expo lint
npm test           # screen tests (jest-expo)
npm run test:db    # applies supabase/migrations to a throwaway Postgres and tests the access rules
```

GitHub Actions runs both on every pull request and on pushes to `main` (`.github/workflows/ci.yml`).

## Project structure

```
src/app/                  screens (Expo Router — every file is a route)
  index.tsx               sign in / create account
  (tabs)/                 Homework · Courses (My courses / All courses) · Materials · Profile tabs
  homework/new.tsx        a listener sends homework for an assignment (opened from New)
  homework/[id].tsx       homework details; mentor marks it checked
  courses/new.tsx         teacher or mentor creates a course
  courses/[id].tsx        course details, listeners, linked Knowledge base PDFs and the course's homework
  courses/[id]/listeners.tsx  teacher or mentor adds listeners
  courses/[id]/chat.tsx   course chat (owner, listeners and the teacher)
  courses/[id]/owner.tsx  teacher or mentor changes the course owner
  courses/[id]/meetings/  schedule / edit a meeting; [meetingId]/notes.tsx notes; [meetingId]/assign-homework.tsx;
                          [meetingId]/attendance.tsx who attended
  roles.tsx               teacher switches users between student and mentor
  materials/new.tsx       teacher or mentor shares a material
  materials/[id].tsx      material details
  materials/files/        Knowledge base PDFs: new.tsx upload, [id].tsx details and Open PDF, [id]/edit.tsx edit
src/components/           shared UI
src/lib/supabase.ts       Supabase client
src/lib/store.tsx         data loading, actions, live updates
supabase/migrations/      database schema + row-level security (the real access rules)
supabase/manage-roles.sql admin queries: list users, make the first teacher
```

## Roles and access

| Action                     | Student   | Mentor             | Teacher |
| -------------------------- | --------- | ------------------ | ------- |
| See homework               | own       | all                | all     |
| See homework assignments   | courses they're in | ✓ (all courses) | ✓    |
| Assign homework to a completed meeting | | own courses        | any course |
| Send homework (for an assignment) | courses they're in | courses they're in |  |
| Mark homework checked      |           | any (not their own) | any (not their own) |
| See courses                | all (title and description only unless they're in it) | all | all |
| Create courses             |           | ✓                  | ✓       |
| Create a hidden course     |           | ✓                  | ✓       |
| See a hidden course and its content | (listeners only) | owner and listeners only | ✓ (all) |
| Change course owner        |           | ✓ (any course)     | ✓       |
| Own a course               | never     | ✓ (not if a listener) | ✓    |
| Be a course listener       | ✓         | ✓ (not own course) |         |
| See course listeners       | own courses | ✓                | ✓       |
| Add / remove listeners     |           | ✓ (any course)     | ✓       |
| Course chat (read / post)  | courses they're in | own courses + courses they're in | all |
| See course meetings        | courses they're in | ✓ (all courses)  | ✓       |
| Schedule meetings, mark completed / canceled | | own courses    | any course |
| Edit / reschedule a scheduled meeting | | own courses           | any course |
| Read meeting notes         | courses they're in | ✓ (all courses)  | ✓       |
| Add / edit / clear notes on a completed meeting | | own courses | any course |
| Mark / undo own attendance of a started meeting | courses they're in | courses they're in |  |
| See who attended a meeting | own marks only | ✓ (own courses and courses they don't listen to; own marks only where a listener) | ✓ |
| See materials              | ✓         | ✓                  | ✓       |
| Share / delete materials   |           | ✓ (own materials)  | ✓ (own) |
| Like Blog posts, see who liked them | ✓ | ✓                | ✓       |
| Add / edit / delete own course feedback | if a listener and the course started | if a listener and the course started | |
| Read course feedback and average | courses they can see (hidden: only if in it) | same | ✓ (all) |
| See Knowledge base, open PDFs | ✓      | ✓                  | ✓       |
| Upload PDFs (25 MB at most) |          | ✓                  | ✓       |
| Edit name / description / course, delete PDFs | | ✓ (own)   | ✓ (own) |
| Make a course-linked PDF course-only | | ✓ (own)       | ✓ (own) |
| See a course-only Knowledge base PDF | if in its course | if in its course, or its author | ✓ |
| Switch student ↔ mentor    |           |                    | ✓       |
| Accept or reject new accounts |        |                    | ✓       |
| Become / stop being teacher |          |                    | (nobody) |

## Development workflow

New work goes through three Claude agents (requirements → dev → QA) coordinated in Linear. Every PR is
reviewed and merged by a person. See [`docs/agent-pipeline.md`](docs/agent-pipeline.md); the agents'
instructions are in [`.claude/skills/`](.claude/skills/).

Two rules are enforced in the app only: a student sees only the title and description of courses they are not in
(course titles stay readable so they can be listed), and a mentor who is a listener of a course doesn't see the
others' attendance there. Also, the homework update rule doesn't check the status, so the database would let a
mentor or the teacher change homework that is already checked; the app never offers it.

## Work in progress

- **Knowledge base of PDF files, each optionally linked to a course** (ARU-30): ready for development. The
  Knowledge base tab shows a placeholder until then.
- **Linked PDFs on the course screen** (ARU-39): after ARU-30.

## Next steps

1. Push notifications (new homework for mentors, feedback for students, new chat messages).
2. Private (one-to-one) chat between teacher, mentors and students; each course already has a group chat.
