export type Role = 'teacher' | 'mentor' | 'student';

/** ARU-43: only approved accounts can use the app. Missing means approved (before the migration). */
export type AccessStatus = 'pending' | 'approved' | 'rejected';

export type User = {
  id: string;
  name: string;
  role: Role;
  accessStatus?: AccessStatus;
  /** ARU-65: a mentor whom the teacher made an accountant. */
  isAccountant?: boolean;
  /** ARU-108: the language chosen in Profile; undefined = never chose (follow the phone). */
  language?: 'en' | 'ru';
};

/** ARU-65: a paid course and its monthly payment period (days 1-28, start <= end; the deadline is endDay). */
export type CourseBilling = {
  courseId: string;
  startDay: number;
  endDay: number;
  /** Null when the accountant who selected it deleted their account (ARU-75). */
  selectedById: string | null;
  selectedAt: string;
};

/** ARU-66: a listener marked Paid for a month (`month` is the first day, YYYY-MM-01). Accountants and the teacher. */
export type CoursePayment = {
  courseId: string;
  userId: string;
  month: string;
  /** Null when the person who marked it deleted their account (ARU-75). */
  markedById: string | null;
  markedAt: string;
};

/** ARU-66: a listener who doesn't pay for a course until cleared. Accountants and the teacher. */
export type PaymentExemption = {
  courseId: string;
  userId: string;
};

/** ARU-66: one of the signed-in listener's own due courses (from my_payment_dues). `deadline` is YYYY-MM-DD. */
/** ARU-99: a listener's payment request for one paid course and month (YYYY-MM-01), with one proof. */
export type PaymentRequest = {
  id: string;
  courseId: string;
  userId: string;
  month: string;
  /** Path in the private "payment-proofs" bucket: "<user id>/<file id>.<jpg|pdf>". */
  proofPath: string;
  proofType: 'image' | 'pdf';
  sentAt: string;
};

/** ARU-99: a proof picked on the Pay screen, before it is sent. */
export type PickedProof = {
  uri: string;
  kind: 'image' | 'pdf';
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
};

export type PaymentDue = {
  courseId: string;
  deadline: string;
};

/** A new account waiting for the teacher, or one the teacher declined (ARU-43). Teacher only. */
export type AccessRequest = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  status: Exclude<AccessStatus, 'approved'>;
};

/** ARU-146: the Create account choice: start a new workspace (and become its teacher) or join one with its code. */
export type WorkspaceChoice = { kind: 'create'; name: string } | { kind: 'join'; code: string };

/** ARU-146: the teacher's workspace and its invite code (Manage roles). */
export type WorkspaceInvite = { name: string; inviteCode: string };

export type HomeworkStatus = 'submitted' | 'checked';

export type Homework = {
  id: string;
  /** Who submitted it: a listener of the course (student or mentor). */
  studentId: string;
  /** Course the homework was submitted for; undefined for homework created before courses existed. */
  courseId?: string;
  title: string;
  description: string;
  /** Path in the "homework" storage bucket. */
  photoPath?: string;
  /** Short-lived signed URL for displaying the photo. */
  photoUrl?: string;
  /** When the daily job removed the photo, 6 months after checking (ARU-112); photoPath is then empty. */
  photoRemovedAt?: string;
  status: HomeworkStatus;
  createdAt: string;
  checkedById?: string;
  checkedAt?: string;
  mentorComment?: string;
  /** The assignment it was sent for (ARU-32); undefined for homework sent before assignments existed. */
  assignmentId?: string;
};

/** ARU-130: how many current listeners sent homework for an assignment, out of all current listeners. Counts only. */
export type AssignmentSentCount = { sent: number; listeners: number };

/** Homework assigned to a completed meeting (ARU-32): at most one per meeting, for every listener of the course. */
export type HomeworkAssignment = {
  id: string;
  meetingId: string;
  courseId: string;
  title: string;
  description: string;
  /** ISO timestamp; undefined = no deadline. Late homework is still accepted. */
  dueAt?: string;
  /** Null when the creator deleted their account (ARU-75). */
  createdById: string | null;
  createdAt: string;
};

export type Material = {
  id: string;
  teacherId: string;
  title: string;
  body: string;
  link?: string;
  createdAt: string;
};

/** A Knowledge base PDF (ARU-30). */
export type MaterialFile = {
  id: string;
  authorId: string;
  name: string;
  description: string;
  courseId?: string;
  /** Only people in the linked course (its owner and listeners), the author and the teacher see it (ARU-42). */
  courseOnly?: boolean;
  storagePath: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type Course = {
  id: string;
  title: string;
  description: string;
  /** The course's current owner (ARU-9): always a teacher or mentor; the creator unless reassigned. DB: created_by. */
  createdById: string;
  createdAt: string;
  /** Hidden course (ARU-40): only its owner, its listeners and the teacher can see it. DB: hidden. */
  hidden?: boolean;
  /** ARU-63: the course's discipline, if any. An id the viewer can't resolve is a discipline hidden from them. */
  disciplineId?: string;
};

/** ARU-63: a group of courses, created by the teacher. Hidden ones are visible only to the teacher. */
export type Discipline = {
  id: string;
  name: string;
  hidden: boolean;
  /** Null when the creator deleted their account (ARU-75). */
  createdById: string | null;
  createdAt: string;
};

/** A listener of a course (students and mentors; never the course owner or the teacher). */
export type CourseMember = {
  courseId: string;
  userId: string;
  /** Null when the person who added the listener deleted their account (ARU-75). */
  addedById: string | null;
  addedAt: string;
};

/** A message in a course's group chat (ARU-8). */
/** A message in any chat: the course chat (ARU-8) or the general chat (ARU-61). */
export type ChatMessage = {
  id: string;
  /** Null when the author deleted their account (ARU-75): shown as "Deleted account". */
  authorId: string | null;
  body: string;
  createdAt: string;
};

export type CourseMessage = ChatMessage & { courseId: string };

/** ARU-61: a message in the general chat for every approved user. */
export type GeneralMessage = ChatMessage;

export type MeetingStatus = 'scheduled' | 'completed' | 'canceled';

/** A course meeting (ARU-10): a date and start time, no end time. */
export type Meeting = {
  id: string;
  courseId: string;
  /** ISO timestamp with time zone; shown in the viewer's time zone. */
  startsAt: string;
  topic: string;
  /** Free text: a link (http/https opens in the browser) or a place. */
  location?: string;
  status: MeetingStatus;
  /** Null when the creator deleted their account (ARU-75). */
  createdById: string | null;
  createdAt: string;
  statusChangedById?: string;
  statusChangedAt?: string;
  /** Set when the start time was changed at least once (ARU-15). */
  rescheduledAt?: string;
  /** ARU-60: a Completed meeting's homework was marked checked (moves it to MEETING HISTORY); undefined = not yet. */
  homeworkCheckedAt?: string;
  homeworkCheckedById?: string;
};

/** ARU-125: a listener's own signed notes on a Completed meeting, one per listener and meeting, read by everyone who
 *  reads the meeting's notes. */
export type MeetingListenerNote = {
  id: string;
  meetingId: string;
  courseId: string;
  /** Null when the author deleted their account (ARU-75): "Deleted account". */
  authorId: string | null;
  /** Markdown subset (src/lib/markdown.ts), stored trimmed. */
  body: string;
  createdAt: string;
  /** Later than createdAt once the text was changed: "Edited <date and time>". */
  updatedAt: string;
  /** ARU-143: published to the course's listeners, its owner and the teacher; false = only the author sees it. */
  isPublic: boolean;
};

/** A listener's self-reported attendance of a Completed meeting (ARU-33). */
export type MeetingAttendance = { meetingId: string; userId: string; markedAt: string };

/** A like on a Blog post (ARU-52): one per user and post. */
export type MaterialLike = { materialId: string; userId: string; createdAt: string };
/** A listener's rating and review of a started course (ARU-53): one per listener and course. */
export type CourseFeedback = {
  id: string;
  courseId: string;
  userId: string;
  /** 1–5 stars. */
  rating: number;
  body: string;
  createdAt: string;
  /** Equals createdAt until the first edit. */
  updatedAt: string;
};

/** `id` is generated by the screen once, so retrying after a network error never saves twice. */
/** ARU-32: homework is always sent for an assignment of the course. */
export type NewHomework = {
  id: string;
  courseId: string;
  assignmentId: string;
  title: string;
  description: string;
  photoUri?: string;
};
export type NewAssignment = {
  id: string;
  meetingId: string;
  courseId: string;
  title: string;
  description: string;
  dueAt?: string;
};
export type NewCourse = { id: string; title: string; description: string; hidden?: boolean; disciplineId?: string };
export type NewMaterial = Pick<Material, 'title' | 'body' | 'link'>;
export type NewMeeting = { id: string; courseId: string; startsAt: string; location: string };
/** `startsAt` is sent back exactly as loaded when the time wasn't changed, so it doesn't count as a reschedule. */
/** `topic` is the stored one, sent back unchanged: there is no Topic field (ARU-129). */
export type MeetingEdit = { startsAt: string; topic: string; location: string };
/** A PDF picked on the device, before upload (ARU-30). `size` and `mimeType` may be missing on some platforms. */
export type PickedFile = { uri: string; name: string; size?: number; mimeType?: string };
/** `id` is generated once per upload screen, so a retry finds the file and row it already saved. */
export type NewMaterialFile = {
  id: string;
  file: PickedFile;
  name: string;
  description: string;
  courseId?: string;
  courseOnly?: boolean;
};
export type MaterialFileEdit = { name: string; description: string; courseId?: string; courseOnly?: boolean };

/** Telegram notification types from ARU-48. */
type BaseTelegramKind = 'meeting_started' | 'new_homework' | 'homework_reviewed' | 'chat_message';
/** Types added later (ARU-84 new_account, ARU-89 homework_submitted, ARU-87 general_chat, ARU-102 new_material,
 * ARU-112 photo_deletion).
 * Optional in a link's switches: a missing one reads as on (the default). */
export type LaterTelegramKind = 'new_account' | 'homework_submitted' | 'general_chat' | 'new_material' | 'photo_deletion';
/** Telegram notification types; each one has its own on/off switch. */
export type TelegramKind = BaseTelegramKind | LaterTelegramKind;
/** The signed-in user's link to the Sham Telegram bot (ARU-48). */
export type TelegramLink = {
  linkedAt: string;
  switches: Record<BaseTelegramKind, boolean> & Partial<Record<LaterTelegramKind, boolean>>;
};
