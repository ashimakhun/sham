export type Role = 'teacher' | 'mentor' | 'student';

export type User = {
  id: string;
  name: string;
  role: Role;
  /** Students only: the mentor who checks this student's homework. */
  mentorId?: string;
};

export type HomeworkStatus = 'submitted' | 'checked';

export type Homework = {
  id: string;
  studentId: string;
  title: string;
  description: string;
  photoUri?: string;
  status: HomeworkStatus;
  createdAt: string;
  checkedById?: string;
  checkedAt?: string;
  mentorComment?: string;
};

export type Material = {
  id: string;
  teacherId: string;
  title: string;
  body: string;
  link?: string;
  createdAt: string;
};

export type NewHomework = Pick<Homework, 'title' | 'description' | 'photoUri'>;
export type NewMaterial = Pick<Material, 'title' | 'body' | 'link'>;
