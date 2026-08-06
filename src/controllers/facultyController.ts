import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../config/db';
import { emailService } from '../services/emailService';
import { AuthRequest } from '../middleware/auth';
import { Question } from '@prisma/client';
import { Extractor } from '../utils/extractor';

const formatPhotoUrl = (req: Request, url?: string | null) => {
  if (!url) return undefined;
  const uploadsIndex = url.indexOf('/uploads/');
  if (uploadsIndex !== -1) {
    const filename = url.substring(uploadsIndex + '/uploads/'.length);
    return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
  }
  return url;
};

export const FacultyController = {
  // 1. Get Questions
  getQuestions: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const questions = await prisma.question.findMany({
        include: { options: true },
        orderBy: { createdAt: 'desc' }
      });

      // Format questions for frontend
      const formatted = questions.map(q => {
        let correctAnswer: string | string[] = '0';
        if (q.type === 'mcq') {
          const correctIdx = q.options.findIndex(o => o.isCorrect);
          correctAnswer = correctIdx >= 0 ? String(correctIdx) : '0';
        } else if (q.type === 'checkbox') {
          correctAnswer = q.options
            .map((o, idx) => (o.isCorrect ? String(idx) : null))
            .filter((idx): idx is string => idx !== null);
        } else {
          // descriptive
          correctAnswer = '';
        }

        return {
          id: q.id,
          subjectId: q.subjectId,
          text: q.question, // map question -> text
          type: q.type,
          options: q.options.map(o => o.option), // option values as string array
          correctAnswer,
          points: q.marks, // map marks -> points
          difficulty: q.difficulty,
          uploadedDocumentId: q.uploadedDocumentId || undefined,
          createdAt: q.createdAt
        };
      });

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 2. Create Single Question
  createQuestion: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { subjectId, text, type, options, correctAnswer, points, difficulty } = req.body;

      // Find faculty ID
      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });

      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found' });
      }

      // Create Question
      const q = await prisma.question.create({
        data: {
          question: text,
          type,
          difficulty,
          marks: points,
          facultyId: faculty.id,
          subjectId
        }
      });

      // Create Options
      if (type !== 'text' && options && Array.isArray(options)) {
        const optionData = options.map((optVal: string, idx: number) => {
          let isCorrect = false;
          if (type === 'mcq') {
            isCorrect = String(idx) === String(correctAnswer);
          } else if (type === 'checkbox') {
            isCorrect = Array.isArray(correctAnswer) 
              ? correctAnswer.map(String).includes(String(idx))
              : String(correctAnswer) === String(idx);
          }
          return {
            questionId: q.id,
            option: optVal,
            isCorrect
          };
        });

        await prisma.questionOption.createMany({ data: optionData });
      }

      // Return newly created question in frontend format
      const enrichedQ = await prisma.question.findUnique({
        where: { id: q.id },
        include: { options: true }
      });

      return res.status(201).json({
        id: enrichedQ!.id,
        subjectId: enrichedQ!.subjectId,
        text: enrichedQ!.question,
        type: enrichedQ!.type,
        options: enrichedQ!.options.map(o => o.option),
        correctAnswer,
        points: enrichedQ!.marks,
        difficulty: enrichedQ!.difficulty,
        createdAt: enrichedQ!.createdAt
      });
    } catch (error) {
      next(error);
    }
  },

  // 3. Simulated CSV bulk upload
  importQuestions: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { questions } = req.body; // Array of question objects

      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });

      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found' });
      }

      const createdQuestions = [];

      for (const item of questions) {
        const q = await prisma.question.create({
          data: {
            question: item.text || item.question,
            type: item.type,
            difficulty: item.difficulty || 'medium',
            marks: item.points || item.marks || 5,
            facultyId: faculty.id,
            subjectId: item.subjectId
          }
        });

        if (item.type !== 'text' && item.options && Array.isArray(item.options)) {
          const optionData = item.options.map((optVal: string, idx: number) => {
            let isCorrect = false;
            if (item.type === 'mcq') {
              isCorrect = String(idx) === String(item.correctAnswer);
            } else if (item.type === 'checkbox') {
              isCorrect = Array.isArray(item.correctAnswer)
                ? item.correctAnswer.map(String).includes(String(idx))
                : String(item.correctAnswer) === String(idx);
            }
            return {
              questionId: q.id,
              option: optVal,
              isCorrect
            };
          });

          await prisma.questionOption.createMany({ data: optionData });
        }

        const fullQ = await prisma.question.findUnique({
          where: { id: q.id },
          include: { options: true }
        });

        if (fullQ) {
          createdQuestions.push({
            id: fullQ.id,
            subjectId: fullQ.subjectId,
            text: fullQ.question,
            type: fullQ.type,
            options: fullQ.options.map(o => o.option),
            correctAnswer: item.correctAnswer,
            points: fullQ.marks,
            difficulty: fullQ.difficulty,
            createdAt: fullQ.createdAt
          });
        }
      }

      return res.status(201).json(createdQuestions);
    } catch (error) {
      next(error);
    }
  },

  // 4. Get Exams
  getExams: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const exams = await prisma.exam.findMany({
        include: {
          subject: true,
          faculty: { include: { user: true } },
          examQuestions: {
            include: {
              question: {
                include: { options: true }
              }
            }
          }
        },
        orderBy: { startDate: 'desc' }
      });

      // Map to frontend expectation
      const formatted = exams.map(e => {
        const questionsMapped = e.examQuestions.map(eq => {
          const q = eq.question;
          let correctAnswer: string | string[] = '0';
          if (q.type === 'mcq') {
            const idx = q.options.findIndex(o => o.isCorrect);
            correctAnswer = idx >= 0 ? String(idx) : '0';
          } else if (q.type === 'checkbox') {
            correctAnswer = q.options
              .map((o, idx) => (o.isCorrect ? String(idx) : null))
              .filter((idx): idx is string => idx !== null);
          } else {
            correctAnswer = '';
          }

          return {
            id: q.id,
            subjectId: q.subjectId,
            text: q.question,
            type: q.type,
            options: q.options.map(o => o.option),
            correctAnswer,
            points: q.marks,
            difficulty: q.difficulty,
            createdAt: q.createdAt
          };
        });

        const now = new Date();
        let dynamicStatus = e.status;
        if (dynamicStatus === 'scheduled' || dynamicStatus === 'active' || dynamicStatus === 'completed') {
          if (now >= e.startDate && now <= e.endDate) {
            dynamicStatus = 'active';
          } else if (now > e.endDate) {
            dynamicStatus = 'completed';
          } else {
            dynamicStatus = 'scheduled';
          }
        }

        return {
          id: e.id,
          title: e.title,
          description: e.description,
          subjectId: e.subjectId,
          subjectName: `${e.subject.subjectName} (${e.subject.id.substring(0,5).toUpperCase()})`,
          duration: e.duration,
          startTime: e.startDate.toISOString(), // map startDate -> startTime
          endTime: e.endDate.toISOString(), // map endDate -> endTime
          questions: questionsMapped,
          createdBy: e.faculty.user.id,
          createdByName: e.faculty.user.name,
          status: dynamicStatus,
          questionCount: e.questionCount,
          negativeMarking: e.negativeMarking,
          marksPerQuestion: e.marksPerQuestion,
          negativeMarks: e.negativeMarks,
          createdAt: e.startDate.toISOString()
        };
      });

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 5. Create / Schedule Exam
  createExam: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const {
        title, description, subjectId, duration, startTime, endTime, questions,
        questionCount, negativeMarking, marksPerQuestion, negativeMarks
      } = req.body;

      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });

      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found' });
      }

      const questionIds = questions.map((q: any) => q.id);
      const parsedQuestionCount = Math.min(
        questionCount ? Number(questionCount) : questionIds.length,
        questionIds.length || 10
      );
      const parsedMarksPerQuestion = marksPerQuestion !== undefined ? Number(marksPerQuestion) : 1;
      const parsedNegativeMarks = negativeMarks !== undefined ? Number(negativeMarks) : 0;
      const parsedNegativeMarking = Boolean(negativeMarking);

      const totalMarks = Math.round(parsedQuestionCount * parsedMarksPerQuestion);

      let targetSubjectId = subjectId;
      if (!targetSubjectId) {
        let sub = await prisma.subject.findFirst();
        if (!sub) {
          let dept = await prisma.department.findFirst();
          if (!dept) {
            dept = await prisma.department.create({ data: { departmentName: 'General' } });
          }
          let course = await prisma.course.findFirst({ where: { departmentId: dept.id } });
          if (!course) {
            course = await prisma.course.create({ data: { courseName: 'General Evaluation Course', departmentId: dept.id } });
          }
          sub = await prisma.subject.create({ data: { subjectName: 'General Evaluation', courseId: course.id, semester: 1 } });
        }
        targetSubjectId = sub.id;
      }

      // Create Exam
      const exam = await prisma.exam.create({
        data: {
          title,
          description: description || '',
          subjectId: targetSubjectId,
          facultyId: faculty.id,
          duration: Number(duration),
          totalMarks,
          startDate: new Date(startTime),
          endDate: new Date(endTime),
          questionCount: parsedQuestionCount,
          negativeMarking: parsedNegativeMarking,
          marksPerQuestion: parsedMarksPerQuestion,
          negativeMarks: parsedNegativeMarks,
          status: 'scheduled' // defaults to scheduled
        }
      });

      // Link questions
      const relationData = questionIds.map((qId: string) => ({
        examId: exam.id,
        questionId: qId
      }));

      await prisma.examQuestion.createMany({ data: relationData });

      // Notify Students of this Course via Email
      const subject = await prisma.subject.findUnique({
        where: { id: subjectId }
      });
      if (subject) {
        const enrolledStudents = await prisma.student.findMany({
          where: { courseId: subject.courseId, user: { status: 'active' } },
          include: { user: true }
        });

        for (const std of enrolledStudents) {
          try {
            await emailService.sendExamScheduled(std.user.email, std.user.name, title, startTime);
          } catch (mailErr) {
            console.error(`Failed notifying student ${std.user.email}:`, mailErr);
          }
        }
      }

      // Format response user details matching frontend expectation
      const fullExam = await prisma.exam.findUnique({
        where: { id: exam.id },
        include: { subject: true }
      });

      return res.status(201).json({
        id: exam.id,
        title: exam.title,
        description: exam.description,
        subjectId: exam.subjectId,
        subjectName: fullExam?.subject.subjectName,
        duration: exam.duration,
        startTime: exam.startDate.toISOString(),
        endTime: exam.endDate.toISOString(),
        questions: questions,
        createdBy: req.user!.id,
        status: exam.status,
        createdAt: exam.startDate.toISOString()
      });
    } catch (error) {
      next(error);
    }
  },

  // 6. Get Exam Results for Faculty grading view
  getResults: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const results = await prisma.result.findMany({
        include: {
          student: { include: { user: true } },
          exam: { include: { subject: true } }
        },
        orderBy: { examId: 'desc' }
      });

      // Mapped response matching frontend
      const mapped = results.map(r => ({
        id: r.id,
        examId: r.examId,
        examTitle: r.exam.title,
        subjectName: r.exam.subject.subjectName,
        studentId: r.student.user.id,
        studentName: r.student.user.name,
        studentRollNo: r.student.registerNumber,
        score: Math.round((r.percentage / 100) * r.exam.totalMarks), // calculate raw score
        totalPoints: r.exam.totalMarks,
        percentage: r.percentage,
        status: r.status,
        timeTaken: 1800, // mock time taken (30 mins)
        submittedAt: r.exam.endDate.toISOString()
      }));

      return res.status(200).json(mapped);
    } catch (error) {
      next(error);
    }
  },

  // 7. Get Pending Students for Faculty approval view
  getPendingStudents: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const students = await prisma.user.findMany({
        where: {
          role: 'student',
          status: 'pending'
        },
        include: {
          student: {
            include: {
              department: true,
              course: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      const formatted = students.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        registerNumber: user.student?.registerNumber || '',
        departmentName: user.student?.department.departmentName || '',
        courseName: user.student?.course.courseName || '',
        photoUrl: formatPhotoUrl(req, user.photoUrl || user.student?.photoUrl) || '',
        createdAt: user.createdAt.toISOString()
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 8. Faculty Approves Student
  approveStudent: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id },
        include: { student: true }
      });

      if (!user) {
        return res.status(404).json({ message: 'Student user not found' });
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: { status: 'active' }
      });

      // Create log
      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Faculty approved student: ${user.name} (${user.student?.registerNumber})`
        }
      });

      // Send confirmation email
      try {
        await emailService.sendStudentApproval(user.email, user.name);
      } catch (mailErr) {
        console.error('Nodemailer student approval email failed:', mailErr);
      }

      return res.status(200).json({
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        status: updatedUser.status
      });
    } catch (error) {
      next(error);
    }
  },

  // 9. Upcoming Scheduled Exams (startDate > now, created by this faculty)
  getUpcomingExams: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });
      if (!faculty) return res.status(403).json({ message: 'Faculty not found' });

      const exams = await prisma.exam.findMany({
        where: {
          facultyId: faculty.id,
          startDate: { gte: new Date() }
        },
        include: {
          subject: {
            include: {
              course: { include: { department: true } }
            }
          },
          examQuestions: true
        },
        orderBy: { startDate: 'asc' }
      });

      const formatted = exams.map(e => ({
        id: e.id,
        title: e.title,
        description: e.description,
        subjectId: e.subjectId,
        subjectName: e.subject.subjectName,
        courseName: e.subject.course.courseName,
        departmentName: e.subject.course.department.departmentName,
        semester: e.subject.semester,
        duration: e.duration,
        startTime: e.startDate.toISOString(),
        endTime: e.endDate.toISOString(),
        totalMarks: e.totalMarks,
        questionCount: e.examQuestions.length,
        status: e.status
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 10. Pending Grading Tasks (text/descriptive answers awaiting manual marks)
  getPendingGrading: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });
      if (!faculty) return res.status(403).json({ message: 'Faculty not found' });

      // Get all exams by this faculty that have text questions
      const exams = await prisma.exam.findMany({
        where: { facultyId: faculty.id },
        include: {
          examQuestions: {
            include: { question: true }
          }
        }
      });

      const examIdsWithText = exams
        .filter(e => e.examQuestions.some(eq => eq.question.type === 'text'))
        .map(e => e.id);

      // Get submitted student exams for those exams that have ungraded text answers
      const studentExams = await prisma.studentExam.findMany({
        where: {
          examId: { in: examIdsWithText },
          status: 'submitted',
          studentAnswers: {
            some: {
              question: { type: 'text' },
              marksAwarded: 0,
              answerText: { not: null }
            }
          }
        },
        include: {
          student: { include: { user: true } },
          exam: { include: { subject: true } },
          studentAnswers: {
            where: {
              question: { type: 'text' },
              marksAwarded: 0,
              answerText: { not: null }
            },
            include: { question: true }
          }
        },
        orderBy: { submittedAt: 'desc' }
      });

      const formatted = studentExams.map(se => ({
        studentExamId: se.id,
        studentName: se.student.user.name,
        registerNumber: se.student.registerNumber,
        examId: se.examId,
        examTitle: se.exam.title,
        subjectName: se.exam.subject.subjectName,
        submittedAt: se.submittedAt?.toISOString() || se.startedAt.toISOString(),
        pendingAnswerCount: se.studentAnswers.length,
        answers: se.studentAnswers.map(sa => ({
          answerId: sa.id,
          questionId: sa.questionId,
          questionText: sa.question.question,
          maxMarks: sa.question.marks,
          answerText: sa.answerText || '',
          marksAwarded: sa.marksAwarded
        }))
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 11. Grade a single text answer + auto-publish result if all answers graded
  gradeAnswer: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { studentExamId, answerId, marksAwarded } = req.body;

      if (marksAwarded === undefined || marksAwarded < 0) {
        return res.status(400).json({ message: 'Invalid marks value' });
      }

      // Update the specific answer's marks
      await prisma.studentAnswer.update({
        where: { id: answerId },
        data: { marksAwarded }
      });

      // Check if all text answers for this studentExam are now graded
      const remaining = await prisma.studentAnswer.count({
        where: {
          studentExamId,
          question: { type: 'text' },
          marksAwarded: 0,
          answerText: { not: null }
        }
      });

      if (remaining === 0) {
        // Calculate total score across all answers (auto-graded + manual)
        const studentExam = await prisma.studentExam.findUnique({
          where: { id: studentExamId },
          include: {
            exam: true,
            student: { include: { user: true } },
            studentAnswers: true
          }
        });

        if (studentExam) {
          // Sum all marks (MCQ auto-graded + text manual)
          const totalScore = studentExam.studentAnswers.reduce(
            (acc, a) => acc + (a.marksAwarded || 0), 0
          );
          const totalMarks = studentExam.exam.totalMarks || 1;
          const percentage = Math.round((totalScore / totalMarks) * 100);

          // Grade assignment
          let grade = 'F';
          if (percentage >= 90) grade = 'A+';
          else if (percentage >= 80) grade = 'A';
          else if (percentage >= 70) grade = 'B';
          else if (percentage >= 60) grade = 'C';
          else if (percentage >= 50) grade = 'D';

          const status = percentage >= 50 ? 'pass' : 'fail';

          // Upsert result
          await prisma.result.upsert({
            where: {
              studentId_examId: {
                studentId: studentExam.studentId,
                examId: studentExam.examId
              }
            },
            create: {
              studentId: studentExam.studentId,
              examId: studentExam.examId,
              percentage,
              grade,
              status
            },
            update: { percentage, grade, status }
          });

          // Update StudentExam score
          await prisma.studentExam.update({
            where: { id: studentExamId },
            data: { score: totalScore }
          });

          // In-app notification to student
          await prisma.notification.create({
            data: {
              userId: studentExam.student.userId,
              title: 'Exam Result Published',
              message: `Your result for "${studentExam.exam.title}" has been published. Score: ${totalScore}/${totalMarks} (${percentage}%) — Grade: ${grade}`
            }
          });
        }
      }

      return res.status(200).json({
        message: 'Answer graded successfully',
        allGraded: remaining === 0
      });
    } catch (error) {
      next(error);
    }
  },

  // 12. Question Bank Statistics grouped by subject (for this faculty)
  getQuestionStats: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id },
        include: { questions: { include: { subject: true } } }
      });
      if (!faculty) return res.status(403).json({ message: 'Faculty not found' });

      // Group questions by subject
      const subjectMap = new Map<string, any>();
      for (const q of faculty.questions) {
        const sid = q.subjectId;
        if (!subjectMap.has(sid)) {
          subjectMap.set(sid, {
            subjectId: sid,
            subjectName: q.subject.subjectName,
            semester: q.subject.semester,
            courseId: q.subject.courseId,
            total: 0,
            easy: 0,
            medium: 0,
            hard: 0,
            mcq: 0,
            checkbox: 0,
            text: 0,
            totalMarks: 0,
            // monthly growth — last 6 months
            monthly: {} as Record<string, number>
          });
        }
        const entry = subjectMap.get(sid)!;
        entry.total++;
        entry[q.difficulty]++;
        entry[q.type]++;
        entry.totalMarks += q.marks;

        // Monthly bucket (YYYY-MM)
        const month = q.createdAt.toISOString().substring(0, 7);
        entry.monthly[month] = (entry.monthly[month] || 0) + 1;
      }

      const stats = Array.from(subjectMap.values()).map(s => ({
        ...s,
        monthly: Object.entries(s.monthly)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, count]) => ({ month, count }))
      }));

      return res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  },

  // 13. Get all portions (syllabus)
  getPortions: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const portions = await prisma.portion.findMany({
        include: { subject: true },
        orderBy: { createdAt: 'desc' }
      });

      const formatted = portions.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        subjectId: p.subjectId,
        subjectName: p.subject.subjectName,
        facultyId: p.facultyId,
        createdAt: p.createdAt.toISOString()
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 14. Create portion
  createPortion: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { title, description, subjectId } = req.body;
      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });

      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found' });
      }

      const portion = await prisma.portion.create({
        data: {
          title,
          description,
          subjectId,
          facultyId: faculty.id
        },
        include: { subject: true }
      });

      return res.status(201).json({
        id: portion.id,
        title: portion.title,
        description: portion.description,
        subjectId: portion.subjectId,
        subjectName: portion.subject.subjectName,
        facultyId: portion.facultyId,
        createdAt: portion.createdAt.toISOString()
      });
    } catch (error) {
      next(error);
    }
  },

  // 15. Update portion
  updatePortion: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { title, description, subjectId } = req.body;

      const portion = await prisma.portion.update({
        where: { id },
        data: {
          title,
          description,
          subjectId
        },
        include: { subject: true }
      });

      return res.status(200).json({
        id: portion.id,
        title: portion.title,
        description: portion.description,
        subjectId: portion.subjectId,
        subjectName: portion.subject.subjectName,
        facultyId: portion.facultyId,
        createdAt: portion.createdAt.toISOString()
      });
    } catch (error) {
      next(error);
    }
  },

  // 16. Delete portion
  deletePortion: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      await prisma.portion.delete({
        where: { id }
      });

      return res.status(200).json({ message: 'Portion deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  // 17. Get notes uploaded by students
  getStudentNotes: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const notes = await prisma.note.findMany({
        include: {
          student: { include: { user: true } },
          subject: true
        },
        orderBy: { createdAt: 'desc' }
      });

      const formatted = notes.map(n => ({
        id: n.id,
        title: n.title,
        content: n.content || '',
        fileUrl: n.fileUrl || '',
        fileName: n.fileName || '',
        studentId: n.studentId,
        studentName: n.student.user.name,
        studentRollNo: n.student.registerNumber,
        subjectId: n.subjectId,
        subjectName: n.subject.subjectName,
        createdAt: n.createdAt.toISOString()
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 18. Upload Q-Paper & Extract Questions
  uploadQPaper: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { name, subjectId } = req.body;
      if (!req.file) {
        return res.status(400).json({ message: 'Document file is required' });
      }
      if (!name || !subjectId) {
        return res.status(400).json({ message: 'Name and Subject ID are required' });
      }

      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });
      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found' });
      }

      // Check subject
      const subject = await prisma.subject.findUnique({
        where: { id: subjectId }
      });
      if (!subject) {
        return res.status(404).json({ message: 'Subject not found' });
      }

      const fileExtension = path.extname(req.file.originalname).toLowerCase().replace('.', '');
      let fileType: 'pdf' | 'docx' | 'csv' = 'pdf';
      if (fileExtension === 'docx') fileType = 'docx';
      else if (fileExtension === 'csv') fileType = 'csv';
      else if (fileExtension !== 'pdf') {
        return res.status(400).json({ message: 'Unsupported file format. Please upload PDF, Word (.docx), or CSV.' });
      }

      // Parse questions
      let parsedQuestions: any[] = [];
      if (fileType === 'pdf') {
        const text = await Extractor.extractTextFromPDF(req.file.buffer);
        parsedQuestions = Extractor.parseUnstructuredQuestions(text);
      } else if (fileType === 'docx') {
        const text = await Extractor.extractTextFromDOCX(req.file.buffer);
        parsedQuestions = Extractor.parseUnstructuredQuestions(text);
      } else if (fileType === 'csv') {
        const text = req.file.buffer.toString('utf-8');
        parsedQuestions = Extractor.parseCSVQuestions(text);
      }

      if (parsedQuestions.length === 0) {
        return res.status(400).json({ message: 'No questions could be extracted from the uploaded document. Please check the document format.' });
      }

      // Write physical file to uploads directory
      const uploadDir = path.resolve(__dirname, '../../uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const uniqueFilename = `qpaper-${Date.now()}-${Math.round(Math.random() * 1e9)}.${fileExtension}`;
      const filePath = path.join(uploadDir, uniqueFilename);
      fs.writeFileSync(filePath, req.file.buffer);

      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${uniqueFilename}`;

      // Start transaction to save document and questions
      const result = await prisma.$transaction(async (tx) => {
        // 1. Create UploadedDocument
        const doc = await tx.uploadedDocument.create({
          data: {
            name,
            fileUrl,
            fileType,
            facultyId: faculty.id,
            subjectId
          }
        });

        // 2. Create extracted questions
        for (const q of parsedQuestions) {
          await tx.question.create({
            data: {
              question: q.question,
              type: q.type,
              difficulty: q.difficulty,
              marks: q.marks,
              subjectId,
              facultyId: faculty.id,
              uploadedDocumentId: doc.id,
              options: {
                create: q.options.map((opt: any) => ({
                  option: opt.option,
                  isCorrect: opt.isCorrect
                }))
              }
            }
          });
        }

        return doc;
      });

      return res.status(201).json({
        message: `Successfully uploaded document and extracted ${parsedQuestions.length} questions.`,
        document: {
          ...result,
          questionCount: parsedQuestions.length,
          subjectName: subject.subjectName
        }
      });
    } catch (error) {
      next(error);
    }
  },

  // 19. Get Uploaded Q-Papers list
  getUploadedQPapers: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });
      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found' });
      }

      const docs = await prisma.uploadedDocument.findMany({
        where: { facultyId: faculty.id },
        include: {
          subject: true,
          questions: true
        },
        orderBy: { createdAt: 'desc' }
      });

      const formatted = docs.map(d => ({
        id: d.id,
        name: d.name,
        fileUrl: d.fileUrl,
        fileType: d.fileType as 'pdf' | 'docx' | 'csv',
        facultyId: d.facultyId,
        subjectId: d.subjectId,
        subjectName: d.subject.subjectName,
        createdAt: d.createdAt.toISOString(),
        questionCount: d.questions.length
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 20. Get Questions for a specific Q-Paper
  getQPaperQuestions: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const questions = await prisma.question.findMany({
        where: { uploadedDocumentId: id },
        include: { options: true },
        orderBy: { createdAt: 'asc' }
      });

      const formatted = questions.map(q => {
        let correctAnswer: string | string[] = '0';
        if (q.type === 'mcq') {
          const correctIdx = q.options.findIndex(o => o.isCorrect);
          correctAnswer = correctIdx >= 0 ? String(correctIdx) : '0';
        } else if (q.type === 'checkbox') {
          correctAnswer = q.options
            .map((o, idx) => (o.isCorrect ? String(idx) : null))
            .filter((idx): idx is string => idx !== null);
        } else {
          correctAnswer = '';
        }

        return {
          id: q.id,
          question: q.question,
          type: q.type as 'mcq' | 'checkbox' | 'text',
          difficulty: q.difficulty as 'easy' | 'medium' | 'hard',
          marks: q.marks,
          subjectId: q.subjectId,
          options: q.options.map(o => o.option),
          correctAnswer
        };
      });

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 21. Delete an Uploaded Q-Paper
  deleteUploadedQPaper: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const doc = await prisma.uploadedDocument.findUnique({
        where: { id }
      });
      if (!doc) {
        return res.status(404).json({ message: 'Uploaded document not found' });
      }

      // Try deleting the physical file
      try {
        const filename = doc.fileUrl.split('/uploads/')[1];
        if (filename) {
          const filePath = path.resolve(__dirname, '../../uploads', filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      } catch (fileErr) {
        console.error('Failed to delete physical file:', fileErr);
      }

      // Delete UploadedDocument record
      await prisma.uploadedDocument.delete({
        where: { id }
      });

      return res.status(200).json({ message: 'Uploaded document and extracted questions deleted successfully.' });
    } catch (error) {
      next(error);
    }
  },

  // 22. Generate Questions using AI
  generateAIQuestions: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { subjectId, topic, count, difficulty } = req.body;
      if (!subjectId || !topic) {
        return res.status(400).json({ message: 'Subject and topic are required' });
      }

      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });
      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found' });
      }

      const tLower = topic.toLowerCase();
      let rawQs: { q: string; opts: string[]; correct: number }[] = [];

      if (tLower.includes('sort') || tLower.includes('algorithm')) {
        rawQs = [
          {
            q: `What is the average time complexity of the Quick Sort algorithm?`,
            opts: ['O(n)', 'O(n log n)', 'O(n^2)', 'O(log n)'],
            correct: 1
          },
          {
            q: `Which sorting algorithm is stable and has a worst-case complexity of O(n log n)?`,
            opts: ['Quick Sort', 'Bubble Sort', 'Merge Sort', 'Selection Sort'],
            correct: 2
          },
          {
            q: `In binary search, what is the maximum number of comparisons for an array of size 1024?`,
            opts: ['10', '1024', '512', '1'],
            correct: 0
          }
        ];
      } else if (tLower.includes('database') || tLower.includes('sql') || tLower.includes('query')) {
        rawQs = [
          {
            q: `Which SQL constraint uniquely identifies each record in a database table?`,
            opts: ['FOREIGN KEY', 'UNIQUE', 'PRIMARY KEY', 'CHECK'],
            correct: 2
          },
          {
            q: `What does ACID stand for in database transaction management?`,
            opts: [
              'Atomicity, Consistency, Isolation, Durability',
              'Accuracy, Complexity, Integrity, Dependency',
              'Aggregation, Concurrency, Indexing, Distribution',
              'Allocation, Collection, Intersection, Definition'
            ],
            correct: 0
          },
          {
            q: `Which SQL join returns all records when there is a match in either left or right table?`,
            opts: ['LEFT JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'INNER JOIN'],
            correct: 2
          }
        ];
      } else if (tLower.includes('network') || tLower.includes('ip') || tLower.includes('tcp') || tLower.includes('web')) {
        rawQs = [
          {
            q: `Which layer of the OSI model is responsible for routing packets across networks?`,
            opts: ['Data Link Layer', 'Network Layer', 'Transport Layer', 'Session Layer'],
            correct: 1
          },
          {
            q: `What is the default port number used by HTTP secure communication (HTTPS)?`,
            opts: ['80', '443', '22', '8080'],
            correct: 1
          },
          {
            q: `What protocol is responsible for translating domain names to IP addresses?`,
            opts: ['DHCP', 'DNS', 'FTP', 'SMTP'],
            correct: 1
          }
        ];
      } else {
        rawQs = [
          {
            q: `Which of the following best describes the main purpose of ${topic}?`,
            opts: [
              `To facilitate efficiency and standard scaling of ${topic}.`,
              `To deprecate manual implementations and automate operations.`,
              `To validate inputs and log exceptions in real time.`,
              `To reduce compute complexities and hardware costs.`
            ],
            correct: 0
          },
          {
            q: `What is a primary advantage of using ${topic} in large-scale system deployments?`,
            opts: [
              'Lower latency and high isolation bounds.',
              'Increased storage overhead and data duplication.',
              'Deprecation of modular system architecture.',
              'Reduced security compliance standards.'
            ],
            correct: 0
          },
          {
            q: `In the context of modern architectures, how is ${topic} typically structured?`,
            opts: [
              'As a single massive monolith framework.',
              'As a set of decoupled, modular components.',
              'As an unstructured collection of static assets.',
              'As a legacy client-side presentation layer.'
            ],
            correct: 1
          }
        ];
      }

      const limit = Math.min(count || 3, rawQs.length);
      const chosen = rawQs.slice(0, limit);

      const createdQuestions = [];

      for (const item of chosen) {
        const q = await prisma.question.create({
          data: {
            question: item.q,
            type: 'mcq',
            difficulty: difficulty || 'medium',
            marks: difficulty === 'easy' ? 2 : difficulty === 'medium' ? 4 : 6,
            facultyId: faculty.id,
            subjectId: subjectId
          }
        });

        const optionData = item.opts.map((opt, idx) => ({
          questionId: q.id,
          option: opt,
          isCorrect: idx === item.correct
        }));

        await prisma.questionOption.createMany({ data: optionData });

        const fullQ = await prisma.question.findUnique({
          where: { id: q.id },
          include: { options: true }
        });
        createdQuestions.push(fullQ);
      }

      return res.status(201).json({
        message: `Successfully generated ${createdQuestions.length} questions using AI for topic "${topic}".`,
        questions: createdQuestions
      });
    } catch (error) {
      next(error);
    }
  }
};
