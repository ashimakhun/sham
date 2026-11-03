# Sham

An educational mobile app where teachers, mentors and students work together:

- **Teachers and mentors** create courses and add students and mentors to them as listeners.
- **The course owner** (or the teacher) schedules meetings; after a completed meeting they add notes and assign
  homework, and listeners mark that they attended.
- **Listeners** send homework (text + optional photo) for an assignment from the **New** list on the Homework tab.
- **Mentors and the teacher** see all homework, leave a comment and mark it as checked (never their own).
- **Each course** has a chat with a new-message counter for its owner, listeners and the teacher.
- **General chat** for every accepted account, any role, opened from the Profile tab.
- **Teachers and mentors** share formatted posts (lessons, notes, links) on the Materials tab's **Blog**, filterable
  by author, which everyone can like; and PDF books in the **Knowledge base**, optionally linked to a course and
  optionally visible only to that course's participants.
- **Listeners** rate a course once it has started (1–5 stars and a review); everyone who sees the course reads it.
- **Hidden courses** are seen only by their owner, their listeners and the teacher.
- **Disciplines** (ARU-63): the teacher groups courses into disciplines; the Courses tab shows **Courses** (your courses,
  then those with no discipline) and **Disciplines** (each with the rating and reviews of its courses).
- **Accountants** (ARU-65): the teacher turns Accountant on for mentors; accountants pick the paid courses and give
  each a monthly payment period (Profile tab).
- **Payments** (ARU-66): accountants and the teacher open a paid course from the Accountant section and mark each
  listener Paid for the month, undo it, or set them Exempt; "Unpaid this month" lists who still owes during the
  payment period. An unpaid listener's course card on the Courses tab gets a red border and "Payment due by <date>".
- **New accounts** wait for the teacher's approval before they can use the app.

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
   `0023_telegram_links.sql` (ARU-48: Telegram notifications setup; adds two tables and five functions, changes
   nothing else; see [Telegram notifications](#telegram-notifications)),
   `0024_material_likes.sql` (ARU-52: likes on Blog posts; adds a table, deletes nothing; it doesn't depend on 0023),
   `0025_course_feedback.sql` (ARU-53: listeners rate a started course; adds a table, a helper and a trigger, deletes
   nothing; it doesn't depend on 0023 or 0024),
   `0026_profile_name_not_blank.sql` (ARU-55: an edited name can't be blank; adds a trigger),
   `0027_profile_name_unicode_blank.sql` (ARU-56: Unicode spaces count as blank too; replaces that trigger's function),
   `0028_meeting_homework_checked.sql` (ARU-60: mark a completed meeting's homework checked, which moves it to the
   course's MEETING HISTORY; adds two nullable columns and a function, deletes nothing; existing meetings start
   unchecked),
   `0029_general_chat.sql` (ARU-61: the general chat; adds a table with policies and puts it in realtime, deletes
   nothing; it doesn't depend on 0028),
   `0030_chat_server_time.sql` (ARU-67: the server sets every chat message's time, in the general and course chats;
   changes insert grants only),
   `0031_disciplines.sql` (ARU-63: disciplines; adds a table, a nullable `courses.discipline_id` and two functions,
   deletes nothing; existing courses get no discipline; it doesn't
   depend on 0028-0030),
   `0032_accountant.sql` (ARU-65: the teacher turns Accountant on for mentors, who pick paid courses with a monthly
   payment period; adds `profiles.is_accountant`, the `course_billing` table and `set_accountant()`, and replaces
   `set_user_role()` so a mentor who becomes a student stops being an accountant; deletes nothing),
   `0033_teacher_sets_any_course_discipline.sql` (ARU-70: the teacher sets the discipline of any course; replaces
   `set_course_discipline`, no table or data changes; it doesn't depend on 0032),
   `0034_general_chat_reads.sql` (ARU-72: new message count for the general chat; adds the `general_chat_reads` table
   with policies, a trigger and functions, deletes nothing; accounts already approved start with everything read),
   `0035_meeting_start_notifications.sql` (ARU-41: Telegram message when a meeting starts; adds
   `course_meetings.start_notified_at`, `claim_started_meetings()` and a `pg_cron` job, and replaces `update_meeting()`;
   deletes nothing. Turn on **pg_cron** and **pg_net** first, see [Telegram notifications](#telegram-notifications)),
   `0036_chat_message_notifications.sql` (ARU-44: Telegram message for new course chat messages; adds the
   `chat_message_recipients()` function and an after-insert trigger on `course_messages`, turns on `pg_net` where the
   server offers it; no table, column or policy changes, deletes nothing; needs 0023; until the Vault secrets below
   are stored the trigger does nothing; see [Telegram notifications](#telegram-notifications)),
   `0037_homework_reviewed_notifications.sql` (ARU-49: Telegram message to a homework's sender when it is checked;
   adds `homework_reviewed_recipient()` and an `after update` trigger on `homework`, turns on `pg_net` where the
   server offers it; no table, column, policy or data changes. See
   [Telegram notifications](#telegram-notifications) → Homework reviewed),
   `0038_new_homework_notifications.sql` (ARU-50: Telegram message to a course's listeners when new homework is
   assigned; adds `new_homework_recipients()` and an after-insert trigger on `homework_assignments`, turns on `pg_net`
   if the server offers it; no table, column or policy changes, deletes nothing. Works without the Vault secrets (it
   then sends nothing), see [Telegram notifications](#telegram-notifications)),
   `0039_accountant_payments.sql` (ARU-66: accountants and the teacher mark which listeners of a paid course paid each
   month or are exempt; adds the `course_payments` and `course_payment_exemptions` tables with RLS (accountants and
   the teacher, current listeners of paid courses only, hidden courses as in 0019), `can_manage_payment()` and
   `my_payment_dues(today)` (a listener's own due courses for their device-local date), and puts both tables in the
   realtime publication; changes and deletes no existing data; needs 0032).
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

### Telegram notifications

Notifications go through the Sham Telegram bot (ARU-48). Each user connects on **Profile → Telegram notifications**
and chooses which types they get. Until the steps below are done the card stays hidden and nothing else changes.

1. In Telegram, message **@BotFather**, send `/newbot` and keep the **token** it gives you secret.
2. Set the Edge Function secrets (dashboard → Edge Functions → Secrets, or the CLI). `TELEGRAM_WEBHOOK_SECRET` is
   any random string of letters, digits, `_` and `-`:
   ```bash
   npx supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<random string>
   ```
3. Deploy the bot's webhook (Telegram sends no Supabase JWT; the secret header protects it):
   ```bash
   npx supabase functions deploy telegram-webhook --no-verify-jwt
   ```
4. Point the bot at it once:
   ```bash
   curl "https://api.telegram.org/bot<token>/setWebhook" \
     -d url=https://<project-ref>.supabase.co/functions/v1/telegram-webhook \
     -d secret_token=<the same random string> -d 'allowed_updates=["message"]'
   ```
5. Put the bot's username (without `@`) in `.env.local` as `EXPO_PUBLIC_TELEGRAM_BOT_USERNAME` and restart `npm start`.

The bot only answers `/start <code>` (from the app's Connect button) and `/stop`, in private chats. Notifications
themselves are sent by `supabase/functions/_shared/telegram.ts` from the notification stories' functions.

#### Meeting started (ARU-41)

Listeners get "<course title> meeting has started" within 2 minutes of a Scheduled meeting's start, if they connected
Telegram and left **Meeting started** on. A `pg_cron` job calls the Edge Function `meeting-start-notifications` every
minute; the function claims the meetings that just started (`claim_started_meetings()`, at most once each) and sends.

1. Dashboard → **Database → Extensions**: turn on **pg_cron** and **pg_net**.
2. Run `supabase/migrations/0035_meeting_start_notifications.sql` (it stops with a message if step 1 is missing).
3. Make a random secret (`openssl rand -hex 24`) and set it as the function's secret:
   ```bash
   npx supabase secrets set MEETING_NOTIFY_SECRET=<secret>
   ```
4. Deploy the function (the cron job sends the secret in `x-cron-secret`, not a Supabase JWT):
   ```bash
   npx supabase functions deploy meeting-start-notifications --no-verify-jwt
   ```
5. Store the URL and the same secret in Vault (SQL Editor). The job reads both on every run, so neither is in
   `cron.job`:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/meeting-start-notifications', 'meeting_notify_url');
   select vault.create_secret('<secret>', 'meeting_notify_secret');
   ```
6. Check: `select * from cron.job_run_details order by start_time desc limit 5;` shows a run every minute, and
   `select status_code, content from net._http_response order by created desc limit 5;` shows `200` with
   `{"meetings":0,"sent":0,…}`. A `401` means the two secrets differ.

To change a Vault value later: `select vault.update_secret((select id from vault.secrets where name = 'meeting_notify_secret'), '<new>');`.

#### New chat messages (ARU-44)

When someone posts in a course chat, the other people in that chat (owner, listeners, every teacher; Approved only)
get "New message in the <course title> chat" if they linked Telegram and have **Chat messages** on. One message per
batch: only for the oldest message from others they haven't read yet, so after opening the chat the next post
notifies them again. An after-insert trigger on `course_messages` (migration 0036) queues one `pg_net` call to the
Edge Function `chat-message-notifications`, which asks `chat_message_recipients()` (service role only) who gets it.
Failures are logged and dropped, never retried, and never stop a message from being posted.

1. **Database → Extensions**: turn on `pg_net` (then run migration 0036 if it isn't applied yet).
2. Pick a random secret (e.g. `openssl rand -hex 32`) and set it, with the bot token from above, as function secrets:
   ```bash
   npx supabase secrets set CHAT_NOTIFY_SECRET=<random secret>
   ```
3. Deploy the function (the trigger sends the secret, not a Supabase JWT):
   ```bash
   npx supabase functions deploy chat-message-notifications --no-verify-jwt
   ```
4. In the SQL Editor, store the function's URL and the same secret in Vault:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/chat-message-notifications', 'chat_notify_url');
   select vault.create_secret('<the same random secret>', 'chat_notify_secret');
   ```
   To change one later: `select vault.update_secret((select id from vault.secrets where name = 'chat_notify_secret'), '<new>');`
   (and set `CHAT_NOTIFY_SECRET` to the same value).

Check a post: `select status_code, content from net._http_response order by created desc limit 5;` shows the
function's answer (`{"message_id": …, "recipients": n, "sent": …, "skipped": …, "failed": […]}`); the function's
log (dashboard → Edge Functions → chat-message-notifications → Logs) has one line per post.

#### Homework reviewed (ARU-49)

When a mentor or the teacher marks homework as checked (status `submitted` → `checked`), its sender gets "Your
homework for <course title> was reviewed", if they are still Approved, can still see the course, connected Telegram
and left **Homework reviewed** on. An `after update` trigger on `homework` (migration 0037) reads the URL and secret
from Vault and queues one `pg_net` POST `{"homework_id": "<id>"}` with `Authorization: Bearer <secret>` to the Edge
Function `homework-reviewed-notifications`, which asks `homework_reviewed_recipient()` (service role only) who gets
it and sends. Checking never fails because of this: with `pg_net` off, a Vault value missing or the call failing,
the trigger only logs a warning and nothing is sent. A failed send is logged and dropped, never retried.

1. Dashboard → **Database → Extensions**: make sure **pg_net** is on (the migration turns it on when it can).
2. Run `supabase/migrations/0037_homework_reviewed_notifications.sql`.
3. Make a random secret (`openssl rand -hex 24`) and set it as the function's secret (`TELEGRAM_BOT_TOKEN` is
   already set for ARU-48):
   ```bash
   npx supabase secrets set HOMEWORK_REVIEWED_NOTIFY_SECRET=<secret>
   ```
4. Deploy the function (the trigger sends the shared secret, not a Supabase JWT):
   ```bash
   npx supabase functions deploy homework-reviewed-notifications --no-verify-jwt
   ```
5. Store the URL and the same secret in Vault (SQL Editor):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/homework-reviewed-notifications', 'homework_reviewed_notify_url');
   select vault.create_secret('<secret>', 'homework_reviewed_notify_secret');
   ```
6. Check: mark a homework checked, then
   `select status_code, content from net._http_response order by created desc limit 5;` shows `200` with
   `{"recipients":1,"sent":1,…}` (`recipients` is 0 when the sender isn't Approved or can't see the course;
   `skipped` is 1 when they haven't connected Telegram or turned the switch off). A `401` means the two secrets
   differ; the function's logs (dashboard → Edge Functions → homework-reviewed-notifications → Logs) show each call.

To change a Vault value later: `select vault.update_secret((select id from vault.secrets where name = 'homework_reviewed_notify_secret'), '<new>');`.

#### New homework (ARU-50)

When the course owner or the teacher assigns homework, the course's Approved listeners (students and mentors, never
the assigner) get "New homework assigned to you in <course title>" within seconds, if they connected Telegram and left
**New homework** on. An after-insert trigger on `homework_assignments` queues one `pg_net` call to the Edge Function
`new-homework-notifications` with the assignment id; the function asks `new_homework_recipients()` for the listeners
at that moment and sends through the shared helper. If anything is missing or down, assigning still works and the
message is dropped (never resent later).

1. Dashboard → **Database → Extensions**: make sure **pg_net** is on.
2. Run `supabase/migrations/0038_new_homework_notifications.sql`.
3. Make a random secret (`openssl rand -hex 24`) and set it as the function's secret:
   ```bash
   npx supabase secrets set NEW_HOMEWORK_NOTIFY_SECRET=<secret>
   ```
4. Deploy the function (the trigger sends `Authorization: Bearer <secret>`, not a Supabase JWT):
   ```bash
   npx supabase functions deploy new-homework-notifications --no-verify-jwt
   ```
5. Store the URL and the same secret in Vault (SQL Editor). Until both exist the trigger sends nothing:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/new-homework-notifications', 'new_homework_notify_url');
   select vault.create_secret('<secret>', 'new_homework_notify_secret');
   ```
6. Check: assign homework, then `select status_code, content from net._http_response order by created desc limit 5;`
   shows `200` with `{"recipients":…,"sent":…}`. A `401` means the two secrets differ.

To change a Vault value later: `select vault.update_secret((select id from vault.secrets where name = 'new_homework_notify_secret'), '<new>');`.

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
  courses/new.tsx         teacher or mentor creates a course (visible or hidden)
  courses/[id].tsx        course details, meetings, listeners, linked Knowledge base PDFs, feedback and homework
  courses/[id]/feedback.tsx  a listener adds or edits their feedback (stars + review)
  courses/[id]/listeners.tsx  teacher or mentor adds listeners
  courses/[id]/chat.tsx   course chat (owner, listeners and the teacher)
  general-chat.tsx        general chat for every accepted account (from Profile)
  courses/[id]/owner.tsx  teacher or mentor changes the course owner
  courses/[id]/meetings/  schedule / edit a meeting; [meetingId]/notes.tsx notes; [meetingId]/assign-homework.tsx;
                          [meetingId]/attendance.tsx who attended
  roles.tsx               teacher accepts / rejects new accounts and switches users between student and mentor
  accountant/courses.tsx  an accountant selects / unselects paid courses
  accountant/[id].tsx     a paid course's listeners: Paid / Unpaid / Exempt this month (accountants and the teacher)
  materials/new.tsx       teacher or mentor shares a Blog post
  materials/[id].tsx      Blog post details and likes
  materials/files/        Knowledge base PDFs: new.tsx upload, [id].tsx details and Open PDF, [id]/edit.tsx edit
src/components/           shared UI (AccessGate.tsx: the only screen a waiting or declined account sees)
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
| See courses (database)     | all except hidden ones they're not in (title and description only unless they're in it) | all except hidden ones they don't own or attend | all |
| Courses list (Courses tab, ARU-63) | courses they're in + courses with no discipline | own and attended courses + courses with no discipline | own courses + courses with no discipline (hidden ones too); every course through a discipline card |
| See disciplines, their rating and reviews | visible ones | visible ones | ✓ (hidden ones too) |
| Create a discipline, hide / unhide it |   |                    | ✓       |
| Set / change / clear a course's discipline (ARU-70) | | own courses   | any course |
| Create courses             |           | ✓                  | ✓       |
| Create a hidden course     |           | ✓                  | ✓       |
| See a hidden course and its content | (listeners only) | owner and listeners only | ✓ (all) |
| Change course owner        |           | ✓ (any course they can reach¹) | ✓       |
| Own a course               | never     | ✓ (not if a listener) | ✓    |
| Be a course listener       | ✓         | ✓ (not own course) |         |
| See course listeners       | own courses | ✓                | ✓       |
| Add / remove listeners     |           | ✓ (any course they can reach¹) | ✓       |
| Course chat (read / post)  | courses they're in | own courses + courses they're in | all |
| General chat (read / post; no edit or delete) | ✓ | ✓ | ✓ |
| General chat new message count (`general_chat_reads`, own row only) | ✓ | ✓ | ✓ |
| See course meetings        | courses they're in | ✓ (all courses)  | ✓       |
| Schedule meetings, mark completed / canceled | | own courses    | any course |
| Edit / reschedule a scheduled meeting | | own courses           | any course |
| Read meeting notes         | courses they're in | ✓ (all courses)  | ✓       |
| Add / edit / clear notes on a completed meeting | | own courses | any course |
| Mark a completed meeting's homework checked / undo | | any course they can see, not one they're a listener of | any course |
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
| Connect Telegram and choose own notifications | ✓ (own) | ✓ (own) | ✓ (own) |
| Get a Telegram message for new course chat messages (ARU-44; linked, **Chat messages** on) | courses they're in | own courses + courses they're in | all courses |
| Get "Your homework … was reviewed" in Telegram (ARU-49) | own homework, when checked | own homework (sent as a listener), when checked | (never sends homework) |
| Get "New homework" Telegram messages (ARU-50) | courses they're in | courses they're in (not their own) |  |
| Turn Accountant on / off for a mentor (ARU-65) | |         | ✓       |
| Select / unselect paid courses |         | accountants (any course they can see) |  |
| See paid courses, change their payment period | | accountants (all they can see) | ✓ (all) |
| See / set / undo Paid marks and exemptions, see "Unpaid this month" (ARU-66) | | accountants (paid courses they can see) | ✓ (all paid courses) |
| See own payment deadline on a course card (`my_payment_dues`, ARU-66) | as a listener | as a listener |  |
| Become / stop being teacher |          |                    | (nobody) |

¹ Since ARU-63 a mentor reaches a course through the Courses list (courses they own or attend, and courses with no
discipline), the Profile tab or a Knowledge base PDF's course link. Courses in a discipline that they neither own nor
attend aren't listed; database access to them is unchanged.

## Development workflow

New work goes through three Claude agents (requirements → dev → QA) coordinated in Linear. Every PR is
reviewed and merged by a person. See [`docs/agent-pipeline.md`](docs/agent-pipeline.md); the agents'
instructions are in [`.claude/skills/`](.claude/skills/).

Two rules are enforced in the app only: a student sees only the title and description of courses they are not in
(course titles stay readable so they can be listed), and a mentor who is a listener of a course doesn't see the
others' attendance there. Also, the homework update rule doesn't check the status, so the database would let a
mentor or the teacher change homework that is already checked; the app never offers it.

## Work in progress

- **Telegram notifications** (instead of push notifications, which were canceled): linking a Sham account to the
  Sham Telegram bot (ARU-48, in QA, PR #46; it uses migration 0023), then notifications for new chat messages
  (ARU-44), checked homework (ARU-49), new homework assignments (ARU-50) and meetings starting (ARU-41). The
  product owner starts this work; the dev agent skips it until then.
- **Full formatted posts on Blog cards** (ARU-54): in development.

## Next steps

1. Private (one-to-one) chat between teacher, mentors and students; each course already has a group chat.
