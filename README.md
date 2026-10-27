# Sham

An educational mobile app where teachers, mentors and students work together:

- **Students** send homework (text + optional photo) to their mentor.
- **Mentors** see their students' homework, leave a comment and mark it as checked.
- **Teachers** share learning materials (lessons, notes, links) with the class and see all homework.

Built with [Expo](https://expo.dev) (SDK 58, React Native, TypeScript) and Expo Router.

## Run it

```bash
npm install
npm start          # then press i (iOS Simulator), a (Android) or scan the QR code with Expo Go
npm run web        # run in the browser
```

On the first screen pick a demo user to sign in as teacher, mentor or student.
Data is stored on the device; **Profile → Reset demo data** restores the seed data.

## Checks

```bash
npm run typecheck
npx expo lint
```

## Project structure

```
src/app/                  screens (Expo Router — every file is a route)
  index.tsx               demo sign-in (pick a user)
  (tabs)/                 Homework · Materials · Profile tabs
  homework/new.tsx        student adds homework
  homework/[id].tsx       homework details; mentor marks it checked
  materials/new.tsx       teacher shares a material
  materials/[id].tsx      material details
src/components/           shared UI
src/lib/store.tsx         data + role rules (local mock store)
src/lib/seed.ts           demo users, homework, materials
supabase/migrations/      database schema + access rules for the real backend
```

## Roles and access

| Action                     | Student   | Mentor             | Teacher |
| -------------------------- | --------- | ------------------ | ------- |
| See homework               | own       | own students'      | all     |
| Add homework               | ✓         |                    |         |
| Mark homework checked      |           | own students'      |         |
| See materials              | ✓         | ✓                  | ✓       |
| Share / delete materials   |           |                    | ✓       |

## Next steps

1. Create a Supabase project and run `supabase/migrations/0001_init.sql`.
2. Replace the mock store in `src/lib/store.tsx` with Supabase calls and real sign-in.
3. Upload homework photos to the `homework` storage bucket.
4. Push notifications (new homework for mentors, feedback for students) and chat.
