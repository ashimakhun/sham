import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { NOTES_MAX } from './markdown';
import { supabase } from './supabase';
import type {
  Course,
  CourseMember,
  CourseMessage,
  Homework,
  HomeworkAssignment,
  Material,
  Meeting,
  MeetingEdit,
  MeetingStatus,
  NewCourse,
  NewAssignment,
  NewHomework,
  NewMaterial,
  NewMeeting,
  User,
} from './types';

// All data access goes through this context. Row-level security in Supabase
// (supabase/migrations) decides what each role can read and change; the role
// checks here only keep the UI honest.

type Store = {
  ready: boolean;
  session: Session | null;
  currentUser: User | null;
  users: User[];
  materials: Material[];
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
  loading: boolean;
  /** True once data has been fetched (successfully or not) for the signed-in user. */
  dataLoaded: boolean;
  refresh: () => Promise<void>;
  getUser: (id: string | undefined) => User | undefined;
  getCourse: (id: string | undefined) => Course | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
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
  deleteMaterial: (id: string) => Promise<void>;
  /** Course owner or teacher (also enforced by RLS). `id` is generated once per form, so a retry saves once. */
  addMeeting: (input: NewMeeting) => Promise<void>;
  /** Course owner or teacher: Scheduled -> completed (after the start) or canceled. Final; a retry is a no-op. */
  setMeetingStatus: (id: string, status: Exclude<MeetingStatus, 'scheduled'>) => Promise<void>;
  /** Course owner or teacher, Scheduled meetings only (ARU-15). A changed start must be in the future. */
  updateMeeting: (id: string, input: MeetingEdit) => Promise<void>;
  /** Course owner or teacher, Completed meetings only (ARU-28). Blank text removes the notes. */
  setMeetingNotes: (id: string, notes: string) => Promise<void>;
  /** Course chat (ARU-8): a page of messages, newest first, older than `before` when given. */
  loadMessages: (courseId: string, before?: CourseMessage) => Promise<{ messages: CourseMessage[]; hasMore: boolean }>;
  /** Posts as the current user. `id` is generated once per message so a retry cannot post twice. */
  sendMessage: (input: { id: string; courseId: string; body: string }) => Promise<void>;
  /** Live inserts for one course's chat (its own channel, not the global refetch). Returns an unsubscribe. */
  subscribeToMessages: (courseId: string, onMessage: (m: CourseMessage) => void) => () => void;
  /** Teacher only (ARU-13): switches a user between student and mentor via set_user_role(), then refetches. */
  setUserRole: (userId: string, role: 'student' | 'mentor') => Promise<void>;
};

export const MESSAGES_PAGE = 50;

const StoreContext = createContext<Store | null>(null);

type ProfileRow = { id: string; full_name: string; role: User['role'] };
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
};
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
};
type MessageRow = { id: string; course_id: string; author_id: string; body: string; created_at: string };
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
});

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
  const [users, setUsers] = useState<User[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseMembers, setCourseMembers] = useState<CourseMember[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [assignments, setAssignments] = useState<HomeworkAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

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
        setUsers([]);
        setHomework([]);
        setMaterials([]);
        setCourses([]);
        setCourseMembers([]);
        setMeetings([]);
        setAssignments([]);
        setLoadedFor(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Fetches everything the signed-in user may see. State is only set after the
  // awaits, so it is safe to call from an effect.
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [profiles, hw, mats, crs, members, mtgs, asgs] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role').order('full_name'),
        supabase.from('homework').select('*').order('created_at', { ascending: false }),
        supabase.from('materials').select('*').order('created_at', { ascending: false }),
        supabase.from('courses').select('*').order('created_at', { ascending: false }),
        supabase.from('course_members').select('*'),
        supabase.from('course_meetings').select('*').order('starts_at'),
        supabase.from('homework_assignments').select('*').order('created_at', { ascending: false }),
      ]);
      setUsers(rows<ProfileRow>(profiles).map(toUser));
      setHomework(await withSignedPhotoUrls(rows<HomeworkRow>(hw).map(toHomework)));
      setMaterials(rows<MaterialRow>(mats).map(toMaterial));
      setCourses(rows<CourseRow>(crs).map(toCourse));
      setCourseMembers(rows<CourseMemberRow>(members).map(toCourseMember));
      setMeetings(rows<MeetingRow>(mtgs).map(toMeeting));
      setAssignments(rows<AssignmentRow>(asgs).map(toAssignment));
    } finally {
      setLoadedFor(userId);
    }
  }, [userId]);

  /** User-triggered reload (pull to refresh, retry) with a spinner. */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await load();
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    load().catch(() => {});
    // Live updates: refetch when someone submits, checks or shares something.
    const channel = supabase
      .channel('sham-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_members' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_meetings' }, () => load().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework_assignments' }, () =>
        load().catch(() => {}),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const currentUser = users.find((u) => u.id === userId) ?? null;
  const getUser = useCallback((id: string | undefined) => users.find((u) => u.id === id), [users]);
  const sortedCourses = useMemo(
    () => [...courses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [courses],
  );
  const getCourse = useCallback((id: string | undefined) => courses.find((c) => c.id === id), [courses]);
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
    courses: sortedCourses,
    courseMembers,
    visibleHomework,
    meetings,
    assignments,
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
        }),
      );
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
    setUserRole: async (userId, role) => {
      requireRole('teacher');
      check(await supabase.rpc('set_user_role', { target: userId, new_role: role }));
      // profiles is not in realtime: refetch so the user moves to their new section.
      await load();
    },
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}
