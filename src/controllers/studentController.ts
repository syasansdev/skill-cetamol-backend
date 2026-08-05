import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db';
import { emailService } from '../services/emailService';
import { AuthRequest } from '../middleware/auth';

export const StudentController = {
  // 1. Get Exams for Student Dashboard
  getExams: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const allExams = await prisma.exam.findMany({
        where: {
          subject: {
            courseId: student.courseId
          }
        },
        include: {
          subject: true,
          faculty: { include: { user: true } },
          examQuestions: {
            include: {
              question: { include: { options: true } }
            }
          }
        },
        orderBy: { startDate: 'desc' }
      });

      const results = await prisma.result.findMany({
        where: { studentId: student.id }
      });

      const studentExams = await prisma.studentExam.findMany({
        where: { studentId: student.id }
      });

      const studentExamIds = studentExams.map(se => se.id);
      const allAnswers = await prisma.studentAnswer.findMany({
        where: { studentExamId: { in: studentExamIds } }
      });

      // Helper function for deterministic shuffle based on seed
      function pseudoRandomShuffle<T>(array: T[], seedStr: string): T[] {
        const result = [...array];
        let seed = 0;
        for (let i = 0; i < seedStr.length; i++) {
          seed = (seed << 5) - seed + seedStr.charCodeAt(i);
          seed |= 0;
        }
        let m = result.length, t, i;
        while (m) {
          seed = (seed * 9301 + 49297) % 233280;
          i = Math.floor((seed / 233280) * m--);
          t = result[m];
          result[m] = result[i];
          result[i] = t;
        }
        return result;
      }

      // Format exams mapping them to frontend structure
      const formatted = allExams.map(exam => {
        const resultObj = results.find(r => r.examId === exam.id);
        const attempt = studentExams.find(se => se.examId === exam.id);
        
        const savedAnswers: Record<string, string | string[]> = {};
        if (attempt) {
          const attemptAnswers = allAnswers.filter(ans => ans.studentExamId === attempt.id);
          attemptAnswers.forEach(ans => {
            if (ans.selectedOption !== null) {
              const parts = ans.selectedOption.split(',');
              savedAnswers[ans.questionId] = parts.length > 1 ? parts : parts[0];
            } else if (ans.answerText !== null) {
              savedAnswers[ans.questionId] = ans.answerText;
            }
          });
        }

        // Randomize questions for this student attempt
        const attemptSeed = attempt ? new Date(attempt.startedAt).getTime() : Date.now();
        const seedStr = `${student.id}-${exam.id}-${attemptSeed}`;
        const shuffledEqs = pseudoRandomShuffle(exam.examQuestions, seedStr);
        const questionLimit = exam.questionCount || 10;
        const selectedEqs = shuffledEqs.slice(0, Math.min(questionLimit, shuffledEqs.length));

        const questionsMapped = selectedEqs.map(eq => {
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
            points: exam.marksPerQuestion || q.marks || 1,
            difficulty: q.difficulty,
            createdAt: q.createdAt
          };
        });

        const totalExamMarks = Math.round(questionsMapped.length * (exam.marksPerQuestion || 1));
        const rawScore = resultObj ? Math.round((resultObj.percentage / 100) * totalExamMarks) : null;

        const now = new Date();
        let dynamicStatus = exam.status;
        if (dynamicStatus === 'scheduled' || dynamicStatus === 'active' || dynamicStatus === 'completed') {
          if (now >= exam.startDate && now <= exam.endDate) {
            dynamicStatus = 'active';
          } else if (now > exam.endDate) {
            dynamicStatus = 'completed';
          } else {
            dynamicStatus = 'scheduled';
          }
        }

        return {
          id: exam.id,
          title: exam.title,
          description: exam.description,
          subjectId: exam.subjectId,
          subjectName: `${exam.subject.subjectName} (${exam.subject.id.substring(0, 5).toUpperCase()})`,
          duration: exam.duration,
          startTime: exam.startDate.toISOString(),
          endTime: exam.endDate.toISOString(),
          questions: questionsMapped,
          questionCount: exam.questionCount || questionsMapped.length,
          negativeMarking: exam.negativeMarking,
          marksPerQuestion: exam.marksPerQuestion,
          negativeMarks: exam.negativeMarks,
          totalMarks: totalExamMarks,
          createdBy: exam.faculty.user.id,
          createdByName: exam.faculty.user.name,
          status: dynamicStatus,
          createdAt: exam.startDate.toISOString(),
          // Attempt details
          hasAttempted: !!resultObj,
          resultId: resultObj?.id || null,
          score: rawScore,
          percentage: resultObj ? Math.round(resultObj.percentage) : null,
          resultStatus: resultObj?.status || null,
          attemptStatus: attempt ? attempt.status : null,
          warningCount: attempt ? attempt.warningCount : 0,
          timeRemaining: attempt ? attempt.timeRemaining : exam.duration * 60,
          reentryAllowed: attempt ? attempt.reentryAllowed : false,
          savedAnswers
        };
      });

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 2. Submit Exam & Auto-Evaluate Score
  submitExam: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const examId = req.params.id;
      const { answers, timeTaken } = req.body; // answers is Record<questionId, selectedOptionIdx | optionIdx[] | descriptiveText>

      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id },
        include: { user: true }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const exam = await prisma.exam.findUnique({
        where: { id: examId },
        include: {
          subject: true,
          examQuestions: {
            include: {
              question: { include: { options: true } }
            }
          }
        }
      });

      if (!exam) {
        return res.status(404).json({ message: 'Exam details not found' });
      }

      // Check if already attempted
      const existingAttempt = await prisma.studentExam.findUnique({
        where: {
          studentId_examId: {
            studentId: student.id,
            examId: exam.id
          }
        }
      });
      if (existingAttempt && existingAttempt.status === 'submitted') {
        return res.status(400).json({ message: 'Exam session already submitted and graded' });
      }

      let score = 0;
      let correctCount = 0;
      let wrongCount = 0;
      let skippedCount = 0;

      // 1. Create or update StudentExam log
      let studentExam = existingAttempt;
      if (!studentExam) {
        studentExam = await prisma.studentExam.create({
          data: {
            studentId: student.id,
            examId: exam.id,
            status: 'submitted',
            score: 0
          }
        });
      }

      const marksPerQ = exam.marksPerQuestion || 1;
      const negMarks = exam.negativeMarking ? (exam.negativeMarks || 0) : 0;

      // 2. Grade each question present in submission/exam pool
      const answerInserts = [];

      for (const eq of exam.examQuestions) {
        const q = eq.question;
        const studentAns = answers[q.id];

        let isCorrect = false;
        let selectedOption = null;
        let answerText = null;
        let marksAwarded = 0;

        if (studentAns === undefined || studentAns === '' || (Array.isArray(studentAns) && studentAns.length === 0)) {
          skippedCount++;
        } else {
          if (q.type === 'mcq') {
            selectedOption = String(studentAns);
            const correctOptIdx = q.options.findIndex(o => o.isCorrect);
            isCorrect = String(correctOptIdx) === String(studentAns);
          } else if (q.type === 'checkbox') {
            const studentIndices = Array.isArray(studentAns) ? studentAns.map(String).sort() : [String(studentAns)];
            selectedOption = studentIndices.join(',');

            const correctIndices = q.options
              .map((o, idx) => (o.isCorrect ? String(idx) : null))
              .filter((x): x is string => x !== null)
              .sort();

            isCorrect = JSON.stringify(studentIndices) === JSON.stringify(correctIndices);
          } else if (q.type === 'text') {
            answerText = String(studentAns);
            const studentText = answerText.trim().toLowerCase();
            isCorrect = studentText.length > 0;
          }

          if (isCorrect) {
            score += marksPerQ;
            correctCount++;
            marksAwarded = marksPerQ;
          } else {
            wrongCount++;
            if (negMarks > 0) {
              score -= negMarks;
              marksAwarded = -negMarks;
            }
          }
        }

        answerInserts.push({
          studentExamId: studentExam.id,
          questionId: q.id,
          selectedOption,
          answerText,
          marksAwarded
        });
      }

      // Save StudentAnswers details
      await prisma.studentAnswer.createMany({ data: answerInserts });

      // Clip final score at 0
      const finalScore = Math.max(0, score);

      // Update StudentExam raw score
      await prisma.studentExam.update({
        where: { id: studentExam.id },
        data: { score: finalScore, submittedAt: new Date() }
      });

      // Calculate percentage and status
      const totalPoints = exam.totalMarks || 10;
      const percentage = Math.max(0, Math.round((finalScore / totalPoints) * 100));
      const status = percentage >= 40 ? 'pass' : 'fail';

      // 3. Create/Save Result record
      const result = await prisma.result.create({
        data: {
          studentId: student.id,
          examId: exam.id,
          percentage,
          status,
          grade: percentage >= 90 ? 'A+' : percentage >= 80 ? 'A' : percentage >= 60 ? 'B' : percentage >= 40 ? 'C' : 'F'
        }
      });

      // Calculate Rank for this exam attempt
      const allExamResults = await prisma.result.findMany({
        where: { examId: exam.id },
        orderBy: [{ percentage: 'desc' }]
      });

      // Find Rank
      const rankIdx = allExamResults.findIndex(r => r.id === result.id) + 1;
      await prisma.result.update({
        where: { id: result.id },
        data: { rank: rankIdx }
      });

      // Dispatch score notification email
      try {
        await emailService.sendResultPublished(student.user.email, student.user.name, exam.title, score, totalPoints);
      } catch (mailErr) {
        console.error('Nodemailer evaluation mail failed:', mailErr);
      }

      // Return frontend styled output
      return res.status(201).json({
        id: result.id,
        examId: exam.id,
        examTitle: exam.title,
        subjectName: exam.subject.subjectName,
        studentId: student.user.id,
        studentName: student.user.name,
        studentRollNo: student.registerNumber,
        score,
        totalPoints,
        percentage,
        status,
        answers,
        timeTaken,
        correctCount,
        wrongCount,
        skippedCount,
        submittedAt: result.id, // placeholder mapping
        rank: rankIdx
      });
    } catch (error) {
      next(error);
    }
  },

  // 3. Get Student Results List
  getResults: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const results = await prisma.result.findMany({
        where: { studentId: student.id },
        include: {
          exam: { include: { subject: true } }
        },
        orderBy: { examId: 'desc' }
      });

      // Map to frontend response format
      const formatted = results.map(r => {
        return {
          id: r.id,
          examId: r.examId,
          examTitle: r.exam.title,
          subjectName: r.exam.subject.subjectName,
          studentId: req.user!.id,
          studentName: req.user!.email, // simple fallback
          studentRollNo: student.registerNumber,
          score: Math.round((r.percentage / 100) * r.exam.totalMarks),
          totalPoints: r.exam.totalMarks,
          percentage: r.percentage,
          status: r.status,
          timeTaken: 1200, // mock duration details
          correctCount: 2,
          wrongCount: 0,
          skippedCount: 0,
          submittedAt: r.exam.endDate.toISOString(),
          rank: r.rank || 1
        };
      });

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 4. Get Individual Result Details
  getResultDetails: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const resultId = req.params.id;

      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const result = await prisma.result.findFirst({
        where: {
          id: resultId,
          studentId: student.id
        },
        include: {
          exam: {
            include: {
              subject: true,
              examQuestions: { include: { question: { include: { options: true } } } }
            }
          }
        }
      });

      if (!result) {
        return res.status(404).json({ message: 'Evaluation results not found' });
      }

      // Fetch answers details
      const studentExam = await prisma.studentExam.findFirst({
        where: { studentId: student.id, examId: result.examId },
        include: { studentAnswers: true }
      });

      let correctCount = 0;
      let wrongCount = 0;
      let skippedCount = 0;
      const answersMapped: Record<string, string | string[]> = {};

      if (studentExam) {
        studentExam.studentAnswers.forEach(ans => {
          const isCorrect = ans.marksAwarded > 0;
          if (ans.selectedOption === null && ans.answerText === null) {
            skippedCount++;
          } else if (isCorrect) {
            correctCount++;
          } else {
            wrongCount++;
          }

          if (ans.selectedOption !== null) {
            const parts = ans.selectedOption.split(',');
            answersMapped[ans.questionId] = parts.length > 1 ? parts : parts[0];
          } else if (ans.answerText !== null) {
            answersMapped[ans.questionId] = ans.answerText;
          }
        });
      }

      const detailedQuestions = result.exam.examQuestions.map(eq => {
        const q = eq.question;
        const studentAns = studentExam?.studentAnswers.find(sa => sa.questionId === q.id);

        let studentOption: string | string[] | null = null;
        if (studentAns) {
          if (studentAns.selectedOption !== null) {
            const parts = studentAns.selectedOption.split(',');
            studentOption = parts.length > 1 ? parts : parts[0];
          } else if (studentAns.answerText !== null) {
            studentOption = studentAns.answerText;
          }
        }

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

        const isCorrect = studentAns ? studentAns.marksAwarded > 0 : false;

        return {
          id: q.id,
          text: q.question,
          type: q.type,
          options: q.options.map(o => o.option),
          correctAnswer,
          studentOption,
          isCorrect,
          marksAwarded: studentAns ? studentAns.marksAwarded : 0,
          difficulty: q.difficulty
        };
      });

      return res.status(200).json({
        id: result.id,
        examId: result.examId,
        examTitle: result.exam.title,
        subjectName: result.exam.subject.subjectName,
        studentId: req.user!.id,
        studentName: req.user!.email,
        studentRollNo: student.registerNumber,
        score: Math.round((result.percentage / 100) * result.exam.totalMarks),
        totalPoints: result.exam.totalMarks,
        percentage: result.percentage,
        status: result.status,
        answers: answersMapped,
        detailedQuestions,
        timeTaken: 1200,
        correctCount,
        wrongCount,
        skippedCount,
        submittedAt: result.exam.endDate.toISOString(),
        rank: result.rank || 1
      });
    } catch (error) {
      next(error);
    }
  },

  // 5. Autosave exam answers and remaining time
  autoSaveExam: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const examId = req.params.id;
      const { answers, timeRemaining } = req.body;

      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      // Upsert studentExam
      let studentExam = await prisma.studentExam.findUnique({
        where: {
          studentId_examId: {
            studentId: student.id,
            examId
          }
        }
      });

      if (studentExam && studentExam.status === 'LOCKED') {
        return res.status(403).json({ message: 'This examination has been locked.' });
      }

      if (!studentExam) {
        studentExam = await prisma.studentExam.create({
          data: {
            studentId: student.id,
            examId,
            status: 'started',
            timeRemaining: timeRemaining || 0
          }
        });
      } else {
        studentExam = await prisma.studentExam.update({
          where: { id: studentExam.id },
          data: {
            timeRemaining: timeRemaining || studentExam.timeRemaining
          }
        });
      }

      // Save Student Answers: Delete existing for this exam and insert
      await prisma.studentAnswer.deleteMany({
        where: { studentExamId: studentExam.id }
      });

      const answerData = Object.keys(answers).map(qId => {
        const studentAns = answers[qId];
        let selectedOption = null;
        let answerText = null;

        if (Array.isArray(studentAns)) {
          selectedOption = studentAns.map(String).join(',');
        } else if (typeof studentAns === 'string') {
          if (/^\d+$/.test(studentAns)) {
            selectedOption = studentAns;
          } else {
            answerText = studentAns;
          }
        }

        return {
          studentExamId: studentExam!.id,
          questionId: qId,
          selectedOption,
          answerText
        };
      });

      if (answerData.length > 0) {
        await prisma.studentAnswer.createMany({ data: answerData });
      }

      return res.status(200).json({ message: 'Answers autosaved successfully', timeRemaining: studentExam.timeRemaining });
    } catch (error) {
      next(error);
    }
  },

  // 6. Log Proctor Warning/Tab-switch event
  logProctorEvent: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const examId = req.params.id;
      const { eventType, warningCount } = req.body;

      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id },
        include: { user: true }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const exam = await prisma.exam.findUnique({ where: { id: examId } });
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      let studentExam = await prisma.studentExam.findUnique({
        where: {
          studentId_examId: {
            studentId: student.id,
            examId
          }
        }
      });

      if (!studentExam) {
        studentExam = await prisma.studentExam.create({
          data: {
            studentId: student.id,
            examId,
            status: 'started',
            warningCount: warningCount || 0
          }
        });
      } else {
        const updateData: any = {
          warningCount: warningCount || studentExam.warningCount
        };

        if (warningCount >= 3) {
          updateData.status = 'LOCKED';
          updateData.lockReason = 'MALPRACTICE_EXCEEDED';
          updateData.lockedAt = new Date();
        }

        studentExam = await prisma.studentExam.update({
          where: { id: studentExam.id },
          data: updateData
        });
      }

      const actionMessage = studentExam.status === 'LOCKED'
        ? `Student ${student.user.name} (${student.registerNumber}) exam LOCKED due to 3rd malpractice warning`
        : `Student ${student.user.name} (${student.registerNumber}) triggered tab switch proctor warning ${warningCount}`;

      await prisma.activityLog.create({
        data: {
          userId: student.userId,
          action: actionMessage
        }
      });

      if (studentExam.status === 'LOCKED') {
        const admins = await prisma.user.findMany({ where: { role: 'admin' } });
        for (const admin of admins) {
          await prisma.notification.create({
            data: {
              userId: admin.id,
              title: 'Proctor Lock Triggered',
              message: `Student ${student.user.name} has been locked out of exam "${exam.title}" due to multiple tab switches.`
            }
          });
        }
      }

      return res.status(200).json({
        status: studentExam.status,
        warningCount: studentExam.warningCount
      });
    } catch (error) {
      next(error);
    }
  },

  // 7. Get student's subjects based on their enrolled course
  getSubjects: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });
      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const subjects = await prisma.subject.findMany({
        where: { courseId: student.courseId }
      });

      const formatted = subjects.map(s => ({
        id: s.id,
        name: s.subjectName,
        code: s.subjectName.split(' ').map(x => x[0]).join('').toUpperCase(),
        courseId: s.courseId
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 8. Get portions for student's subjects
  getPortions: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });
      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const portions = await prisma.portion.findMany({
        where: {
          subject: { courseId: student.courseId }
        },
        include: {
          subject: true
        },
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

  // 9. Get notes uploaded by this student
  getNotes: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });
      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const notes = await prisma.note.findMany({
        where: { studentId: student.id },
        include: { subject: true },
        orderBy: { createdAt: 'desc' }
      });

      const formatted = notes.map(n => ({
        id: n.id,
        title: n.title,
        content: n.content || '',
        fileUrl: n.fileUrl || '',
        fileName: n.fileName || '',
        studentId: n.studentId,
        subjectId: n.subjectId,
        subjectName: n.subject.subjectName,
        createdAt: n.createdAt.toISOString()
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 10. Upload/Create a note
  createNote: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { title, content, subjectId } = req.body;
      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      let fileUrl = null;
      let fileName = null;

      if (req.file) {
        fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        fileName = req.file.originalname;
      }

      const note = await prisma.note.create({
        data: {
          title,
          content: content || null,
          fileUrl,
          fileName,
          studentId: student.id,
          subjectId
        },
        include: { subject: true }
      });

      return res.status(201).json({
        id: note.id,
        title: note.title,
        content: note.content || '',
        fileUrl: note.fileUrl || '',
        fileName: note.fileName || '',
        studentId: note.studentId,
        subjectId: note.subjectId,
        subjectName: note.subject.subjectName,
        createdAt: note.createdAt.toISOString()
      });
    } catch (error) {
      next(error);
    }
  },

  // 11. Delete a student note
  deleteNote: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const noteId = req.params.id;
      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const note = await prisma.note.findFirst({
        where: { id: noteId, studentId: student.id }
      });

      if (!note) {
        return res.status(404).json({ message: 'Note not found or unauthorized' });
      }

      await prisma.note.delete({
        where: { id: noteId }
      });

      return res.status(200).json({ message: 'Note deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
};
