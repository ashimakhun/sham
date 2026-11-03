import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { periodProblem } from './billing';
import { FEEDBACK_MAX } from './feedback';
import { fileFieldsError, isAllowedPdf, PDF_MAX_BYTES, PDF_RULE } from './files';
import { NOTES_MAX } from './markdown';
import { nameProblem } from './profileName';
import { supabase } from './supabase';
import type {
  AccessRequest,
  Course,
  CourseMember,
  CourseBilling,
  CourseMessage,
  CoursePayment,
  PaymentDue,
  PaymentExemption,
  Discipline,
  GeneralMessage,
  Homework,
  HomeworkAssignment,
  Material,
  MaterialFile,
  MaterialFileEdit,
  Meeting,
  MaterialLike,
  CourseFeedback,
  MeetingAttendance,
  MeetingEdit,
  MeetingStatus,
  NewCourse,
  NewAssignment,
  NewHomework,
  NewMaterial,
  NewMaterialFile,
  NewMeeting,
  TelegramKind,
  TelegramLink,
  User,
} from './types';

// All data access goes through this context. Row-level security in Supabase
// (supabase/migrations) decides what each role can read and change; the role
// checks here only keep the UI honest.

export type Store = {
  ready: boolean;
  session: Session | null;
  currentUser: User | null;
  users: User[];
  materials: Material[];
  /** Knowledge base PDFs (ARU-30), newest first: everyone signed in sees all. */
  materialFiles: MaterialFile[];
  /** All courses, newest first. */
  courses: Course[];
  /** Listeners the current user may see: all for teachers and mentors, own courses' for students. */
  courseMembers: CourseMember[];
  /** Homework the current user is allowed to see, newest first. */
  visibleHomework: Homework[];
  /** Course meetings the current user may see (ARU-10): all for teachers and mentors, own courses' for students. */
  meetings: Meeting[];
  /** Homework assignments (ARU-32) the current user may see: all for teachers and mentors, own courses' for students. */
  assignments: HomeworkAssignment[];
  /** Attendance marks (ARU-33): own marks for students, all for mentors and the teacher. */
  attendance: MeetingAttendance[];
  /** Likes on Blog posts (ARU-52), newest first: every approved user sees all. */
  materialLikes: MaterialLike[];
  /** Course feedback (ARU-53), newest first: every approved user sees it for the courses they can see. */
  courseFeedback: CourseFeedback[];
  /** ARU-63: disciplines the user can see, A-Z (hidden ones only for the teacher). */
  disciplines: Discipline[];
  /** A discipline the user can see, or undefined (unknown, or hidden from them). */
  getDiscipline: (id: string | undefined) => Discipline | undefined;
  /** Teacher only (ARU-63). The name is trimmed; a name that already exists (any case) is refused. */
  addDiscipline: (input: { id: string; name: string; hidden: boolean }) => Promise<void>;
  /** Teacher only (ARU-63): hide or unhide a discipline. */
  setDisciplineHidden: (id: string, hidden: boolean) => Promise<void>;
  /** The course's current owner (ARU-63): set, change or clear (null) its discipline. */
  setCourseDiscipline: (courseId: string, disciplineId: string | null) => Promise<void>;
  loading: boolean;
  /** True once data has been fetched (successfully or not) for the signed-in user. */
  dataLoaded: boolean;
  refresh: () => Promise<void>;
  getUser: (id: string | undefined) => User | undefined;
  getCourse: (id: string | undefined) => Course | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Approved users change their own name (ARU-55): trimmed, not blank, at most NAME_MAX characters. The database
   *  allows only the own row and refuses blank names; the store's profiles are updated right after the save. */
  updateMyName: (name: string) => Promise<void>;
  /** A listener sends homework for an assignment of their course (ARU-32): one per assignment. */
  addHomework: (input: NewHomework) => Promise<void>;
  /** Course owner or teacher, Completed meetings only, one per meeting (ARU-32). `id` makes a retry safe. */
  addAssignment: (input: NewAssignment) => Promise<void>;
  checkHomework: (id: string, comment: string) => Promise<void>;
  /** A fresh signed URL for a homework photo (ARU-18). Storage policies allow it only for users who can read
   *  that homework. With `download`, the file is served as an attachment under that file name. */
  getPhotoUrl: (path: string, options?: { expiresIn?: number; download?: string }) => Promise<string>;
  addMaterial: (input: NewMaterial) => Promise<void>;
  /** Teachers and mentors only (also enforced by RLS). */
  addCourse: (input: NewCourse) => Promise<void>;
  /** Teachers and mentors only (ARU-9). Makes `userId` (a teacher or mentor, not a listener) the course owner. */
  changeCourseOwner: (courseId: string, userId: string) => Promise<void>;
  /** Teachers and mentors only. Adds all users in one insert: all of them or none. */
  addListeners: (courseId: string, userIds: string[]) => Promise<void>;
  /** Teachers and mentors only. How many homework items removing this listener would delete. */
  countListenerHomework: (courseId: string, userId: string) => Promise<number>;
  /** Teachers and mentors only. Deletes the listener's homework for the course (and photos), then the membership. */
  removeListener: (courseId: string, userId: string) => Promise<void>;
  /** Teacher only (ARU-85): deletes the course with everything in it. Homework photos first (checked that Storage
   *  really removed them), then the course and its rows in one transaction. A course that is already gone counts as
   *  deleted, so a retry finishes a half-done delete. Doesn't wait for the refetch, so the caller can navigate away
   *  before the course screen turns into "Course not found". */
  deleteCourse: (courseId: string) => Promise<void>;
  /** Teacher only (ARU-83): deletes the discipline and every course in it (hidden ones too), each with everything in
   *  it, the same way as deleteCourse(). Already gone counts as deleted. Doesn't wait for the refetch. */
  deleteDiscipline: (disciplineId: string) => Promise<void>;
  deleteMaterial: (id: string) => Promise<void>;
  /** Teachers and mentors (ARU-30): uploads the PDF, then saves the item. A retry with the same `id` reuses both.
   *  When `isCancelled()` is true after the upload (the user left the screen), nothing is saved and the file is
   *  removed again. */
  addMaterialFile: (input: NewMaterialFile, options?: { isCancelled?: () => boolean }) => Promise<void>;
  /** The author only, while a teacher or mentor: name, description and course. */
  updateMaterialFile: (id: string, input: MaterialFileEdit) => Promise<void>;
  /** The author (while a teacher or mentor), or the teacher on any PDF (ARU-86): removes the PDF first, then the item,
   *  so tapping Delete again finishes a half-done delete. */
  deleteMaterialFile: (id: string) => Promise<void>;
  /** A signed link to a Knowledge base PDF, valid for 60 seconds; created when the user taps Open PDF. */
  getMaterialFileUrl: (storagePath: string) => Promise<string>;
  /** Course owner or teacher (also enforced by RLS). `id` is generated once per form, so a retry saves once. */
  addMeeting: (input: NewMeeting) => Promise<void>;
  /** Course owner or teacher: Scheduled -> completed (after the start) or canceled. Final; a retry is a no-op. */
  setMeetingStatus: (id: string, status: Exclude<MeetingStatus, 'scheduled'>) => Promise<void>;
  /** Course owner or teacher, Scheduled meetings only (ARU-15). A changed start must be in the future. */
  updateMeeting: (id: string, input: MeetingEdit) => Promise<void>;
  /** Course owner or teacher, Completed meetings only (ARU-28). Blank text removes the notes. */
  setMeetingNotes: (id: string, notes: string) => Promise<void>;
  /** ARU-60: the teacher or a non-listener mentor marks a Completed meeting's homework checked (or undoes it). Marking
   *  a checked meeting or undoing an unchecked one is a no-op, so a retry is safe. */
  setMeetingHomeworkChecked: (id: string, checked: boolean) => Promise<void>;
  /** A listener marks their own attendance of a Completed meeting (ARU-33). Marking again is a no-op. */
  markAttendance: (meetingId: string) => Promise<void>;
  /** A listener removes their own attendance mark (ARU-33). */
  unmarkAttendance: (meetingId: string) => Promise<void>;
  /** Likes a Blog post as the current user (ARU-52). Liking again is a no-op. */
  likeMaterial: (materialId: string) => Promise<void>;
  /** Removes the current user's like (ARU-52). Removing a like that is already gone is a no-op. */
  unlikeMaterial: (materialId: string) => Promise<void>;
  /** A listener adds (no `id`) or edits (`id`) their feedback on a started course (ARU-53). Text is trimmed. */
  saveFeedback: (input: { id?: string; courseId: string; rating: number; body: string }) => Promise<void>;
  /** The author deletes their own feedback (ARU-53). Already gone counts as done. */
  deleteFeedback: (id: string) => Promise<void>;
  /** Course chat (ARU-8): a page of messages, newest first, older than `before` when given. */
  loadMessages: (courseId: string, before?: CourseMessage) => Promise<{ messages: CourseMessage[]; hasMore: boolean }>;
  /** Posts as the current user. `id` is generated once per message so a retry cannot post twice. */
  sendMessage: (input: { id: string; courseId: string; body: string }) => Promise<void>;
  /** Live inserts for one course's chat (its own channel, not the global refetch). Returns an unsubscribe. */
  subscribeToMessages: (courseId: string, onMessage: (m: CourseMessage) => void) => () => void;
  /** General chat (ARU-61), for every approved user: a page of messages, newest first, older than `before`. */
  loadGeneralMessages: (before?: GeneralMessage) => Promise<{ messages: GeneralMessage[]; hasMore: boolean }>;
  /** Posts to the general chat as the current user; `id` is kept across retries so a retry cannot post twice. */
  sendGeneralMessage: (input: { id: string; body: string }) => Promise<void>;
  /** Live inserts in the general chat, on its own channel (not the store's refetch or ARU-31 counters). */
  subscribeToGeneralMessages: (onMessage: (m: GeneralMessage) => void) => () => void;
  /** Teacher only (ARU-43): accounts waiting for approval and declined ones, oldest first. Empty for others. */
  accessRequests: AccessRequest[];
  /** Teacher only (ARU-43): accept (approved) or decline (rejected) an account, then refetch. A retry is a no-op. */
  setAccessStatus: (userId: string, status: 'approved' | 'rejected') => Promise<void>;
  /** Teacher only (ARU-13): switches a user between student and mentor via set_user_role(), then refetches. */
  setUserRole: (userId: string, role: 'student' | 'mentor') => Promise<void>;
  /** The signed-in user's Telegram link (ARU-48): undefined until loaded, null when not connected. */
  telegram: TelegramLink | null | undefined;
  /** Refetches the Telegram link (the Profile tab calls it on focus and when the app comes back). */
  loadTelegram: () => Promise<void>;
  /** A new one-time code for the bot's /start link (approved accounts only). */
  createTelegramLinkCode: () => Promise<string>;
  /** Turns one Telegram notification type on or off. */
  setTelegramNotification: (kind: TelegramKind, enabled: boolean) => Promise<void>;
  /** Removes the Telegram link and its switches. */
  disconnectTelegram: () => Promise<void>;
  /** ARU-65: paid courses with their periods. Only loaded for accountants and the teacher (empty for everyone else). */
  courseBilling: CourseBilling[];
  /** Teacher only (ARU-65): turn Accountant on or off for an approved mentor. Takes effect on their next refresh. */
  setAccountant: (userId: string, on: boolean) => Promise<void>;
  /** An accountant selects a paid course with its period. If another accountant was first, their period stays. */
  selectPaidCourse: (courseId: string, startDay: number, endDay: number) => Promise<void>;
  /** An accountant or the teacher changes a paid course's period (applies from this month on). */
  setBillingPeriod: (courseId: string, startDay: number, endDay: number) => Promise<void>;
  /** An accountant unselects a paid course, for everyone. Already gone counts as done. */
  unselectPaidCourse: (courseId: string) => Promise<void>;
  /** ARU-66: Paid marks of current listeners of paid courses (accountants and the teacher; empty for others). */
  coursePayments: CoursePayment[];
  /** ARU-66: exemptions of current listeners of paid courses (accountants and the teacher; empty for others). */
  paymentExemptions: PaymentExemption[];
  /** ARU-66: marks a listener Paid for `month` (YYYY-MM-01, device-local). Marking again is a no-op. */
  markPaid: (courseId: string, userId: string, month: string) => Promise<void>;
  /** ARU-66: removes the listener's Paid mark for `month`, whoever made it. */
  undoPaid: (courseId: string, userId: string, month: string) => Promise<void>;
  /** ARU-66: sets (true) or clears (false) a listener's exemption. Repeats are no-ops. */
  setExempt: (courseId: string, userId: string, exempt: boolean) => Promise<void>;
  /** ARU-66: the signed-in listener's own due courses for `today` (YYYY-MM-DD, device-local). Throws on error. */
  loadPaymentDues: (today: string) => Promise<PaymentDue[]>;
  /** New messages from others per course chat since the user last read it (ARU-31). 0 while that chat is open. */
  unreadCount: (courseId: string) => number;
  /** Marks a chat read up to `upToMessageId` (the newest message shown), by that message's server time. Clears the
   *  count at once; a failed save (e.g. offline) is ignored and the count comes back on the next refetch. */
  markChatRead: (courseId: string, upToMessageId: string) => Promise<void>;
  /** The chat that is open on screen (or null): its messages are read as they arrive, so it never shows a count. */
  setActiveChat: (courseId: string | null) => void;
  /** New general chat messages from others since the user last read it (ARU-72). 0 while the general chat is open.
   *  Kept apart from the course counts, so the two never affect each other. */
  generalUnreadCount: number;
  /** Marks the general chat read up to `upToMessageId` (the newest message shown), by its server time. Clears the
   *  count at once; a failed save (e.g. offline) is ignored and the count comes back on the next refetch. */
  markGeneralChatRead: (upToMessageId: string) => Promise<void>;
  /** Whether the general chat is open on screen: its messages are read as they arrive, so it never shows a count. */
  setGeneralChatOpen: (open: boolean) => void;
};

/** Live count refetches are batched: one request at most this often while messages arrive (ARU-31). */
const UNREAD_DEBOUNCE_MS = 500;

export const MESSAGES_PAGE = 50;

const StoreContext = createContext<Store | null>(null);

type ProfileRow = {
  id: string;
  full_name: string;
  role: User['role'];
  access_status?: User['accessStatus'] | null;
  is_accountant?: boolean | null;
};
type BillingRow = { course_id: string; start_day: number; end_day: number; selected_by: string; selected_at: string };
type PaymentRow = { course_id: string; user_id: string; month: string; marked_by: string; marked_at: string };
type ExemptionRow = { course_id: string; user_id: string };
type DueRow = { course_id: string; deadline: string };
type AccessRequestRow = { id: string; full_name: string; email: string | null; created_at: string; access_status: AccessRequest['status'] };
type HomeworkRow = {
  id: string;
  student_id: string;
  course_id: string | null;
  title: string;
  description: string;
  photo_path: string | null;
  status: Homework['status'];
  checked_by: string | null;
  checked_at: string | null;
  mentor_comment: string | null;
  created_at: string;
  assignment_id?: string | null;
};
type AssignmentRow = {
  id: string;
  meeting_id: string;
  course_id: string;
  title: string;
  description: string;
  due_at: string | null;
  created_by: string;
  created_at: string;
};
type CourseRow = {
  id: string;
  title: string;
  description: string;
  created_by: string;
  created_at: string;
  hidden?: boolean | null;
  discipline_id?: string | null;
};
type DisciplineRow = { id: string; name: string; hidden: boolean; created_by: string; created_at: string };
type CourseMemberRow = { course_id: string; user_id: string; added_by: string; added_at: string };
type MeetingRow = {
  id: string;
  course_id: string;
  starts_at: string;
  topic: string;
  location: string | null;
  status: MeetingStatus;
  created_by: string;
  created_at: string;
  status_changed_by: string | null;
  status_changed_at: string | null;
  rescheduled_at: string | null;
  notes?: string | null;
  notes_updated_by?: string | null;
  notes_updated_at?: string | null;
  homework_checked_at?: string | null;
  homework_checked_by?: string | null;
};
type AttendanceRow = { meeting_id: string; user_id: string; marked_at: string };
type MaterialLikeRow = { material_id: string; user_id: string; created_at: string };
type FeedbackRow = {
  id: string;
  course_id: string;
  user_id: string;
  rating: number;
  body: string;
  created_at: string;
  updated_at: string;
};
type MessageRow = { id: string; course_id: string; author_id: string; body: string; created_at: string };
type GeneralMessageRow = { id: string; author_id: string; body: string; created_at: string };
type UnreadRow = { course_id: string; unread: number | string };
type MaterialFileRow = {
  id: string;
  author_id: string;
  name: string;
  description: string;
  course_id: string | null;
  course_only?: boolean | null;
  storage_path: string;
  size_bytes: number | string;
  created_at: string;
  updated_at: string;
};
type TelegramLinkRow = {
  linked_at: string;
  notify_meeting_started: boolean;
  notify_new_homework: boolean;
  notify_homework_reviewed: boolean;
  notify_chat_message: boolean;
};
const toTelegramLink = (r: TelegramLinkRow): TelegramLink => ({
  linkedAt: r.linked_at,
  switches: {
    meeting_started: r.notify_meeting_started,
    new_homework: r.notify_new_homework,
    homework_reviewed: r.notify_homework_reviewed,
    chat_message: r.notify_chat_message,
  },
});
type MaterialRow = {
  id: string;
  teacher_id: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
};

const toUser = (r: ProfileRow): User => ({
  id: r.id,
  name: r.full_name,
  role: r.role,
  // No column yet (migration 0021 not run): everyone counts as approved.
  accessStatus: r.access_status ?? 'approved',
  isAccountant: !!r.is_accountant,
});

const toBilling = (r: BillingRow): CourseBilling => ({
  courseId: r.course_id,
  startDay: r.start_day,
  endDay: r.end_day,
  selectedById: r.selected_by,
  selectedAt: r.selected_at,
});

const toPayment = (r: PaymentRow): CoursePayment => ({
  courseId: r.course_id,
  userId: r.user_id,
  // A date column; keep only YYYY-MM-DD in case a time part comes back.
  month: String(r.month).slice(0, 10),
  markedById: r.marked_by,
  markedAt: r.marked_at,
});

/** ARU-65: who reads paid courses (mirrors 0032's select policy): the teacher and approved mentor accountants. */
const seesBilling = (u: User | undefined) =>
  !!u && u.accessStatus === 'approved' && (u.role === 'teacher' || (u.role === 'mentor' && !!u.isAccountant));


const toAccessRequest = (r: AccessRequestRow): AccessRequest => ({
  id: r.id,
  name: r.full_name,
  email: r.email ?? '',
  createdAt: r.created_at,
  status: r.access_status,
});

const toHomework = (r: HomeworkRow): Homework => ({
  id: r.id,
  studentId: r.student_id,
  courseId: r.course_id ?? undefined,
  title: r.title,
  description: r.description,
  photoPath: r.photo_path ?? undefined,
  status: r.status,
  createdAt: r.created_at,
  checkedById: r.checked_by ?? undefined,
  checkedAt: r.checked_at ?? undefined,
  mentorComment: r.mentor_comment ?? undefined,
  assignmentId: r.assignment_id ?? undefined,
});

const toAssignment = (r: AssignmentRow): HomeworkAssignment => ({
  id: r.id,
  meetingId: r.meeting_id,
  courseId: r.course_id,
  title: r.title,
  description: r.description,
  dueAt: r.due_at ?? undefined,
  createdById: r.created_by,
  createdAt: r.created_at,
});

const toCourse = (r: CourseRow): Course => ({
  id: r.id,
  title: r.title,
  description: r.description,
  createdById: r.created_by,
  createdAt: r.created_at,
  hidden: !!r.hidden,
  disciplineId: r.discipline_id ?? undefined,
});

const toDiscipline = (r: DisciplineRow): Discipline => ({
  id: r.id,
  name: r.name,
  hidden: !!r.hidden,
  createdById: r.created_by,
  createdAt: r.created_at,
});

export const DISCIPLINE_NAME_MAX = 100;
const DUPLICATE_DISCIPLINE = 'A discipline with this name already exists.';

const toCourseMember = (r: CourseMemberRow): CourseMember => ({
  courseId: r.course_id,
  userId: r.user_id,
  addedById: r.added_by,
  addedAt: r.added_at,
});

const toMeeting = (r: MeetingRow): Meeting => ({
  id: r.id,
  courseId: r.course_id,
  startsAt: r.starts_at,
  topic: r.topic,
  location: r.location ?? undefined,
  status: r.status,
  createdById: r.created_by,
  createdAt: r.created_at,
  statusChangedById: r.status_changed_by ?? undefined,
  statusChangedAt: r.status_changed_at ?? undefined,
  rescheduledAt: r.rescheduled_at ?? undefined,
  notes: r.notes ?? undefined,
  notesUpdatedById: r.notes_updated_by ?? undefined,
  notesUpdatedAt: r.notes_updated_at ?? undefined,
  homeworkCheckedAt: r.homework_checked_at ?? undefined,
  homeworkCheckedById: r.homework_checked_by ?? undefined,
});

const toAttendance = (r: AttendanceRow): MeetingAttendance => ({
  meetingId: r.meeting_id,
  userId: r.user_id,
  markedAt: r.marked_at,
});

const toMaterialLike = (r: MaterialLikeRow): MaterialLike => ({
  materialId: r.material_id,
  userId: r.user_id,
  createdAt: r.created_at,
});

const toFeedback = (r: FeedbackRow): CourseFeedback => ({
  id: r.id,
  courseId: r.course_id,
  userId: r.user_id,
  rating: r.rating,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toGeneralMessage = (r: GeneralMessageRow): GeneralMessage => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  createdAt: r.created_at,
});

const toMessage = (r: MessageRow): CourseMessage => ({
  id: r.id,
  courseId: r.course_id,
  authorId: r.author_id,
  body: r.body,
  createdAt: r.created_at,
});

const toMaterial = (r: MaterialRow): Material => ({
  id: r.id,
  teacherId: r.teacher_id,
  title: r.title,
  body: r.body,
  link: r.link ?? undefined,
  createdAt: r.created_at,
});

const toMaterialFile = (r: MaterialFileRow): MaterialFile => ({
  id: r.id,
  authorId: r.author_id,
  name: r.name,
  description: r.description,
  courseId: r.course_id ?? undefined,
  // Without a course an item is visible to everyone (ARU-42).
  courseOnly: !!r.course_only && !!r.course_id,
  storagePath: r.storage_path,
  // bigint may arrive as a string.
  sizeBytes: Number(r.size_bytes),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type ListenerHomeworkRow = { id: string; photo_path: string | null };

type Result = { error: { message: string; code?: string } | null };

function check(res: Result) {
  if (res.error) throw new Error(res.error.message);
}

/** Like check(), but a duplicate primary key means an earlier attempt already saved this row. */
function checkInsert(res: Result) {
  if (res.error?.code === '23505') return;
  check(res);
}

/** Postgres "no data found": the course or discipline doesn't exist (any more). */
const NOT_FOUND = 'P0002';

/**
 * ARU-85 / ARU-83: deletes a course or a discipline with everything in it. 1. Homework photos first (SQL can't
 * delete Storage files); if this fails, nothing else has changed. remove() silently skips objects it may not
 * delete, so the photos are listed again and any left over is an error. 2. The rows, in one transaction. "Not
 * found" (P0002) at either step means an earlier attempt already deleted it: done.
 */
async function deleteWithHomeworkPhotos(
  photosRpc: 'course_homework_photos' | 'discipline_homework_photos',
  deleteRpc: 'delete_course' | 'delete_discipline',
  args: Record<string, string>,
  what: 'course' | 'discipline',
) {
  // Photos still in Storage; null when it is already gone.
  const listPhotos = async () => {
    const res = await supabase.rpc(photosRpc, args);
    if (res.error?.code === NOT_FOUND) return null;
    return rows<{ photo_path: string }>(res).map((r) => r.photo_path);
  };
  const paths = await listPhotos();
  if (paths === null) return;
  if (paths.length) {
    check(await supabase.storage.from('homework').remove(paths));
    const left = await listPhotos();
    if (left === null) return;
    if (left.length) throw new Error(`Some homework photos couldn't be deleted, so the ${what} wasn't deleted. Try again.`);
  }
  const res = await supabase.rpc(deleteRpc, args);
  if (res.error?.code !== NOT_FOUND) check(res);
}

const NO_LONGER_LISTENER = "You're no longer a listener of this course.";

/** Course feedback writes refused by RLS mean the user isn't a listener (any more), or the course hasn't started. */
function checkFeedback(res: Result) {
  if (res.error?.code === '42501') throw new Error(NO_LONGER_LISTENER);
  if (res.error?.code === '23505') throw new Error('You have already left feedback on this course.');
  check(res);
}

const ALREADY_SENT = 'You have already sent homework for this assignment.';
const DEADLINE_PAST = 'The deadline must be in the future.';

/** Whether a row with this id exists (and is visible): tells a safe retry from a real duplicate. */
async function rowExists(table: 'homework' | 'homework_assignments', id: string) {
  const res = await supabase.from(table).select('id').eq('id', id);
  return !res.error && (res.data?.length ?? 0) > 0;
}

function rows<T>(res: Result & { data: unknown }): T[] {
  check(res);
  return (res.data as T[] | null) ?? [];
}

async function withSignedPhotoUrls(items: Homework[]) {
  const paths = items.map((h) => h.photoPath).filter((p): p is string => !!p);
  if (!paths.length) return items;
  const { data } = await supabase.storage.from('homework').createSignedUrls(paths, 60 * 60);
  const urls = new Map(data?.map((d) => [d.path, d.signedUrl]));
  return items.map((h) => (h.photoPath ? { ...h, photoUrl: urls.get(h.photoPath) ?? undefined } : h));
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  // Every profile the database returns: approved accounts, plus all accounts for the teacher and the own row (ARU-43).
  const [profiles, setProfiles] = useState<User[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [telegram, setTelegram] = useState<TelegramLink | null | undefined>(undefined);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialFiles, setMaterialFiles] = useState<MaterialFile[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseMembers, setCourseMembers] = useState<CourseMember[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [assignments, setAssignments] = useState<HomeworkAssignment[]>([]);
  const [attendance, setAttendance] = useState<MeetingAttendance[]>([]);
  const [materialLikes, setMaterialLikes] = useState<MaterialLike[]>([]);
  const [courseFeedback, setCourseFeedback] = useState<CourseFeedback[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [courseBilling, setCourseBilling] = useState<CourseBilling[]>([]);
  const [coursePayments, setCoursePayments] = useState<CoursePayment[]>([]);
  const [paymentExemptions, setPaymentExemptions] = useState<PaymentExemption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [generalUnread, setGeneralUnread] = useState(0);
  const [generalChatOpen, setGeneralChatOpen] = useState(false);

  const userId = session?.user.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        // Signed out: drop the previous user's data.
        setProfiles([]);
        setAccessRequests([]);
        setTelegram(undefined);
        setHomework([]);
        setMaterials([]);
        setMaterialFiles([]);
        setCourses([]);
        setCourseMembers([]);
        setMeetings([]);
        setAssignments([]);
        setAttendance([]);
        setMaterialLikes([]);
        setCourseFeedback([]);
        setCourseBilling([]);
        setCoursePayments([]);
        setPaymentExemptions([]);
        setUnread({});
        setActiveChat(null);
        setGeneralUnread(0);
        setGeneralChatOpen(false);
        setLoadedFor(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // New-message counts for all the user's chats in one request (ARU-31). Only the latest request's answer is used,
  // so an older answer arriving late can't bring back a count that was just cleared. Errors keep the last counts.
  const unreadRequest = useRef(0);
  const loadUnread = useCallback(async () => {
    if (!userId) return;
    const request = ++unreadRequest.current;
    const res = await supabase.rpc('chat_unread_counts');
    if (res.error || request !== unreadRequest.current) return;
    const counts: Record<string, number> = {};
    for (const r of (res.data as UnreadRow[] | null) ?? []) counts[r.course_id] = Number(r.unread);
    setUnread(counts);
  }, [userId]);

  // The general chat's count (ARU-72), the same way: only the latest answer is used, errors keep the last count.
  const generalUnreadRequest = useRef(0);
  const loadGeneralUnread = useCallback(async () => {
    if (!userId) return;
    const request = ++generalUnreadRequest.current;
    const res = await supabase.rpc('general_chat_unread_count');
    if (res.error || request !== generalUnreadRequest.current) return;
    setGeneralUnread(Number(res.data ?? 0) || 0);
  }, [userId]);

  // Fetches everything the signed-in user may see. State is only set after the
  // awaits, so it is safe to call from an effect.
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      // RLS returns nothing but the own profile to an account that isn't approved (ARU-43), so these all succeed
      // (empty) for it and the app shows the waiting screen.
      const [profileRows, hw, mats, crs, members, mtgs, asgs, att, files, likes, fb, discs] = await Promise.all([
        // '*' so the app keeps working if the access_status column (0021) isn't there yet.
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('homework').select('*').order('created_at', { ascending: false }),
        supabase.from('materials').select('*').order('created_at', { ascending: false }),
        supabase.from('courses').select('*').order('created_at', { ascending: false }),
        supabase.from('course_members').select('*'),
        supabase.from('course_meetings').select('*').order('starts_at'),
        supabase.from('homework_assignments').select('*').order('created_at', { ascending: false }),
        supabase.from('meeting_attendance').select('*'),
        supabase.from('material_files').select('*').order('created_at', { ascending: false }),
        supabase.from('material_likes').select('*').order('created_at', { ascending: false }),
        supabase.from('course_feedback').select('*').order('created_at', { ascending: false }),
        supabase.from('disciplines').select('*').order('name'),
      ]);
      const all = rows<ProfileRow>(profileRows).map(toUser);
      const me = all.find((u) => u.id === userId);
      setProfiles(all);
      setHomework(await withSignedPhotoUrls(rows<HomeworkRow>(hw).map(toHomework)));
      setMaterials(rows<MaterialRow>(mats).map(toMaterial));
      setCourses(rows<CourseRow>(crs).map(toCourse));
      setCourseMembers(rows<CourseMemberRow>(members).map(toCourseMember));
      setMeetings(rows<MeetingRow>(mtgs).map(toMeeting));
      setAssignments(rows<AssignmentRow>(asgs).map(toAssignment));
      setAttendance(rows<AttendanceRow>(att).map(toAttendance));
      setMaterialFiles(rows<MaterialFileRow>(files).map(toMaterialFile));
      setMaterialLikes(rows<MaterialLikeRow>(likes).map(toMaterialLike));
      setCourseFeedback(rows<FeedbackRow>(fb).map(toFeedback));
      // Before 0031_disciplines.sql runs there is no table: no disciplines, and the rest of the app keeps working.
      setDisciplines(discs.error ? [] : ((discs.data as DisciplineRow[] | null) ?? []).map(toDiscipline));
      if (me?.accessStatus !== 'approved') {
        setAccessRequests([]);
        setUnread({});
        setGeneralUnread(0);
        setCourseBilling([]);
        setCoursePayments([]);
        setPaymentExemptions([]);
        return;
      }
      // ARU-65: paid courses, only for those who may read them (students and other mentors make no request).
      // ARU-66: the same people read Paid marks and exemptions (RLS: current listeners of paid courses only).
      if (seesBilling(me)) {
        const [bill, pays, exempts] = await Promise.all([
          supabase.from('course_billing').select('*'),
          supabase.from('course_payments').select('*'),
          supabase.from('course_payment_exemptions').select('*'),
        ]);
        // Before 0032 / 0039 run there is no table: no paid courses, marks or exemptions.
        setCourseBilling(bill.error ? [] : ((bill.data as BillingRow[] | null) ?? []).map(toBilling));
        setCoursePayments(pays.error ? [] : ((pays.data as PaymentRow[] | null) ?? []).map(toPayment));
        setPaymentExemptions(
          exempts.error
            ? []
            : ((exempts.data as ExemptionRow[] | null) ?? []).map((r) => ({ courseId: r.course_id, userId: r.user_id })),
        );
      } else {
        setCourseBilling([]);
        setCoursePayments([]);
        setPaymentExemptions([]);
      }
      // Requests for the teacher's Manage roles screen. Not live: they refresh with every load.
      if (me.role === 'teacher') {
        const req = await supabase.rpc('access_requests');
        setAccessRequests(req.error ? [] : ((req.data as AccessRequestRow[] | null) ?? []).map(toAccessRequest));
      } else {
        setAccessRequests([]);
      }
      await Promise.all([loadUnread().catch(() => {}), loadGeneralUnread().catch(() => {})]);
    } finally {
      setLoadedFor(userId);
    }
  }, [userId, loadUnread, loadGeneralUnread]);

  /** User-triggered reload (pull to refresh, retry) with a spinner. */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await load();
    } finally {
      setLoading(false);
    }
  }, [load]);

  // Not approved yet (ARU-43): nothing to listen to.
  const waiting = profiles.some((u) => u.id === userId && u.accessStatus !== 'approved');
  // ARU-65: only accountants and the teacher listen to paid-course changes.
  const listensToBilling = seesBilling(profiles.find((u) => u.id === userId));

  useEffect(() => {
    if (!userId) return;
    load().catch(() => {});
  }, [userId, load]);

  // Live updates start once the first load has said whether the account is approved.
  const firstLoadDone = !!userId && loadedFor === userId;
  useEffect(() => {
    if (!userId || !firstLoadDone || waiting) return;
    let unreadTimer: ReturnType<typeof setTimeout> | null = null;
    let generalUnreadTimer: ReturnType<typeof setTimeout> | null = null;
    // Live updates: refetch when someone submits, checks or shares something.
    const channel = supabase
      .channel('sham-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_files' }, () => load().catch(() => {}))
      // Likes (ARU-52): counts and "Liked by" update on every open device.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'material_likes' }, () => load().catch(() => {}))
      // Feedback (ARU-53): the list, the average and the course cards update on every open device.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_feedback' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, () => load().catch(() => {}))
      // ARU-63: created and unhidden disciplines reach everyone; hiding reaches only the teacher (RLS).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplines' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_members' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_meetings' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework_assignments' }, () =>
        load().catch(() => {}),
      )
      // Any change (including an Undo, whose DELETE payload carries only the key) reloads (ARU-33).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_attendance' }, () => load().catch(() => {}))
      // A chat message refetches only the counts (one request, batched), never the full load() (ARU-31).
      // Realtime applies RLS, so only messages of chats the user is in arrive; their own never count.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'course_messages' }, (payload) => {
        if ((payload.new as MessageRow).author_id === userId) return;
        if (unreadTimer) return;
        unreadTimer = setTimeout(() => {
          unreadTimer = null;
          loadUnread().catch(() => {});
        }, UNREAD_DEBOUNCE_MS);
      })
      // A general chat message refetches only the general count, batched the same way (ARU-72).
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'general_messages' }, (payload) => {
        if ((payload.new as { author_id?: string }).author_id === userId) return;
        if (generalUnreadTimer) return;
        generalUnreadTimer = setTimeout(() => {
          generalUnreadTimer = null;
          loadGeneralUnread().catch(() => {});
        }, UNREAD_DEBOUNCE_MS);
      });
    if (listensToBilling) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'course_billing' }, () => load().catch(() => {}));
      // ARU-66: another accountant or the teacher marks, undoes or exempts.
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'course_payments' }, () => load().catch(() => {}));
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'course_payment_exemptions' }, () =>
        load().catch(() => {}),
      );
    }
    channel.subscribe();
    // Back from the background: realtime may have missed messages, so refetch the counts.
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      loadUnread().catch(() => {});
      loadGeneralUnread().catch(() => {});
    });
    return () => {
      if (unreadTimer) clearTimeout(unreadTimer);
      if (generalUnreadTimer) clearTimeout(generalUnreadTimer);
      appState.remove();
      supabase.removeChannel(channel);
    };
  }, [userId, firstLoadDone, waiting, listensToBilling, load, loadUnread, loadGeneralUnread]);

  const currentUser = profiles.find((u) => u.id === userId) ?? null;
  // Only approved accounts are users of the app: pickers and lists never offer people still waiting (ARU-43).
  const users = useMemo(() => profiles.filter((u) => u.accessStatus === 'approved'), [profiles]);
  const getUser = useCallback((id: string | undefined) => users.find((u) => u.id === id), [users]);
  const sortedCourses = useMemo(
    () => [...courses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [courses],
  );
  const sortedMaterialFiles = useMemo(
    () => [...materialFiles].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
    [materialFiles],
  );
  const getCourse = useCallback((id: string | undefined) => courses.find((c) => c.id === id), [courses]);
  const sortedDisciplines = useMemo(
    () => [...disciplines].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [disciplines],
  );
  const getDiscipline = useCallback(
    (id: string | undefined) => (id ? disciplines.find((d) => d.id === id) : undefined),
    [disciplines],
  );
  const visibleHomework = useMemo(
    () => [...homework].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [homework],
  );

  // Stable across renders, so a screen can fetch a link once without refetching on every live update.
  const getPhotoUrl = useCallback<Store['getPhotoUrl']>(async (path, { expiresIn = 60 * 60, download } = {}) => {
    const { data, error } = await supabase.storage
      .from('homework')
      .createSignedUrl(path, expiresIn, download ? { download } : undefined);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No photo link.');
    return data.signedUrl;
  }, []);

  // Stable, so the chat screen can call it from effects without re-running them on every store update.
  // ARU-48: the own row only (RLS). Not in load(): the Profile tab refetches it on focus and on returning to the app.
  // Stable, so the screen can call it from focus effects. An error (e.g. offline) keeps what was loaded.
  const loadTelegram = useCallback(async () => {
    if (!userId) return;
    const res = await supabase.from('telegram_links').select('*').eq('user_id', userId);
    if (res.error) throw new Error(res.error.message);
    const row = ((res.data as TelegramLinkRow[] | null) ?? [])[0];
    setTelegram(row ? toTelegramLink(row) : null);
  }, [userId]);

  const markChatRead = useCallback<Store['markChatRead']>(
    async (courseId, upToMessageId) => {
      // Clear at once (and drop any count request in flight), then save; the refetch after the save is the truth.
      unreadRequest.current++;
      setUnread((counts) => (counts[courseId] ? { ...counts, [courseId]: 0 } : counts));
      const res = await supabase.rpc('mark_chat_read', { course: courseId, upto: upToMessageId });
      if (res.error) return;
      await loadUnread().catch(() => {});
    },
    [loadUnread],
  );

  const markGeneralChatRead = useCallback<Store['markGeneralChatRead']>(
    async (upToMessageId) => {
      generalUnreadRequest.current++;
      setGeneralUnread(0);
      const res = await supabase.rpc('mark_general_chat_read', { upto: upToMessageId });
      if (res.error) return;
      await loadGeneralUnread().catch(() => {});
    },
    [loadGeneralUnread],
  );

  const requireRole = (...roles: User['role'][]) => {
    if (!currentUser || !roles.includes(currentUser.role)) throw new Error(`Only a ${roles.join(' or ')} can do this.`);
    return currentUser;
  };

  const store: Store = {
    ready,
    session,
    currentUser,
    users,
    materials,
    materialFiles: sortedMaterialFiles,
    courses: sortedCourses,
    courseMembers,
    visibleHomework,
    meetings,
    assignments,
    attendance,
    materialLikes,
    courseFeedback,
    disciplines: sortedDisciplines,
    getDiscipline,
    loading,
    dataLoaded: !!userId && loadedFor === userId,
    refresh,
    getUser,
    getCourse,
    signIn: async (email, password) => {
      check(await supabase.auth.signInWithPassword({ email: email.trim(), password }));
    },
    signUp: async (name, email, password) => {
      check(
        await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        }),
      );
    },
    signOut: async () => {
      check(await supabase.auth.signOut());
    },
    updateMyName: async (name) => {
      if (!currentUser || (currentUser.accessStatus && currentUser.accessStatus !== 'approved')) {
        throw new Error('Your account is waiting for the teacher\'s approval.');
      }
      const problem = nameProblem(name);
      if (problem) throw new Error(problem);
      const fullName = name.trim();
      const me = currentUser.id;
      const res = await supabase.from('profiles').update({ full_name: fullName }).eq('id', me).select('id');
      check(res);
      if (!res.data?.length) throw new Error('Your name could not be saved. Please try again.');
      // Every name on this device comes from profiles: show the new one right away, then refetch.
      setProfiles((all) => all.map((u) => (u.id === me ? { ...u, name: fullName } : u)));
      load().catch(() => {});
    },
    addHomework: async (input) => {
      // Students and mentors submit, only to courses they are a listener of, for an assignment of that course, once
      // per assignment (ARU-32; also enforced by RLS and a unique index).
      const student = requireRole('student', 'mentor');
      if (!courseMembers.some((m) => m.courseId === input.courseId && m.userId === student.id)) {
        throw new Error('You are not a listener of this course.');
      }
      // Before uploading the photo, so a rejected send leaves no stray file. A row with this form's id is an
      // earlier attempt that already saved: done.
      const sent = rows<{ id: string }>(
        await supabase
          .from('homework')
          .select('id')
          .eq('assignment_id', input.assignmentId)
          .eq('student_id', student.id),
      );
      if (sent.some((h) => h.id === input.id)) {
        await load();
        return;
      }
      if (sent.length > 0) throw new Error(ALREADY_SENT);
      let photoPath: string | null = null;
      if (input.photoUri) {
        const file = await fetch(input.photoUri).then((r) => r.arrayBuffer());
        // Named after the homework id, so a retry finds the photo it already uploaded.
        photoPath = `${student.id}/${input.id}.jpg`;
        const upload = await supabase.storage.from('homework').upload(photoPath, file, { contentType: 'image/jpeg' });
        if (upload.error && !/already exists/i.test(upload.error.message)) throw new Error(upload.error.message);
      }
      const res = await supabase.from('homework').insert({
        id: input.id,
        student_id: student.id,
        course_id: input.courseId,
        assignment_id: input.assignmentId,
        title: input.title.trim(),
        description: input.description.trim(),
        photo_path: photoPath,
      });
      // A duplicate is either this form's earlier attempt (saved: fine) or another homework for the assignment.
      if (res.error?.code === '23505' && !(await rowExists('homework', input.id))) {
        if (photoPath) await supabase.storage.from('homework').remove([photoPath]);
        throw new Error(ALREADY_SENT);
      }
      checkInsert(res);
      await load();
    },
    addAssignment: async (input) => {
      const owner = requireRole('teacher', 'mentor');
      if (input.dueAt && new Date(input.dueAt).getTime() <= Date.now()) throw new Error(DEADLINE_PAST);
      const res = await supabase.from('homework_assignments').insert({
        id: input.id,
        meeting_id: input.meetingId,
        course_id: input.courseId,
        title: input.title.trim(),
        description: input.description.trim(),
        due_at: input.dueAt ?? null,
        created_by: owner.id,
      });
      if (res.error?.code === '23505' && !(await rowExists('homework_assignments', input.id))) {
        throw new Error('This meeting already has homework.');
      }
      checkInsert(res);
      await load();
    },
    checkHomework: async (id, comment) => {
      // Any mentor or the teacher checks, never their own homework (also enforced by RLS).
      const mentor = requireRole('mentor', 'teacher');
      if (homework.find((h) => h.id === id)?.studentId === mentor.id) throw new Error('You cannot check your own homework.');
      check(
        await supabase
          .from('homework')
          .update({
            status: 'checked',
            checked_by: mentor.id,
            checked_at: new Date().toISOString(),
            mentor_comment: comment.trim() || null,
          })
          .eq('id', id),
      );
      await load();
    },
    getPhotoUrl,
    addMaterial: async (input) => {
      // Teacher or mentor; teacher_id is the author's id (column name kept for history).
      const author = requireRole('teacher', 'mentor');
      check(
        await supabase.from('materials').insert({
          teacher_id: author.id,
          title: input.title.trim(),
          body: input.body.trim(),
          link: input.link?.trim() || null,
        }),
      );
      await load();
    },
    addCourse: async (input) => {
      const creator = requireRole('teacher', 'mentor');
      checkInsert(
        await supabase.from('courses').insert({
          id: input.id,
          title: input.title.trim(),
          description: input.description.trim(),
          created_by: creator.id,
          // Hidden courses (ARU-40): RLS shows them only to the owner, listeners and the teacher.
          hidden: !!input.hidden,
          // ARU-63: only sent when chosen, so creating a course works before 0031 runs.
          ...(input.disciplineId ? { discipline_id: input.disciplineId } : {}),
        }),
      );
      await load();
    },
    addDiscipline: async ({ id, name, hidden }) => {
      requireRole('teacher');
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Enter a name for the discipline.');
      if (trimmed.length > DISCIPLINE_NAME_MAX) {
        throw new Error(`A discipline name can be at most ${DISCIPLINE_NAME_MAX} characters.`);
      }
      const res = await supabase.from('disciplines').insert({ id, name: trimmed, hidden });
      // The unique name index answers both "already exists" and a retry of a create that went through (AC 1).
      if (res.error?.code === '23505') throw new Error(DUPLICATE_DISCIPLINE);
      check(res);
      await load();
    },
    setDisciplineHidden: async (id, hidden) => {
      requireRole('teacher');
      const res = await supabase.from('disciplines').update({ hidden }).eq('id', id).select('id');
      check(res);
      if (!res.data?.length) throw new Error('Discipline not found.');
      await load();
    },
    setCourseDiscipline: async (courseId, disciplineId) => {
      requireRole('teacher', 'mentor');
      check(await supabase.rpc('set_course_discipline', { course: courseId, discipline: disciplineId }));
      await load();
    },
    changeCourseOwner: async (courseId, userId) => {
      requireRole('teacher', 'mentor');
      // Idempotent on the server: a retry after a lost response is a no-op.
      check(await supabase.rpc('change_course_owner', { course: courseId, new_owner: userId }));
      await load();
    },
    addListeners: async (courseId, userIds) => {
      const adder = requireRole('teacher', 'mentor');
      if (!userIds.length) return;
      // One insert, so it is all or nothing. A duplicate key on retry means an earlier attempt saved it.
      checkInsert(
        await supabase
          .from('course_members')
          .insert(userIds.map((userId) => ({ course_id: courseId, user_id: userId, added_by: adder.id }))),
      );
      await load();
    },
    countListenerHomework: async (courseId, userId) => {
      requireRole('teacher', 'mentor');
      return rows<ListenerHomeworkRow>(
        await supabase.rpc('listener_homework_photos', { course: courseId, member: userId }),
      ).length;
    },
    removeListener: async (courseId, userId) => {
      requireRole('teacher', 'mentor');
      // 1. Which homework (and photos) go away. Security definer: works even for homework the caller can't read.
      const items = rows<ListenerHomeworkRow>(
        await supabase.rpc('listener_homework_photos', { course: courseId, member: userId }),
      );
      // 2. Photos first: Supabase only deletes storage objects through the Storage API. If this fails,
      //    nothing else has changed. Deleting a photo that is already gone is not an error (retry).
      const paths = items.map((i) => i.photo_path).filter((p): p is string => !!p);
      if (paths.length) check(await supabase.storage.from('homework').remove(paths));
      // 3. Homework and membership in one transaction. If this fails after step 2, the listener stays with
      //    their homework minus photos, and tapping "Remove" again finishes the job.
      check(await supabase.rpc('remove_listener', { course: courseId, member: userId }));
      await load();
    },
    deleteCourse: async (courseId) => {
      requireRole('teacher');
      await deleteWithHomeworkPhotos('course_homework_photos', 'delete_course', { course: courseId }, 'course');
      // Not awaited, so the caller can navigate away before the screen turns into "Course not found".
      load().catch(() => {});
    },
    deleteDiscipline: async (disciplineId) => {
      requireRole('teacher');
      await deleteWithHomeworkPhotos(
        'discipline_homework_photos',
        'delete_discipline',
        { discipline: disciplineId },
        'discipline',
      );
      load().catch(() => {});
    },
    deleteMaterial: async (id) => {
      requireRole('teacher', 'mentor');
      // RLS turns a forbidden delete into "0 rows, no error" (e.g. a mentor just made a student), so ask for the
      // deleted row back and treat none as a refusal instead of a silent success.
      const deleted = rows<{ id: string }>(await supabase.from('materials').delete().eq('id', id).select('id'));
      if (!deleted.length) {
        await load();
        throw new Error('You can no longer delete this material.');
      }
      await load();
    },
    addMaterialFile: async (input, { isCancelled = () => false } = {}) => {
      const author = requireRole('teacher', 'mentor');
      const fieldsError = fileFieldsError(input);
      if (fieldsError) throw new Error(fieldsError);
      if (!isAllowedPdf(input.file)) throw new Error(PDF_RULE);
      // A row with this id is an earlier attempt that already saved: done.
      if (rows<{ id: string }>(await supabase.from('material_files').select('id').eq('id', input.id)).length) {
        await load();
        return;
      }
      const file = await fetch(input.file.uri).then((r) => r.arrayBuffer());
      // The picker may not know the size: check what was actually read.
      if (!file.byteLength || file.byteLength > PDF_MAX_BYTES) throw new Error(PDF_RULE);
      // Named after the item id, so a retry finds the file it already uploaded.
      const path = `${author.id}/${input.id}.pdf`;
      const bucket = supabase.storage.from('materials');
      const upload = await bucket.upload(path, file, { contentType: 'application/pdf' });
      if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw new Error(upload.error.message);
      const discard = async () => {
        await supabase.from('material_files').delete().eq('id', input.id);
        await bucket.remove([path]);
      };
      if (isCancelled()) {
        await discard();
        return;
      }
      checkInsert(
        await supabase.from('material_files').insert({
          id: input.id,
          author_id: author.id,
          name: input.name.trim(),
          description: input.description.trim(),
          course_id: input.courseId ?? null,
          // "No course" is always Everyone (ARU-42).
          course_only: !!input.courseId && !!input.courseOnly,
          storage_path: path,
          size_bytes: file.byteLength,
        }),
      );
      // Left while the row was being saved: take it back out.
      if (isCancelled()) await discard();
      await load();
    },
    updateMaterialFile: async (id, input) => {
      requireRole('teacher', 'mentor');
      const fieldsError = fileFieldsError(input);
      if (fieldsError) throw new Error(fieldsError);
      // RLS turns a forbidden update into "0 rows, no error": ask for the row back and treat none as a refusal.
      const updated = rows<{ id: string }>(
        await supabase
          .from('material_files')
          .update({
            name: input.name.trim(),
            description: input.description.trim(),
            course_id: input.courseId ?? null,
            course_only: !!input.courseId && !!input.courseOnly,
          })
          .eq('id', id)
          .select('id'),
      );
      await load();
      if (!updated.length) throw new Error('You can no longer edit this file.');
    },
    deleteMaterialFile: async (id) => {
      requireRole('teacher', 'mentor');
      const item = materialFiles.find((f) => f.id === id);
      if (!item) throw new Error('Material not found');
      // PDF first (removing a file that is already gone is not an error), then the row.
      check(await supabase.storage.from('materials').remove([item.storagePath]));
      const deleted = rows<{ id: string }>(await supabase.from('material_files').delete().eq('id', id).select('id'));
      await load();
      if (!deleted.length) throw new Error('You can no longer delete this file.');
    },
    getMaterialFileUrl: async (storagePath) => {
      const { data, error } = await supabase.storage.from('materials').createSignedUrl(storagePath, 60);
      if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No file link.');
      return data.signedUrl;
    },
    addMeeting: async (input) => {
      const owner = requireRole('teacher', 'mentor');
      checkInsert(
        await supabase.from('course_meetings').insert({
          id: input.id,
          course_id: input.courseId,
          starts_at: input.startsAt,
          // The topic can't be blank in the database: an empty field means the default.
          topic: input.topic.trim() || 'Meeting',
          location: input.location.trim() || null,
          created_by: owner.id,
        }),
      );
      await load();
    },
    setMeetingStatus: async (id, status) => {
      requireRole('teacher', 'mentor');
      check(await supabase.rpc('set_meeting_status', { meeting: id, new_status: status }));
      await load();
    },
    updateMeeting: async (id, input) => {
      requireRole('teacher', 'mentor');
      check(
        await supabase.rpc('update_meeting', {
          meeting: id,
          new_starts_at: input.startsAt,
          new_topic: input.topic,
          new_location: input.location,
        }),
      );
      await load();
    },
    setMeetingNotes: async (id, notes) => {
      requireRole('teacher', 'mentor');
      if (notes.length > NOTES_MAX) throw new Error('Notes can be at most 10,000 characters.');
      check(await supabase.rpc('set_meeting_notes', { meeting: id, new_notes: notes }));
      await load();
    },
    setMeetingHomeworkChecked: async (id, checked) => {
      requireRole('teacher', 'mentor');
      check(await supabase.rpc('set_meeting_homework_checked', { meeting: id, checked }));
      await load();
    },
    markAttendance: async (meetingId) => {
      check(await supabase.rpc('mark_attendance', { meeting: meetingId }));
      await load();
    },
    unmarkAttendance: async (meetingId) => {
      check(await supabase.rpc('unmark_attendance', { meeting: meetingId }));
      await load();
    },
    likeMaterial: async (materialId) => {
      // user_id defaults to the caller; a duplicate key means an earlier tap already saved it.
      checkInsert(await supabase.from('material_likes').insert({ material_id: materialId }));
      await load();
    },
    unlikeMaterial: async (materialId) => {
      if (!userId) throw new Error('Please sign in again.');
      // Deleting nothing (already removed elsewhere) is fine.
      check(await supabase.from('material_likes').delete().eq('material_id', materialId).eq('user_id', userId));
      await load();
    },
    saveFeedback: async ({ id, courseId, rating, body }) => {
      const text = body.trim();
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Choose 1 to 5 stars.');
      if (!text) throw new Error('Write a few words about the course.');
      if (text.length > FEEDBACK_MAX) throw new Error('Feedback can be at most 1,000 characters.');
      if (id) {
        // An edit that matches no row: the user was removed as a listener (or deleted it on another device).
        const res = await supabase.from('course_feedback').update({ rating, body: text }).eq('id', id).select('id');
        checkFeedback(res);
        if (!res.data?.length) {
          await load().catch(() => {});
          throw new Error(NO_LONGER_LISTENER);
        }
      } else {
        // user_id defaults to the caller.
        checkFeedback(await supabase.from('course_feedback').insert({ course_id: courseId, rating, body: text }));
      }
      await load();
    },
    deleteFeedback: async (id) => {
      const res = await supabase.from('course_feedback').delete().eq('id', id).select('id');
      check(res);
      // Nothing deleted: either already gone (fine), or it is still there and the user can't delete it any more.
      if (!res.data?.length) {
        const still = await supabase.from('course_feedback').select('id').eq('id', id);
        if (still.data?.length) {
          await load().catch(() => {});
          throw new Error(NO_LONGER_LISTENER);
        }
      }
      await load();
    },
    loadMessages: async (courseId, before) => {
      let query = supabase
        .from('course_messages')
        .select('*')
        .eq('course_id', courseId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGES_PAGE + 1);
      if (before) {
        // Stable cursor: older timestamp, or the same timestamp with a smaller id.
        query = query.or(
          `created_at.lt."${before.createdAt}",and(created_at.eq."${before.createdAt}",id.lt.${before.id})`,
        );
      }
      const list = rows<MessageRow>(await query).map(toMessage);
      return { messages: list.slice(0, MESSAGES_PAGE), hasMore: list.length > MESSAGES_PAGE };
    },
    sendMessage: async ({ id, courseId, body }) => {
      if (!currentUser) throw new Error('Please sign in again.');
      checkInsert(
        await supabase.from('course_messages').insert({ id, course_id: courseId, author_id: currentUser.id, body: body.trim() }),
      );
    },
    subscribeToMessages: (courseId, onMessage) => {
      const channel = supabase
        .channel(`chat-${courseId}-${Math.random().toString(36).slice(2)}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'course_messages', filter: `course_id=eq.${courseId}` },
          (payload) => onMessage(toMessage(payload.new as MessageRow)),
        )
        .subscribe();
      return () => {
        supabase.removeChannel(channel);
      };
    },
    loadGeneralMessages: async (before) => {
      let query = supabase
        .from('general_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGES_PAGE + 1);
      if (before) {
        // Same stable cursor as the course chat: older timestamp, or the same timestamp with a smaller id.
        query = query.or(
          `created_at.lt."${before.createdAt}",and(created_at.eq."${before.createdAt}",id.lt.${before.id})`,
        );
      }
      const list = rows<GeneralMessageRow>(await query).map(toGeneralMessage);
      return { messages: list.slice(0, MESSAGES_PAGE), hasMore: list.length > MESSAGES_PAGE };
    },
    sendGeneralMessage: async ({ id, body }) => {
      if (!currentUser) throw new Error('Please sign in again.');
      checkInsert(await supabase.from('general_messages').insert({ id, author_id: currentUser.id, body: body.trim() }));
    },
    subscribeToGeneralMessages: (onMessage) => {
      const channel = supabase
        .channel(`general-chat-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'general_messages' }, (payload) =>
          onMessage(toGeneralMessage(payload.new as GeneralMessageRow)),
        )
        .subscribe();
      return () => {
        supabase.removeChannel(channel);
      };
    },
    courseBilling,
    setAccountant: async (userId, on) => {
      requireRole('teacher');
      check(await supabase.rpc('set_accountant', { target: userId, on_off: on }));
      // profiles is not in realtime: refetch so the switch shows the saved value.
      await load();
    },
    selectPaidCourse: async (courseId, startDay, endDay) => {
      requireRole('mentor');
      const problem = periodProblem(startDay, endDay);
      if (problem) throw new Error(problem);
      // A duplicate means another accountant selected it first: their period stays and nobody gets an error.
      checkInsert(await supabase.from('course_billing').insert({ course_id: courseId, start_day: startDay, end_day: endDay }));
      await load();
    },
    setBillingPeriod: async (courseId, startDay, endDay) => {
      requireRole('teacher', 'mentor');
      const problem = periodProblem(startDay, endDay);
      if (problem) throw new Error(problem);
      const res = await supabase
        .from('course_billing')
        .update({ start_day: startDay, end_day: endDay })
        .eq('course_id', courseId)
        .select('course_id');
      check(res);
      if (!res.data?.length) throw new Error('This course is no longer a paid course.');
      await load();
    },
    unselectPaidCourse: async (courseId) => {
      requireRole('mentor');
      check(await supabase.from('course_billing').delete().eq('course_id', courseId));
      await load();
    },
    coursePayments,
    paymentExemptions,
    markPaid: async (courseId, member, month) => {
      requireRole('teacher', 'mentor');
      if (!/^\d{4}-\d{2}-01$/.test(month)) throw new Error('Invalid month.');
      // marked_by and marked_at are set by the server. A duplicate means it's already marked: a safe retry.
      checkInsert(await supabase.from('course_payments').insert({ course_id: courseId, user_id: member, month }));
      await load();
    },
    undoPaid: async (courseId, member, month) => {
      requireRole('teacher', 'mentor');
      // Deleting nothing (already undone elsewhere) is fine.
      check(
        await supabase
          .from('course_payments')
          .delete()
          .eq('course_id', courseId)
          .eq('user_id', member)
          .eq('month', month),
      );
      await load();
    },
    setExempt: async (courseId, member, exempt) => {
      requireRole('teacher', 'mentor');
      if (exempt) {
        checkInsert(await supabase.from('course_payment_exemptions').insert({ course_id: courseId, user_id: member }));
      } else {
        check(await supabase.from('course_payment_exemptions').delete().eq('course_id', courseId).eq('user_id', member));
      }
      await load();
    },
    loadPaymentDues: async (today) => {
      if (!userId) return [];
      const res = await supabase.rpc('my_payment_dues', { today });
      check(res);
      return ((res.data as DueRow[] | null) ?? []).map((r) => ({
        courseId: r.course_id,
        deadline: String(r.deadline).slice(0, 10),
      }));
    },
    setUserRole: async (userId, role) => {
      requireRole('teacher');
      check(await supabase.rpc('set_user_role', { target: userId, new_role: role }));
      // profiles is not in realtime: refetch so the user moves to their new section.
      await load();
    },
    telegram,
    loadTelegram,
    createTelegramLinkCode: async () => {
      const res = await supabase.rpc('create_telegram_link_code');
      check(res);
      if (typeof res.data !== 'string' || !res.data) throw new Error('Could not get a Telegram link. Try again.');
      return res.data;
    },
    setTelegramNotification: async (kind, enabled) => {
      check(await supabase.rpc('set_telegram_notification', { kind, enabled }));
      await loadTelegram();
    },
    disconnectTelegram: async () => {
      check(await supabase.rpc('disconnect_telegram'));
      setTelegram(null);
    },
    accessRequests,
    setAccessStatus: async (target, status) => {
      requireRole('teacher');
      check(await supabase.rpc('set_access_status', { target, new_status: status }));
      await load();
    },
    unreadCount: (courseId) => (courseId === activeChat ? 0 : (unread[courseId] ?? 0)),
    markChatRead,
    setActiveChat,
    generalUnreadCount: generalChatOpen ? 0 : generalUnread,
    markGeneralChatRead,
    setGeneralChatOpen,
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}
