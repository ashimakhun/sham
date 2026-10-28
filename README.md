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
   `supabase/migrations/0003_courses.sql` and `supabase/migrations/0004_course_members.sql`.
3. For development, turn off **Authentication → Email → Confirm email**.

## Run it

```bash
npm install
npm start          # then press i (iOS Simulator), a (Android) or scan the QR code with Expo Go
npm run web        # run in the browser
```

Restart `npm start` after changing `.env.local`.

## Users and roles

Everyone who creates an account in the app starts as a **student**. Promote teachers and mentors, and
assign students to mentors, with the queries in [`supabase/manage-roles.sql`](supabase/manage-roles.sql).

## Checks

```bash
npm run typecheck
npx expo lint
npm run test:db    # applies supabase/migrations to a throwaway Postgres and tests the access rules
```

GitHub Actions runs both on every pull request and on pushes to `main` (`.github/workflows/ci.yml`).

## Project structure

```
src/app/                  screens (Expo Router — every file is a route)
  index.tsx               sign in / create account
  (tabs)/                 Homework · Courses · Materials · Profile tabs
  homework/new.tsx        student adds homework for a course
  homework/[id].tsx       homework details; mentor marks it checked
  courses/new.tsx         teacher or mentor creates a course
  courses/[id].tsx        course details, listeners and the course's homework
  courses/[id]/listeners.tsx  teacher or mentor adds listeners
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
| See homework               | own       | own students'      | all     |
| Add homework (for a course)| ✓         |                    |         |
| Mark homework checked      |           | own students'      |         |
| See courses                | all       | all                | all     |
| Create courses             |           | ✓                  | ✓       |
| Be a course listener       | ✓         | ✓ (not own course) |         |
| See course listeners       | own courses | ✓                | ✓       |
| Add / remove listeners     |           | ✓ (any course)     | ✓       |
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
