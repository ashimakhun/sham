import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { seedHomework, seedMaterials, seedUsers } from './seed';
import type { Homework, Material, NewHomework, NewMaterial, User } from './types';

// Local mock store persisted on the device. All reads and writes go through this
// context, so replacing it with Supabase later only touches this file.

const STORAGE_KEY = 'sham/state/v1';

type State = {
  users: User[];
  homework: Homework[];
  materials: Material[];
  currentUserId: string | null;
};

const initialState: State = {
  users: seedUsers,
  homework: seedHomework,
  materials: seedMaterials,
  currentUserId: null,
};

type Store = State & {
  ready: boolean;
  currentUser: User | null;
  signIn: (userId: string) => void;
  signOut: () => void;
  getUser: (id: string | undefined) => User | undefined;
  /** Homework the current user is allowed to see, newest first. */
  visibleHomework: Homework[];
  addHomework: (input: NewHomework) => Homework;
  checkHomework: (id: string, comment: string) => void;
  addMaterial: (input: NewMaterial) => Material;
  deleteMaterial: (id: string) => void;
  resetDemoData: () => void;
};

const StoreContext = createContext<Store | null>(null);

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initialState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setState({ ...initialState, ...(JSON.parse(raw) as Partial<State>) });
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, ready]);

  const currentUser = state.users.find((u) => u.id === state.currentUserId) ?? null;

  const getUser = useCallback((id: string | undefined) => state.users.find((u) => u.id === id), [state.users]);

  const visibleHomework = useMemo(() => {
    if (!currentUser) return [];
    const all = [...state.homework].sort(byNewest);
    switch (currentUser.role) {
      case 'teacher':
        return all;
      case 'mentor': {
        const myStudents = new Set(state.users.filter((u) => u.mentorId === currentUser.id).map((u) => u.id));
        return all.filter((h) => myStudents.has(h.studentId));
      }
      case 'student':
        return all.filter((h) => h.studentId === currentUser.id);
    }
  }, [currentUser, state.homework, state.users]);

  const requireRole = (role: User['role']) => {
    if (currentUser?.role !== role) throw new Error(`Only a ${role} can do this.`);
    return currentUser;
  };

  const store: Store = {
    ...state,
    ready,
    currentUser,
    getUser,
    visibleHomework,
    signIn: (userId) => setState((s) => ({ ...s, currentUserId: userId })),
    signOut: () => setState((s) => ({ ...s, currentUserId: null })),
    addHomework: (input) => {
      const student = requireRole('student');
      const item: Homework = {
        id: newId('hw'),
        studentId: student.id,
        title: input.title.trim(),
        description: input.description.trim(),
        photoUri: input.photoUri,
        status: 'submitted',
        createdAt: new Date().toISOString(),
      };
      setState((s) => ({ ...s, homework: [item, ...s.homework] }));
      return item;
    },
    checkHomework: (id, comment) => {
      const mentor = requireRole('mentor');
      setState((s) => ({
        ...s,
        homework: s.homework.map((h) =>
          h.id === id
            ? {
                ...h,
                status: 'checked',
                checkedById: mentor.id,
                checkedAt: new Date().toISOString(),
                mentorComment: comment.trim() || undefined,
              }
            : h,
        ),
      }));
    },
    addMaterial: (input) => {
      const teacher = requireRole('teacher');
      const item: Material = {
        id: newId('mat'),
        teacherId: teacher.id,
        title: input.title.trim(),
        body: input.body.trim(),
        link: input.link?.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      setState((s) => ({ ...s, materials: [item, ...s.materials] }));
      return item;
    },
    deleteMaterial: (id) => {
      requireRole('teacher');
      setState((s) => ({ ...s, materials: s.materials.filter((m) => m.id !== id) }));
    },
    resetDemoData: () => setState({ ...initialState, currentUserId: state.currentUserId }),
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}
