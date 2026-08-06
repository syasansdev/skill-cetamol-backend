import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['student', 'faculty', 'admin']),
  
  // Student registration optional parameters
  registerNumber: z.string().optional(),
  departmentId: z.string().optional(),
  courseId: z.string().optional(),
  yearOfPassing: z.number().or(z.string()).optional(),
  photoUrl: z.string().optional()
});

export const createFacultySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  facultyId: z.string().optional(),
  departmentId: z.string().min(1, 'Department assignment is required'),
  role: z.string().optional(),
  subjects: z.array(z.string()).optional()
});

export const createQuestionSchema = z.object({
  subjectId: z.string().optional(),
  text: z.string().min(1, 'Question text content is required'), // Frontend uses text
  type: z.enum(['mcq', 'checkbox', 'text']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  points: z.number().min(1), // Frontend uses points
  options: z.array(z.string()).optional(),
  correctAnswer: z.union([z.string(), z.array(z.string())])
});

export const createExamSchema = z.object({
  title: z.string().min(2, 'Exam title must be specified'),
  description: z.string().optional(),
  subjectId: z.string().optional(),
  duration: z.number().min(5, 'Exam must be at least 5 minutes'),
  startTime: z.string().or(z.date()),
  endTime: z.string().or(z.date()),
  questions: z.array(z.any()), // Questions selected array
  status: z.enum(['draft', 'scheduled', 'active', 'completed']).optional()
});

export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal(''))
});
