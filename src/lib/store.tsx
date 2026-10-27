import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from './supabase';
import type { Homework, Material, NewHomework, NewMaterial, User } from './types';

// All data access goes through this context. Row-level security in Supabase
// (supabase/migrations) decides what each role can read and change; the role
// checks here only keep the UI honest.

type Store = {
  ready: boolean;
  session: Session | null;
  currentUser: User | null;
  users: User[];
  materials: Material[];
  /** Homework the current user is allowed to see, newest first. */
  visibleHomework: Homework[];
  loading: boolean;
  /** True once data has been fetched (successfully or not) for the signed-in user. */
  dataLoaded: boolean;
  refresh: () => Promise<void>;
  getUser: (id: string | undefined) => User | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  addHomework: (input: NewHomework) => Promise<void>;
  checkHomework: (id: string, comment: string) => Promise<void>;
  addMaterial: (input: NewMaterial) => Promise<void>;
  deleteMaterial: (id: string) => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

type ProfileRow = { id: string; full_name: string; role: User['role']; mentor_id: string | null };
type HomeworkRow = {
  id: string;
  student_id: string;
  title: string;
  description: string;
  photo_path: string | null;
  status: Homework['status'];
  checked_by: string | null;
  checked_at: string | null;
  mentor_comment: string | null;
  created_at: string;
};
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
  mentorId: r.mentor_id ?? undefined,
});

const toHomework = (r: HomeworkRow): Homework => ({
  id: r.id,
  studentId: r.student_id,
  title: r.title,
  description: r.description,
  photoPath: r.photo_path ?? undefined,
  status: r.status,
  createdAt: r.created_at,
  checkedById: r.checked_by ?? undefined,
  checkedAt: r.checked_at ?? undefined,
  mentorComment: r.mentor_comment ?? undefined,
});

const toMaterial = (r: MaterialRow): Material => ({
  id: r.id,
  teacherId: r.teacher_id,
  title: r.title,
  body: r.body,
  link: r.link ?? undefined,
  createdAt: r.created_at,
});

type Result = { error: { message: string } | null };

function check(res: Result) {
  if (res.error) throw new Error(res.error.message);
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
      const [profiles, hw, mats] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, mentor_id').order('full_name'),
        supabase.from('homework').select('*').order('created_at', { ascending: false }),
        supabase.from('materials').select('*').order('created_at', { ascending: false }),
      ]);
      setUsers(rows<ProfileRow>(profiles).map(toUser));
      setHomework(await withSignedPhotoUrls(rows<HomeworkRow>(hw).map(toHomework)));
      setMaterials(rows<MaterialRow>(mats).map(toMaterial));
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const currentUser = users.find((u) => u.id === userId) ?? null;
  const getUser = useCallback((id: string | undefined) => users.find((u) => u.id === id), [users]);
  const visibleHomework = useMemo(
    () => [...homework].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [homework],
  );

  const requireRole = (role: User['role']) => {
    if (currentUser?.role !== role) throw new Error(`Only a ${role} can do this.`);
    return currentUser;
  };

  const store: Store = {
    ready,
    session,
    currentUser,
    users,
    materials,
    visibleHomework,
    loading,
    dataLoaded: !!userId && loadedFor === userId,
    refresh,
    getUser,
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
      const student = requireRole('student');
      let photoPath: string | null = null;
      if (input.photoUri) {
        const file = await fetch(input.photoUri).then((r) => r.arrayBuffer());
        photoPath = `${student.id}/${Date.now()}.jpg`;
        check(await supabase.storage.from('homework').upload(photoPath, file, { contentType: 'image/jpeg' }));
      }
      check(
        await supabase.from('homework').insert({
          student_id: student.id,
          title: input.title.trim(),
          description: input.description.trim(),
          photo_path: photoPath,
        }),
      );
      await load();
    },
    checkHomework: async (id, comment) => {
      const mentor = requireRole('mentor');
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
    addMaterial: async (input) => {
      const teacher = requireRole('teacher');
      check(
        await supabase.from('materials').insert({
          teacher_id: teacher.id,
          title: input.title.trim(),
          body: input.body.trim(),
          link: input.link?.trim() || null,
        }),
      );
      await load();
    },
    deleteMaterial: async (id) => {
      requireRole('teacher');
      check(await supabase.from('materials').delete().eq('id', id));
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
