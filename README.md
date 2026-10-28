# Sham

An educational mobile app where teachers, mentors and students work together:

- **Teachers and mentors** create courses and add students and mentors to them as listeners.
- **Students** send homework (text + optional photo) for a course to their mentor.
- **Mentors** see their students' homework, leave a comment and mark it as checked.
- **Teachers** share learning materials (lessons, notes, links) with the class and see all homework.

Built with [Expo](https://expo.dev) (SDK 58, React Native, TypeScript), Expo Router and [Supabase](https://supabase.com) (auth, Postgres, storage, realtime).

## Setup

1. Copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable key.
2. In the Supabase SQL Editor run, in order, `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_realtime.sql`,
   `supabase/migrations/0003_courses.sql`, `supabase/migrations/0004_course_members.sql`,
   `supabase/migrations/0005_homework_by_course.sql`, then `supabase/migrations/0006_course_chat.sql`.
3. For development, turn off **Authentication → Email → Confirm email**.

### Upgrading an existing project to 0005 (ARU-14)

`0005_homework_by_course.sql` **permanently deletes all homework** (homework now always belongs to a course).
Run it when nobody is using the app: every open app reloads once per deleted row. Right after it, empty the
`homework` bucket once in **Storage → homework → select all → Delete**, because SQL cannot delete Storage files.
The deleted homework and photos cannot be restored.

## Run it

```bash
npm install
npm start          # then press i (iOS Simulator), a (Android) or scan the QR code with Expo Go
npm run web        # run in the browser
```

Restart `npm start` after changing `.env.local`.

## Users and roles

Everyone who creates an account in the app starts as a **student**. Promote the teacher (there is only one) and
mentors with the queries in [`supabase/manage-roles.sql`](supabase/manage-roles.sql). There is no per-student
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
  homework/new.tsx        student adds homework for a course
  homework/[id].tsx       homework details; mentor marks it checked
  courses/new.tsx         teacher or mentor creates a course
  courses/[id].tsx        course details, listeners and the course's homework
  courses/[id]/listeners.tsx  teacher or mentor adds listeners
  courses/[id]/chat.tsx   course chat (owner, listeners and the teacher)
  materials/new.tsx       teacher shares a material
  materials/[id].tsx      material details
src/components/           shared UI
src/lib/supabase.ts       Supabase client
src/lib/store.tsx         data loading, actions, live updates
supabase/migrations/      database schema + row-level security (the real access rules)
supabase/manage-roles.sql admin queries for roles and mentor assignment
```

## Roles and access

| Action                     | Student   | Mentor             | Teacher |
| -------------------------- | --------- | ------------------ | ------- |
| See homework               | own       | all                | all     |
| Add homework               | courses they're in | courses they're in |  |
| Mark homework checked      |           | any (not their own) | any    |
| See courses                | all       | all                | all     |
| Create courses             |           | ✓                  | ✓       |
| Be a course listener       | ✓         | ✓ (not own course) |         |
| See course listeners       | own courses | ✓                | ✓       |
| Add / remove listeners     |           | ✓ (any course)     | ✓       |
| Course chat (read / post)  | courses they're in | own courses + courses they're in | all |
| See materials              | ✓         | ✓                  | ✓       |
| Share / delete materials   |           |                    | ✓       |

## Development workflow

New work goes through three Claude agents (requirements → dev → QA) coordinated in Linear. Every PR is
reviewed and merged by a person. See [`docs/agent-pipeline.md`](docs/agent-pipeline.md); the agents'
instructions are in [`.claude/skills/`](.claude/skills/).

## Next steps

1. In-app screen for teachers to manage roles and mentor assignments.
2. Push notifications (new homework for mentors, feedback for students).
3. Chat between teacher, mentors and students.
