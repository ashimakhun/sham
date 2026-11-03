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
};

/** ARU-65: a paid course and its monthly payment period (days 1-28, start <= end; the deadline is endDay). */
export type CourseBilling = {
  courseId: string;
  startDay: number;
  endDay: number;
  selectedById: string;
  selectedAt: string;
};

/** ARU-66: a listener marked Paid for a month (`month` is the first day, YYYY-MM-01). Accountants and the teacher. */
export type CoursePayment = {
  courseId: string;
  userId: string;
  month: string;
  markedById: string;
  markedAt: string;
};

/** ARU-66: a listener who doesn't pay for a course until cleared. Accountants and the teacher. */
export type PaymentExemption = {
  courseId: string;
  userId: string;
};

/** ARU-66: one of the signed-in listener's own due courses (from my_payment_dues). `deadline` is YYYY-MM-DD. */
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
  status: HomeworkStatus;
  createdAt: string;
  checkedById?: string;
  checkedAt?: string;
  mentorComment?: string;
  /** The assignment it was sent for (ARU-32); undefined for homework sent before assignments existed. */
  assignmentId?: string;
};

/** Homework assigned to a completed meeting (ARU-32): at most one per meeting, for every listener of the course. */
export type HomeworkAssignment = {
  id: string;
  meetingId: string;
  courseId: string;
  title: string;
  description: string;
  /** ISO timestamp; undefined = no deadline. Late homework is still accepted. */
  dueAt?: string;
  createdById: string;
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
  createdById: string;
  createdAt: string;
};

/** A listener of a course (students and mentors; never the course owner or the teacher). */
export type CourseMember = {
  courseId: string;
  userId: string;
  addedById: string;
  addedAt: string;
};

/** A message in a course's group chat (ARU-8). */
/** A message in any chat: the course chat (ARU-8) or the general chat (ARU-61). */
export type ChatMessage = {
  id: string;
  authorId: string;
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
  createdById: string;
  createdAt: string;
  statusChangedById?: string;
  statusChangedAt?: string;
  /** Set when the start time was changed at least once (ARU-15). */
  rescheduledAt?: string;
  /** Notes on a Completed meeting (ARU-28): Markdown subset (src/lib/markdown.ts); undefined = none. */
  notes?: string;
  notesUpdatedById?: string;
  notesUpdatedAt?: string;
  /** ARU-60: a Completed meeting's homework was marked checked (moves it to MEETING HISTORY); undefined = not yet. */
  homeworkCheckedAt?: string;
  homeworkCheckedById?: string;
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
export type NewMeeting = { id: string; courseId: string; startsAt: string; topic: string; location: string };
/** `startsAt` is sent back exactly as loaded when the time wasn't changed, so it doesn't count as a reschedule. */
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
/** Types added later (ARU-84 new_account, ARU-89 homework_submitted, ARU-87 general_chat). Optional in a link's
 * switches: a missing one reads as on (the default). */
export type LaterTelegramKind = 'new_account' | 'homework_submitted' | 'general_chat';
/** Telegram notification types; each one has its own on/off switch. */
export type TelegramKind = BaseTelegramKind | LaterTelegramKind;
/** The signed-in user's link to the Sham Telegram bot (ARU-48). */
export type TelegramLink = {
  linkedAt: string;
  switches: Record<BaseTelegramKind, boolean> & Partial<Record<LaterTelegramKind, boolean>>;
};
