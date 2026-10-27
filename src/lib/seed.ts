import type { Homework, Material, User } from './types';

// Demo data used until a real backend is connected.

export const seedUsers: User[] = [
  { id: 't1', name: 'Aigerim Sadykova', role: 'teacher' },
  { id: 'm1', name: 'Daniyar Omarov', role: 'mentor' },
  { id: 'm2', name: 'Madina Akhmetova', role: 'mentor' },
  { id: 's1', name: 'Alikhan Nurlanov', role: 'student', mentorId: 'm1' },
  { id: 's2', name: 'Dana Serikova', role: 'student', mentorId: 'm1' },
  { id: 's3', name: 'Timur Bekov', role: 'student', mentorId: 'm2' },
  { id: 's4', name: 'Zarina Kassymova', role: 'student', mentorId: 'm2' },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export const seedHomework: Homework[] = [
  {
    id: 'h1',
    studentId: 's1',
    title: 'Fractions — exercises 1–10',
    description: 'Solved all ten exercises. Not sure about number 7.',
    status: 'checked',
    createdAt: daysAgo(3),
    checkedById: 'm1',
    checkedAt: daysAgo(2),
    mentorComment: 'Good work! Number 7 is correct, just simplify the final answer.',
  },
  {
    id: 'h2',
    studentId: 's2',
    title: 'Essay: My favourite book',
    description: 'One page essay about "The Little Prince".',
    status: 'submitted',
    createdAt: daysAgo(1),
  },
  {
    id: 'h3',
    studentId: 's3',
    title: 'Present Perfect worksheet',
    description: 'Completed parts A and B.',
    status: 'submitted',
    createdAt: daysAgo(0),
  },
];

export const seedMaterials: Material[] = [
  {
    id: 'mat1',
    teacherId: 't1',
    title: 'Lesson 1: Introduction to fractions',
    body: 'A fraction shows a part of a whole. The top number is the numerator, the bottom number is the denominator.\n\nRead pages 12–15 and do exercises 1–10.',
    createdAt: daysAgo(4),
  },
  {
    id: 'mat2',
    teacherId: 't1',
    title: 'Grammar: Present Perfect',
    body: 'We use Present Perfect for experiences and for actions that started in the past and continue now.\n\nWatch the video and complete the worksheet.',
    link: 'https://learnenglish.britishcouncil.org/grammar/english-grammar-reference/present-perfect',
    createdAt: daysAgo(2),
  },
];
