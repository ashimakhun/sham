# Sham

An educational mobile app where teachers, mentors and students work together:

- **Teachers and mentors** create courses and add students and mentors to them as listeners.
- **The course owner** (or the teacher) schedules meetings; after a completed meeting they add notes and assign
  homework, and listeners mark that they attended.
- **Listeners** send homework (text + optional photo) for an assignment from the **New** list on the Homework tab.
- **Mentors and the teacher** see all homework, leave a comment and mark it as checked (never their own).
- **All homework lives on the Homework tab** (ARU-80; course details no longer lists it); its **Checked** list has a
  course filter.
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
- **Payment requests** (ARU-99): during the payment period an unpaid listener taps **Pay** on course details and sends
  a proof (a photo or a PDF, up to 10 MB); **Send again** replaces it. In the Accountant section each paid course is
  a row with ">" and a count of waiting requests; its payments page has the period, Change period, Unselect and,
  under each listener, their request with View proof.
- **New accounts** wait for the teacher's approval before they can use the app.
- **Delete account** (ARU-75): students and mentors (and waiting or declined accounts) delete their own account after
  re-entering their password. Personal data is removed; chat messages and work done for others stay, shown as
  **Deleted account**. A mentor who owns courses must hand them over first; the teacher can't delete their account.
- **Change password** (ARU-76): any approved user changes their own password from the Profile tab, with the current
  password checked first.
- **Forgot password?** (ARU-77): on the sign-in screen, anyone resets their password with a code sent by email (needs
  the [Password reset email](#password-reset-email) setup).

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
   realtime publication; changes and deletes no existing data; needs 0032),
   `0040_delete_account.sql` (ARU-75: deleting your own account; makes the non-cascading references to `profiles`
   nullable with `on delete set null` (chat authors, homework checker, listener adder, meeting creator / status /
   notes editor, assignment creator, paid-course selector, discipline creator, `profiles.mentor_id`) and, if 0039 is
   applied, cascades ARU-66's payment marks / exemptions of a listener and nulls their marker; adds a before-delete
   trigger on `profiles` that refuses the teacher and course owners, the service-role-only functions
   `account_deletion_problem()` and `account_storage_objects()`, and null-safe comparisons in the unread counters and
   the chat / new-homework notification recipient functions. Existing rows don't change; `courses.created_by` still
   blocks. Then deploy the `delete-account` Edge Function, see [Delete account](#delete-account-aru-75)).
   `0041_delete_course.sql` (ARU-85: the teacher deletes a course with everything in it; adds
   `course_homework_photos(course)` (the course's homework photos still in Storage, teacher only) and
   `delete_course(course)` (the course's homework, then the course, in one transaction; its other rows cascade and
   Knowledge base PDFs keep "No course"), plus Storage policies that let the teacher read and delete every photo in
   the `homework` bucket; changes and deletes no existing data. The app removes the photos through the Storage API
   before calling `delete_course`, so no Edge Function or extra setup is needed),
   `0042_delete_discipline.sql` (ARU-83: the teacher deletes a discipline with every course in it; adds
   `discipline_homework_photos(discipline)` and `delete_discipline(discipline)`, which calls 0041's `delete_course()`
   for each course (hidden ones too) and then deletes the discipline, in one transaction; teacher only; changes no
   existing data; needs 0041),
   `0043_teacher_deletes_any_material_file.sql` (ARU-86: the teacher deletes any Knowledge base PDF, row and file in
   the `materials` bucket; adds two delete policies, keeps the authors' own; changes no data).
   `0044_new_account_notifications.sql` (ARU-84: Telegram message to the teacher when a new account waits for
   approval; adds `telegram_links.notify_new_account` (default true, existing links get true), the kind `new_account`
   in `set_telegram_notification()`, `new_account_notification()` and an after-insert trigger on `profiles` (pending
   sign-ups only), turns on `pg_net` if the server offers it; no policy changes, deletes nothing. Sign-up never fails
   because of it; see [Telegram notifications](#telegram-notifications) → New accounts),
   `0045_homework_submitted_notifications.sql` (ARU-89: Telegram message to a course's owner when a listener submits
   homework; adds `telegram_links.notify_homework_submitted` (default true), the kind `homework_submitted` in
   `set_telegram_notification()` (keeps 0044's kinds), `homework_submitted_recipient()` and an after-insert trigger
   on `homework`, turns on `pg_net` if the server offers it; no policy changes, deletes nothing; needs 0044. Works
   without the Vault secrets (it then sends nothing), see [Telegram notifications](#telegram-notifications) →
   Homework submitted),
   `0046_every_chat_message_notifications.sql` (ARU-87: a Telegram message for every chat message; replaces
   `chat_message_recipients()` without the read-position rules (one message per post, not per batch), adds
   `telegram_links.notify_general_chat` (default true), the kind `general_chat` in `set_telegram_notification()`
   (keeps 0044/0045's kinds), `general_message_recipients()` and an after-insert trigger on `general_messages` that
   calls the same `chat-message-notifications` function with the same Vault secrets; no policy changes, deletes
   nothing; needs 0036 and 0045. Redeploy `chat-message-notifications` after it, see
   [Telegram notifications](#telegram-notifications) → New chat messages),
   `0047_payment_requests.sql` (ARU-99: a listener of a paid course sends one proof of payment per course and month;
   adds the table `course_payment_requests` (in realtime), the private bucket `payment-proofs` (photos and PDFs, 10 MB)
   with its policies (own folder; accountants and the teacher read current listeners' proofs; the teacher reads and
   deletes every proof), `course_payment_proofs()` / `discipline_payment_proofs()` for course and discipline deletion,
   and replaces `account_storage_objects()` to include the new bucket; deletes nothing; needs 0039, 0040 and 0042),
   `0048_new_material_notifications.sql` (ARU-102: Telegram message when a new Blog post or Knowledge base PDF is
   shared; adds `telegram_links.notify_new_material` (default true), the kind `new_material` in
   `set_telegram_notification()` (keeps 0044/0045/0046's kinds), `new_material_recipients()` and after-insert
   triggers on `materials` and `material_files`, turns on `pg_net` if the server offers it; no policy changes,
   deletes nothing; needs 0046. Works without the Vault secrets (it then sends nothing), see
   [Telegram notifications](#telegram-notifications) → New materials),
   `0049_homework_photo_limits.sql` (ARU-105: the `homework` bucket accepts only JPEG files up to 10 MB (the app
   resizes and compresses photos when they're picked); adds `homework_photo_in_use()` and two storage policies that
   let a sender read and delete their own photo in their own folder while no homework row points to it, so a failed
   send leaves no photo behind; existing files and policies are unchanged, deletes nothing),
   `0050_homework_photo_rule.sql` (ARU-107: the 6-month rule for homework photos, without deleting anything yet;
   a trigger makes `homework.checked_at` server-set (set when checked, cleared when unchecked, any client value
   overwritten; checked homework without one gets the migration's time), adds the one-row `app_settings` table
   (`photo_deletion_start`, null until ARU-112's daily job runs), `photo_deletion_date()`, the `photo_zip_links` table
   and the service-role functions `homework_photos_for_zip()` and `claim_photo_zip_link()` for **Download my photos**;
   deletes nothing. Then deploy the `homework-photos-zip` Edge Function, see
   [Download my photos](#download-my-photos-aru-107)),
   `0051_profile_language.sql` (ARU-108: Russian version, part 1; adds `profiles.language` ('en', 'ru' or null =
   follow the phone; existing accounts get null) and puts it in the profile update grant next to `full_name`, so users
   change only their own; no other policy changes, deletes nothing).
   Each migration has its own number; `npm run test:db` fails if two files share one.
3. For development, turn off **Authentication → Email → Confirm email**.
4. For **Forgot password?** (ARU-77), put `{{ .Token }}` in the **Reset Password** email template, see
   [Password reset email](#password-reset-email). On the default email sender only the project's team members get
   the email; real users need custom SMTP.

### Password reset email

**Forgot password?** on the sign-in screen (ARU-77) emails the user a one-time **code** (no link, so no deep links
are needed and it works the same in Expo Go, dev builds, iOS and Android). The user types it into the app with a new
password. Nothing is in the database; it's all Supabase Auth settings in the dashboard:

1. **Custom SMTP (required before real users can reset).** Supabase's default sender only delivers to the project's
   team members and is heavily rate-limited. Set up a provider (for example Resend, Postmark or SendGrid) under
   **Authentication → Emails → SMTP Settings** (enable custom SMTP, fill host, port, user, password and the sender
   address/name). Development can be tested with a team member's address on the default sender.
2. **Reset Password template.** Under **Authentication → Emails → Templates → Reset Password**, replace the body so
   it shows the code (`{{ .Token }}`) instead of the link. Sample:

   Subject: `Your Sham password reset code`

   ```html
   <h2>Reset your Sham password</h2>
   <p>Enter this code in the Sham app to choose a new password:</p>
   <p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>The code works once and expires in 1 hour. If you didn't ask to reset your password, ignore this email.</p>
   ```
3. **Optional.** **Authentication → Providers → Email**: *Email OTP Length* (6 by default; the app accepts 6–10 digits)
   and *Email OTP Expiration* (3600 s by default). **Authentication → Rate Limits** sets how many emails can be sent
   per hour. The app also waits 60 seconds between "Send a new code" taps.

No redirect URL is needed (`resetPasswordForEmail` is called without `redirectTo`).

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

#### New chat messages (ARU-44, ARU-87)

When someone posts in a course chat, the other people in that chat (owner, listeners, every teacher; Approved only)
get "New message in the <course title> chat" if they linked Telegram and have **Chat messages** on. Since ARU-87
(migration 0046) this is **one message per post**, whether or not they have opened the chat since the last one (the
ARU-44 "one per batch of unread messages" rule is gone). An after-insert trigger on `course_messages` (migration 0036)
queues one `pg_net` call to the Edge Function `chat-message-notifications`, which asks `chat_message_recipients()`
(service role only) who gets it.

The general chat (ARU-87) works the same way with its own switch, **General chat**: every Approved user except the
author gets "New message in the general chat" for each post (no text, no author). An after-insert trigger on
`general_messages` (migration 0046) calls the same function with `{"general_message_id": "<id>"}` and the same Vault
secrets, and the function asks `general_message_recipients()`. So after migration 0046 only step 3 below (redeploy)
is needed; no new secret.

Failures are logged and dropped, never retried, and never stop a message from being posted. There is no throttling by
design: a busy chat sends one Telegram message per post. The shared helper sends at most 25 messages a second within
a 50-second budget, so about 1,250 recipients per post; any beyond that are logged as failed and dropped. The trigger's
`pg_net` timeout is 30 s, so for a very large general chat `net._http_response` may show a timeout while the function
is still sending.

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
function's answer (`{"message_id": …, "recipients": n, "sent": …, "skipped": …, "failed": […]}`, or
`{"general_message_id": …, …}` for the general chat); the function's log (dashboard → Edge Functions →
chat-message-notifications → Logs) has one line per post.

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

#### New accounts (ARU-84)

When someone creates an account (a new profile waiting for approval), the teacher gets "New account waiting for your
approval: <name>. Open Sham → Manage roles to accept or decline." within seconds, if they connected Telegram and left
**New accounts** on (a switch only the teacher sees). An after-insert trigger on `profiles` (only rows inserted as
`pending`) queues one `pg_net` POST `{"user_id": "<id>"}` with `Authorization: Bearer <secret>` to the Edge Function
`new-account-notifications`, which asks `new_account_notification()` (service role only) whether the account is still
waiting and who the teacher is, then sends. Accepting, declining, role or name changes send nothing; an account
accepted, declined or deleted before the call is processed sends nothing. Sign-up never fails because of this (the
trigger runs inside the Auth sign-up and only logs a warning); a failed send is dropped, never retried.

1. Dashboard → **Database → Extensions**: make sure **pg_net** is on.
2. Run `supabase/migrations/0044_new_account_notifications.sql`.
3. Make a random secret (`openssl rand -hex 24`) and set it as the function's secret:
   ```bash
   npx supabase secrets set NEW_ACCOUNT_NOTIFY_SECRET=<secret>
   ```
4. Deploy the function (the trigger sends `Authorization: Bearer <secret>`, not a Supabase JWT):
   ```bash
   npx supabase functions deploy new-account-notifications --no-verify-jwt
   ```
5. Store the URL and the same secret in Vault (SQL Editor). Until both exist the trigger sends nothing:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/new-account-notifications', 'new_account_notify_url');
   select vault.create_secret('<secret>', 'new_account_notify_secret');
   ```
6. Check: create an account, then `select status_code, content from net._http_response order by created desc limit 5;`
   shows `200` with `{"recipients":1,"sent":1,…}` (`skipped` is 1 when the teacher hasn't connected Telegram or turned
   **New accounts** off). A `401` means the two secrets differ.

To change a Vault value later: `select vault.update_secret((select id from vault.secrets where name = 'new_account_notify_secret'), '<new>');`.

#### Homework submitted (ARU-89)

When a listener submits homework, the course's current owner (teacher or mentor, if Approved) gets "New homework to
check from <sender name> in <course title>: <assignment title>" within seconds, if they connected Telegram and left
**Homework submitted** on (teachers and mentors see this switch; students don't). An after-insert trigger on
`homework` queues one `pg_net` POST `{"homework_id": "<id>"}` with `Authorization: Bearer <secret>` to the Edge
Function `homework-submitted-notifications`, which asks `homework_submitted_recipient()` (service role only) for the
owner at that moment and sends. Checking, unchecking and comment edits send nothing. Submitting never fails because
of this; a failed send is dropped, never retried.

1. Dashboard → **Database → Extensions**: make sure **pg_net** is on.
2. Run `supabase/migrations/0045_homework_submitted_notifications.sql` (after 0044).
3. Make a random secret (`openssl rand -hex 24`) and set it as the function's secret:
   ```bash
   npx supabase secrets set HOMEWORK_SUBMITTED_NOTIFY_SECRET=<secret>
   ```
4. Deploy the function (the trigger sends `Authorization: Bearer <secret>`, not a Supabase JWT):
   ```bash
   npx supabase functions deploy homework-submitted-notifications --no-verify-jwt
   ```
5. Store the URL and the same secret in Vault (SQL Editor). Until both exist the trigger sends nothing:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/homework-submitted-notifications', 'homework_submitted_notify_url');
   select vault.create_secret('<secret>', 'homework_submitted_notify_secret');
   ```
6. Check: submit homework, then `select status_code, content from net._http_response order by created desc limit 5;`
   shows `200` with `{"recipients":1,"sent":1,…}`. A `401` means the two secrets differ.

To change a Vault value later: `select vault.update_secret((select id from vault.secrets where name = 'homework_submitted_notify_secret'), '<new>');`.

#### New materials (ARU-102)

When a teacher or mentor shares a new **Blog** post or **Knowledge base** PDF, everyone who can see it in the app
(every Approved account; for a course-only PDF only the teacher, the course's owner and its listeners), except its
author, gets "New blog post from <author name>: <post title>" or "New file in the knowledge base from <author name>:
<file name>" within seconds, if they connected Telegram and left **New materials** on (every role sees this switch).
After-insert triggers on `materials` and `material_files` queue one `pg_net` POST `{"type": "blog" | "file", "id":
"<id>"}` with `Authorization: Bearer <secret>` to the Edge Function `new-material-notifications`, which asks
`new_material_recipients()` (service role only) who gets it at that moment and sends. Edits and deletions send
nothing; an item deleted before the call is processed sends nothing. Publishing never fails because of this; a
failed send is dropped, never retried.

1. Dashboard → **Database → Extensions**: make sure **pg_net** is on.
2. Run `supabase/migrations/0048_new_material_notifications.sql` (after 0046).
3. Make a random secret (`openssl rand -hex 24`) and set it as the function's secret:
   ```bash
   npx supabase secrets set NEW_MATERIAL_NOTIFY_SECRET=<secret>
   ```
4. Deploy the function (the triggers send `Authorization: Bearer <secret>`, not a Supabase JWT):
   ```bash
   npx supabase functions deploy new-material-notifications --no-verify-jwt
   ```
5. Store the URL and the same secret in Vault (SQL Editor). Until both exist the triggers send nothing:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/new-material-notifications', 'new_material_notify_url');
   select vault.create_secret('<secret>', 'new_material_notify_secret');
   ```
6. Check: share a Blog post, then `select status_code, content from net._http_response order by created desc limit 5;`
   shows `200` with `{"recipients":…,"sent":…}`. A `401` means the two secrets differ.

To change a Vault value later: `select vault.update_secret((select id from vault.secrets where name = 'new_material_notify_secret'), '<new>');`.

### Delete account (ARU-75)

The Delete account screen calls the Edge Function `delete-account` with the user's access token and password. It
only ever deletes the caller: it checks the password (a sign-in on a throwaway client), refuses the teacher and
course owners (`account_deletion_problem()`), removes the caller's Storage files (`account_storage_objects()`:
`homework/<id>/…`, `materials/<id>/…` and anything they own) and then deletes the Auth user, which removes the profile
and every personal row and clears the shared references in one transaction. If a step fails, the account stays and
tapping again continues. Other devices sign out with "Your account was deleted" when the app starts or comes back to
the foreground (it asks Auth whether the user still exists).

1. Run `supabase/migrations/0040_delete_account.sql`.
2. Deploy the function, keeping JWT verification on (only signed-in users may call it). It needs no secrets of its
   own: `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase.
   ```bash
   npx supabase functions deploy delete-account
   ```
3. Check: sign in as a test student and delete the account from Profile → **Delete account**; the user disappears
   from **Authentication → Users** and from `profiles`, and its files from the `homework` bucket.

### Download my photos (ARU-107)

Homework photos are kept for 6 months after the homework is checked (the deletion itself is ARU-112's daily job;
nothing is deleted yet). A sender downloads their own stored photos as a ZIP from the Homework tab's **Checked** list
(students; mentors on the Listener side), or from the warning banner. The app asks the Edge Function
`homework-photos-zip` (POST, with the user's token) for a one-time link valid for 60 seconds, and opens it like a photo's
Download. The link (GET) streams `sham-homework-photos-<date>.zip` with at most 50 photos; more than 50 are offered by
course on **Download by course**. Only a hash of each link is stored (`photo_zip_links`); no ZIP is stored.

1. Run `supabase/migrations/0050_homework_photo_rule.sql`.
2. Deploy the function without JWT verification (the link is opened without an auth header; the POST checks the
   user's token itself and the GET accepts only an unused, unexpired link). It needs no secrets of its own:
   ```bash
   npx supabase functions deploy homework-photos-zip --no-verify-jwt
   ```
3. Check: as a student with a homework photo, tap **Download my photos** on Checked; a ZIP downloads. Opening the same
   link again shows "This download link has expired or was already used".

The warning banner ("<N> homework photos will be deleted on <date>") stays hidden until ARU-112's job sets
`app_settings.photo_deletion_start`.

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

## Languages (ARU-108)

Sham is in English and Russian. The app starts in the phone's (or browser's) language: Russian for any `ru-*` locale,
English otherwise. **Profile → Language** overrides it and is saved on the account (`profiles.language`), so it is the
same on every device; the sign-in screen uses the language last shown on the device.

All texts live in one catalog: `src/i18n/en.json` and `src/i18n/ru.json` (the same text IDs, grouped by screen) and
`src/i18n/notes.json` (where each text appears, for the product owner's spreadsheet). Screens read them with
`useI18n().t('<id>', { …params })`; counts use plural forms (`<id>_one` / `_few` / `_many` / `_other`); dates use
`formatDate` / `formatWeekdayDate` / `formatDateTime` from the same hook, in the chosen language. `npm test` fails when
an ID is missing from one file, a Russian text or a note is empty, or the `{placeholders}` differ.
Moved to the catalog so far (part 1): sign-in and create account, Reset and Change password, the waiting / declined
screens, the tab bar and the Profile tab; (part 2, ARU-109) the Homework and Courses tabs, homework, course, listener,
feedback, meeting and discipline screens; (part 3, ARU-113) Materials, the chats, Pay, the accountant screens, Manage
roles, the Telegram notifications page and Delete account. Every screen is now in both languages; the only app English
left in Russian is the Telegram page's **Connect Telegram** / **Disconnect** buttons, which match the bot's English
replies (product owner decision). Telegram messages (ARU-110) and database errors (ARU-111) come later.

Shared pieces follow the chosen language too: `ErrorText` shows an app message the catalog knows in that language and
any other text (a database error) as it came (`translateKnown`, with the app's messages listed in `APP_MESSAGE_IDS` in
`src/i18n/index.ts`); `formatDate` / `formatDateTime` in `src/lib/theme.ts`, the shared confirmation's Cancel and the
"Deleted account" fallback read the current language (`currentLanguage()`, set by `LanguageProvider`). Shared
components import the hook from `src/i18n/context.tsx`, which doesn't load the store.

## Project structure

```
src/app/                  screens (Expo Router — every file is a route)
  index.tsx               sign in / create account
  (tabs)/                 Homework · Courses (My courses / All courses) · Materials · Profile tabs
  homework/new.tsx        a listener sends homework for an assignment (opened from New)
  homework/[id].tsx       homework details; mentor marks it checked
  homework/photos.tsx     Download by course: a sender's homework photos as ZIPs of at most 50 (ARU-107)
  courses/new.tsx         teacher or mentor creates a course (visible or hidden)
  courses/[id].tsx        course details, meetings, a Listeners row, linked Knowledge base PDFs, feedback and homework
  courses/[id]/feedback.tsx  a listener adds or edits their feedback (stars + review)
  courses/[id]/members.tsx  Listeners page: the list; teacher or mentor removes (X) and adds (ARU-97)
  courses/[id]/listeners.tsx  teacher or mentor adds listeners
  courses/[id]/chat.tsx   course chat (owner, listeners and the teacher)
  general-chat.tsx        general chat for every accepted account (from Profile)
  change-password.tsx     the signed-in user changes their own password (from Profile)
  reset-password.tsx      Forgot password?: email a code, then set a new password with it (signed out)
  courses/[id]/edit.tsx   Edit course (pencil in the course name card): discipline and owner, teacher or mentor (ARU-103)
  courses/[id]/owner.tsx  teacher or mentor changes the course owner (opened from Edit course)
  courses/[id]/meetings/  schedule / edit a meeting; [meetingId]/notes.tsx notes; [meetingId]/assign-homework.tsx;
                          [meetingId]/attendance.tsx who attended
  roles.tsx               teacher accepts / rejects new accounts and switches users between student and mentor
  accountant/courses.tsx  an accountant selects / unselects paid courses
  accountant/[id].tsx     a paid course's period (Change period, Unselect) and listeners: Paid / Unpaid / Exempt this
                          month, payment requests with View proof (accountants and the teacher)
  courses/[id]/pay.tsx    an unpaid listener sends (or replaces) a payment request with a proof (ARU-99)
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
| Remove own leftover photo of a failed send (own folder, no homework points to it; ARU-105) | ✓ | ✓ |  |
| Download own homework photos as a ZIP (one-time link, ARU-107) | own photos | own photos (sent as a listener) |  |
| Set `homework.checked_at` directly (ARU-107: the server sets it when checking) | (nobody) | (nobody) | (nobody) |
| Mark homework checked      |           | any (not their own) | any (not their own) |
| See courses (database)     | all except hidden ones they're not in (title and description only unless they're in it) | all except hidden ones they don't own or attend | all |
| Courses list (Courses tab, ARU-63) | courses they're in + courses with no discipline | own and attended courses + courses with no discipline | own courses + courses with no discipline (hidden ones too); every course through a discipline card |
| See disciplines, their rating and reviews | visible ones | visible ones | ✓ (hidden ones too) |
| Create a discipline, hide / unhide it |   |                    | ✓       |
| Delete a discipline and every course in it (ARU-83) | |         | ✓ (visible and hidden disciplines) |
| Open Edit course (pencil on course details, ARU-103) | | ✓ (any course) | ✓ |
| Set / change / clear a course's discipline (ARU-70) | | own courses   | any course |
| Create courses             |           | ✓                  | ✓       |
| Delete a course and everything in it (ARU-85) | |          | ✓ (any course, hidden ones too) |
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
| Edit name / description / course of PDFs | | ✓ (own)   | ✓ (own) |
| Delete Knowledge base PDFs (ARU-86) |      | ✓ (own)   | ✓ (any) |
| Make a course-linked PDF course-only | | ✓ (own)       | ✓ (own) |
| See a course-only Knowledge base PDF | if in its course | if in its course, or its author | ✓ |
| Switch student ↔ mentor    |           |                    | ✓       |
| Accept or reject new accounts |        |                    | ✓       |
| Connect Telegram and choose own notifications | ✓ (own) | ✓ (own) | ✓ (own) |
| Get a Telegram message for every new course chat message (ARU-44, ARU-87; linked, **Chat messages** on) | courses they're in | own courses + courses they're in | all courses |
| Get a Telegram message for every new general chat message (ARU-87; linked, **General chat** on) | ✓ | ✓ | ✓ |
| Get "Your homework … was reviewed" in Telegram (ARU-49) | own homework, when checked | own homework (sent as a listener), when checked | (never sends homework) |
| Get "New homework" Telegram messages (ARU-50) | courses they're in | courses they're in (not their own) |  |
| Get "New account waiting for your approval" in Telegram (ARU-84; linked, **New accounts** on) |  |  | ✓ (every new sign-up) |
| Get "New homework to check" in Telegram (ARU-89; linked, **Homework submitted** on) | never | courses they own | courses they own |
| Get "New blog post" / "New file in the knowledge base" in Telegram (ARU-102; linked, **New materials** on) | items they can see, not their own | items they can see, not their own | items they can see, not their own |
| Turn Accountant on / off for a mentor (ARU-65) | |         | ✓       |
| Select / unselect paid courses |         | accountants (any course they can see) |  |
| See paid courses, change their payment period | | accountants (all they can see) | ✓ (all) |
| See / set / undo Paid marks and exemptions, see "Unpaid this month" (ARU-66) | | accountants (paid courses they can see) | ✓ (all paid courses) |
| See own payment deadline on a course card (`my_payment_dues`, ARU-66) | as a listener | as a listener |  |
| Send / replace own payment request with a proof (ARU-99; unpaid, in the period) | as a listener | as a listener |  |
| See payment requests and proofs, request count (ARU-99) | own only | accountants (current listeners of paid courses they can see) | ✓ (all) |
| Delete payment proofs (only by deleting a course or discipline, ARU-99) | | | ✓ |
| Choose the app language (Profile → Language, saved in `profiles.language`, ARU-108) | own | own | own |
| Change own password (Supabase Auth, current password required, ARU-76) | own | own | own |
| Reset a forgotten password with an emailed code (signed out, any approval state, ARU-77) | own | own | own |
| Become / stop being teacher |          |                    | (nobody) |
| Delete own account (ARU-75; password again; also waiting / declined accounts) | ✓ | ✓ (not while owning a course) | (never) |
| Delete someone else's account |         |                    | (nobody) |

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
