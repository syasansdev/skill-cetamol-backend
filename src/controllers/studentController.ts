import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db';
import { emailService } from '../services/emailService';
import { AuthRequest } from '../middleware/auth';

import { cleanQuestionText, pseudoRandomShuffle, getAssignedExamQuestions, evaluateExamAnswers } from '../utils/examUtils';
export { cleanQuestionText, pseudoRandomShuffle, getAssignedExamQuestions };

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

      if (!student.collegeId || !student.category || !student.departmentId) {
        return res.status(200).json([]);
      }

      const collegeExams = await prisma.exam.findMany({
        where: {
          OR: [
            { collegeId: student.collegeId },
            { collegeId: null }
          ]
        },
        include: {
          college: true,
          department: true,
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

      // Determine student academic year (1..4)
      const currentYear = new Date().getFullYear();
      let studentAcademicYear = 1;
      if (student.year) {
        if (student.year <= 4) {
          studentAcademicYear = student.year;
        } else {
          studentAcademicYear = Math.min(4, Math.max(1, 4 - (student.year - currentYear)));
        }
      }

      const allExams = collegeExams.filter(exam => {
        // 1. Department check via TARGET_DEPTS metadata tag
        const deptMatch = exam.description?.match(/<!-- TARGET_DEPTS:(.*?) -->/);
        let deptAllowed = false;
        if (deptMatch && deptMatch[1]) {
          const allowedIds = deptMatch[1].split(',').map(s => s.trim()).filter(Boolean);
          if (allowedIds.includes('all')) {
            deptAllowed = true;
          } else {
            deptAllowed = student.departmentId ? allowedIds.includes(student.departmentId) : false;
          }
        } else if (!exam.departmentId || exam.departmentId === 'all') {
          deptAllowed = true;
        } else if (exam.departmentId === student.departmentId) {
          deptAllowed = true;
        }

        if (!deptAllowed) return false;

        // 2. Year check via TARGET_YEARS metadata tag or targetYears field
        const yearMatch = exam.description?.match(/<!-- TARGET_YEARS:(.*?) -->/);
        const allowedYears = exam.targetYears
          ? exam.targetYears.split(',').map((s: string) => s.trim()).filter(Boolean)
          : (yearMatch && yearMatch[1] ? yearMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean) : ['all']);

        if (!allowedYears.includes('all')) {
          if (!allowedYears.includes(String(studentAcademicYear))) {
            return false;
          }
        }

        return true;
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

        // Deterministic question assignment for this student attempt (consistent with submit & results)
        const selectedEqs = getAssignedExamQuestions(exam, student.id);

        const questionsMapped = selectedEqs.map((eq: any) => {
          const q = eq.question;

          let correctAnswer: string | string[] = '0';
          const optionsList = [...(q.options || [])].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
          if (q.type === 'mcq') {
            const idx = optionsList.findIndex(o => o.isCorrect);
            correctAnswer = idx >= 0 ? String(idx) : '0';
          } else if (q.type === 'checkbox') {
            correctAnswer = optionsList
              .map((o, idx) => (o.isCorrect ? String(idx) : null))
              .filter((idx): idx is string => idx !== null);
          } else {
            correctAnswer = '';
          }

          return {
            id: q.id,
            subjectId: q.subjectId || '',
            text: cleanQuestionText(q.question || ''),
            type: q.type || 'mcq',
            options: optionsList.map(o => o.option),
            correctAnswer,
            points: exam.marksPerQuestion || q.marks || 1,
            difficulty: q.difficulty || 'medium',
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

        const subjectName = exam.subject
          ? `${exam.subject.subjectName} (${exam.subject.id.substring(0, 5).toUpperCase()})`
          : 'General Evaluation';
        const createdBy = exam.faculty?.user?.id || '';
        const createdByName = exam.faculty?.user?.name || 'Faculty Evaluator';

        return {
          id: exam.id,
          title: exam.title,
          description: exam.description || '',
          subjectId: exam.subjectId || '',
          subjectName,
          duration: exam.duration,
          startTime: exam.startDate ? exam.startDate.toISOString() : new Date().toISOString(),
          endTime: exam.endDate ? exam.endDate.toISOString() : new Date().toISOString(),
          questions: questionsMapped,
          questionCount: exam.questionCount || questionsMapped.length,
          negativeMarking: exam.negativeMarking,
          marksPerQuestion: exam.marksPerQuestion,
          negativeMarks: exam.negativeMarks,
          totalMarks: totalExamMarks,
          createdBy,
          createdByName,
          status: dynamicStatus,
          createdAt: exam.startDate ? exam.startDate.toISOString() : new Date().toISOString(),
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
      console.error('Error in StudentController.getExams:', error);
      next(error);
    }
  },

  // 1.1. Get Single Exam Details by ID (for student attending or refreshing)
  getExamById: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      let exam = await prisma.exam.findUnique({
        where: { id },
        include: {
          college: true,
          department: true,
          subject: true,
          faculty: { include: { user: true } },
          examQuestions: {
            include: {
              question: { include: { options: true } }
            }
          }
        }
      });

      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      // If exam has 0 questions linked, automatically link questions from subject or pool
      if (!exam.examQuestions || exam.examQuestions.length === 0) {
        let poolQs = await prisma.question.findMany({
          where: exam.subjectId ? { subjectId: exam.subjectId } : undefined,
          include: { options: true },
          take: exam.questionCount && exam.questionCount > 0 ? exam.questionCount : 10
        });
        if (poolQs.length === 0) {
          poolQs = await prisma.question.findMany({
            include: { options: true },
            take: exam.questionCount && exam.questionCount > 0 ? exam.questionCount : 10
          });
        }
        if (poolQs.length > 0) {
          await prisma.examQuestion.createMany({
            data: poolQs.map(q => ({ examId: exam.id, questionId: q.id })),
            skipDuplicates: true
          });
          const reloadedEqs = await prisma.examQuestion.findMany({
            where: { examId: exam.id },
            include: { question: { include: { options: true } } }
          });
          (exam as any).examQuestions = reloadedEqs;
        }
      }

      // Attempt details
      const attempt = await prisma.studentExam.findFirst({
        where: { studentId: student.id, examId: exam.id },
        include: { studentAnswers: true }
      });

      const resultObj = await prisma.result.findFirst({
        where: { studentId: student.id, examId: exam.id }
      });

      const savedAnswers: Record<string, string | string[]> = {};
      if (attempt?.studentAnswers) {
        attempt.studentAnswers.forEach(ans => {
          if (ans.selectedOption !== null) {
            const parts = ans.selectedOption.split(',');
            savedAnswers[ans.questionId] = parts.length > 1 ? parts : parts[0];
          } else if (ans.answerText !== null) {
            savedAnswers[ans.questionId] = ans.answerText;
          }
        });
      }
      // Deterministic question assignment for this student attempt (consistent with getExams & submitExam)
      const selectedEqs = getAssignedExamQuestions(exam, student.id);

      const questionsMapped = selectedEqs.map((eq: any) => {
        const q = eq.question;
        let correctAnswer: string | string[] = '0';
        const optionsList = [...(q.options || [])].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        if (q.type === 'mcq') {
          const idx = optionsList.findIndex(o => o.isCorrect);
          correctAnswer = idx >= 0 ? String(idx) : '0';
        } else if (q.type === 'checkbox') {
          correctAnswer = optionsList
            .map((o, idx) => (o.isCorrect ? String(idx) : null))
            .filter((idx): idx is string => idx !== null);
        } else {
          correctAnswer = '';
        }

        return {
          id: q.id,
          subjectId: q.subjectId || '',
          text: cleanQuestionText(q.question || ''),
          type: q.type || 'mcq',
          options: optionsList.map(o => o.option),
          correctAnswer,
          points: exam.marksPerQuestion || q.marks || 1,
          difficulty: q.difficulty || 'medium',
          createdAt: q.createdAt
        };
      });

      const totalExamMarks = Math.round(questionsMapped.length * (exam.marksPerQuestion || 1));
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

      const subjectName = exam.subject
        ? `${exam.subject.subjectName} (${exam.subject.id.substring(0, 5).toUpperCase()})`
        : 'General Evaluation';

      return res.status(200).json({
        id: exam.id,
        title: exam.title,
        description: exam.description || '',
        subjectId: exam.subjectId || '',
        subjectName,
        duration: exam.duration,
        startTime: exam.startDate ? exam.startDate.toISOString() : new Date().toISOString(),
        endTime: exam.endDate ? exam.endDate.toISOString() : new Date().toISOString(),
        questions: questionsMapped,
        questionCount: exam.questionCount || questionsMapped.length,
        negativeMarking: exam.negativeMarking,
        marksPerQuestion: exam.marksPerQuestion,
        negativeMarks: exam.negativeMarks,
        totalMarks: totalExamMarks,
        createdBy: exam.faculty?.user?.id || '',
        createdByName: exam.faculty?.user?.name || 'Faculty Evaluator',
        status: dynamicStatus,
        createdAt: exam.startDate ? exam.startDate.toISOString() : new Date().toISOString(),
        hasAttempted: !!resultObj,
        resultId: resultObj?.id || null,
        attemptStatus: attempt ? attempt.status : null,
        warningCount: attempt ? attempt.warningCount : 0,
        timeRemaining: attempt ? attempt.timeRemaining : exam.duration * 60,
        reentryAllowed: attempt ? attempt.reentryAllowed : false,
        savedAnswers
      });
    } catch (error) {
      console.error('Error in StudentController.getExamById:', error);
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

      const submittedAnswers = answers || {};

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

      // Pre-populate with auto-saved answers if any
      const existingDbAnswers = await prisma.studentAnswer.findMany({
        where: { studentExamId: studentExam.id }
      });
      const mergedAnswers: Record<string, any> = {};
      for (const ea of existingDbAnswers) {
        if (ea.selectedOption !== null && ea.selectedOption !== '') {
          mergedAnswers[ea.questionId] = ea.selectedOption.includes(',') ? ea.selectedOption.split(',') : ea.selectedOption;
        } else if (ea.answerText !== null && ea.answerText !== '') {
          mergedAnswers[ea.questionId] = ea.answerText;
        }
      }
      if (answers && typeof answers === 'object') {
        for (const [k, v] of Object.entries(answers)) {
          if (v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)) {
            mergedAnswers[k] = v;
          }
        }
      }

      const evalResult = evaluateExamAnswers(exam, student.id, mergedAnswers, studentExam.id);

      // Clear any existing saved answers from auto-save to prevent duplicate records
      await prisma.studentAnswer.deleteMany({
        where: { studentExamId: studentExam.id }
      });

      // Save StudentAnswers details
      if (evalResult.answerInserts.length > 0) {
        await prisma.studentAnswer.createMany({ data: evalResult.answerInserts });
      }

      // Update StudentExam status and raw score
      await prisma.studentExam.update({
        where: { id: studentExam.id },
        data: { score: evalResult.score, status: 'submitted', submittedAt: new Date() }
      });

      // 3. Upsert Result record (safe against duplicate submissions)
      const result = await prisma.result.upsert({
        where: {
          studentId_examId: {
            studentId: student.id,
            examId: exam.id
          }
        },
        update: {
          percentage: evalResult.percentage,
          status: evalResult.status,
          grade: evalResult.percentage >= 90 ? 'A+' : evalResult.percentage >= 80 ? 'A' : evalResult.percentage >= 60 ? 'B' : evalResult.percentage >= 40 ? 'C' : 'F'
        },
        create: {
          studentId: student.id,
          examId: exam.id,
          percentage: evalResult.percentage,
          status: evalResult.status,
          grade: evalResult.percentage >= 90 ? 'A+' : evalResult.percentage >= 80 ? 'A' : evalResult.percentage >= 60 ? 'B' : evalResult.percentage >= 40 ? 'C' : 'F'
        }
      });

      // Calculate Rank for this exam attempt
      let rankIdx = 1;
      try {
        const allExamResults = await prisma.result.findMany({
          where: { examId: exam.id },
          orderBy: [{ percentage: 'desc' }]
        });
        rankIdx = allExamResults.findIndex(r => r.id === result.id) + 1 || 1;
        await prisma.result.update({
          where: { id: result.id },
          data: { rank: rankIdx }
        });
      } catch (rankErr) {
        console.warn('Could not compute rank:', rankErr);
      }

      // Dispatch score notification email
      try {
        await emailService.sendResultPublished(student.user.email, student.user.name, exam.title, evalResult.score, evalResult.totalPoints);
      } catch (mailErr) {
        console.error('Nodemailer evaluation mail failed:', mailErr);
      }

      // Return frontend styled output
      return res.status(201).json({
        id: result.id,
        examId: exam.id,
        examTitle: exam.title,
        subjectName: exam.subject ? exam.subject.subjectName : 'General Evaluation',
        studentId: student.user.id,
        studentName: student.user.name,
        studentRollNo: student.registerNumber,
        score: evalResult.score,
        totalPoints: evalResult.totalPoints,
        totalQuestions: evalResult.assignedEqs.length,
        percentage: evalResult.percentage,
        status: evalResult.status,
        answers: submittedAnswers,
        timeTaken,
        correctCount: evalResult.correctCount,
        wrongCount: evalResult.wrongCount,
        skippedCount: evalResult.skippedCount,
        submittedAt: new Date().toISOString(),
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
          exam: {
            include: {
              subject: true,
              examQuestions: { include: { question: true } }
            }
          }
        },
        orderBy: { id: 'desc' }
      });

      const studentExams = await prisma.studentExam.findMany({
        where: {
          studentId: student.id,
          examId: { in: results.map((r: any) => r.examId) }
        },
        include: {
          studentAnswers: true
        }
      });

      const seMap = new Map<string, any>();
      studentExams.forEach((se: any) => {
        seMap.set(se.examId, se);
      });

      // Map to frontend response format
      const formatted = results.map((r: any) => {
        const se = seMap.get(r.examId);
        const ansMap: Record<string, any> = {};
        if (se && Array.isArray(se.studentAnswers)) {
          se.studentAnswers.forEach((ans: any) => {
            if (ans.selectedOption !== null && ans.selectedOption !== '') {
              ansMap[ans.questionId] = ans.selectedOption.includes(',') ? ans.selectedOption.split(',') : ans.selectedOption;
            } else if (ans.answerText !== null && ans.answerText !== '') {
              ansMap[ans.questionId] = ans.answerText;
            }
          });
        }

        const evalRes = evaluateExamAnswers(r.exam, student.id, ansMap);

        let timeTakenSeconds = 0;
        if (se && se.submittedAt && se.startedAt) {
          timeTakenSeconds = Math.max(1, Math.round((new Date(se.submittedAt).getTime() - new Date(se.startedAt).getTime()) / 1000));
        }

        const submissionDate = (se && se.submittedAt)
          ? se.submittedAt.toISOString()
          : (r.exam?.endDate ? r.exam.endDate.toISOString() : new Date().toISOString());

        return {
          id: r.id,
          examId: r.examId,
          examTitle: r.exam?.title || 'Examination',
          subjectName: r.exam?.subject ? r.exam.subject.subjectName : 'General Evaluation',
          studentId: req.user!.id,
          studentName: req.user!.email,
          studentRollNo: student.registerNumber,
          score: evalRes.score,
          totalPoints: evalRes.totalPoints,
          percentage: evalRes.percentage,
          status: evalRes.status,
          timeTaken: timeTakenSeconds,
          correctCount: evalRes.correctCount,
          wrongCount: evalRes.wrongCount,
          skippedCount: evalRes.skippedCount,
          submittedAt: submissionDate,
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
          OR: [
            { id: resultId },
            { examId: resultId }
          ],
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

      const ansMap: Record<string, any> = {};
      if (studentExam && Array.isArray(studentExam.studentAnswers)) {
        studentExam.studentAnswers.forEach(ans => {
          if (ans.selectedOption !== null && ans.selectedOption !== '') {
            ansMap[ans.questionId] = ans.selectedOption.includes(',') ? ans.selectedOption.split(',') : ans.selectedOption;
          } else if (ans.answerText !== null && ans.answerText !== '') {
            ansMap[ans.questionId] = ans.answerText;
          }
        });
      }

      const evalRes = evaluateExamAnswers(result.exam, student.id, ansMap);

      // Auto-heal result record if there was a discrepancy
      if (result.percentage !== evalRes.percentage || result.status !== evalRes.status) {
        prisma.result.update({
          where: { id: result.id },
          data: {
            percentage: evalRes.percentage,
            status: evalRes.status,
            grade: evalRes.percentage >= 90 ? 'A+' : evalRes.percentage >= 80 ? 'A' : evalRes.percentage >= 60 ? 'B' : evalRes.percentage >= 40 ? 'C' : 'F'
          }
        }).catch(() => {});
      }

      const computedTimeTaken = (studentExam && studentExam.submittedAt && studentExam.startedAt)
        ? Math.max(1, Math.round((new Date(studentExam.submittedAt).getTime() - new Date(studentExam.startedAt).getTime()) / 1000))
        : (result.exam?.duration ? result.exam.duration * 60 : 1200);

      const formattedSubmittedAt = (studentExam && studentExam.submittedAt)
        ? studentExam.submittedAt.toISOString()
        : (result.exam?.endDate ? new Date(result.exam.endDate).toISOString() : new Date().toISOString());

      return res.status(200).json({
        id: result.id,
        examId: result.examId,
        examTitle: result.exam.title,
        subjectName: result.exam.subject ? result.exam.subject.subjectName : 'General Evaluation',
        studentId: req.user!.id,
        studentName: req.user!.email,
        studentRollNo: student.registerNumber,
        score: evalRes.score,
        totalPoints: evalRes.totalPoints,
        percentage: evalRes.percentage,
        status: evalRes.status,
        answers: ansMap,
        detailedQuestions: evalRes.detailedQuestions,
        timeTaken: computedTimeTaken,
        correctCount: evalRes.correctCount,
        wrongCount: evalRes.wrongCount,
        skippedCount: evalRes.skippedCount,
        submittedAt: formattedSubmittedAt,
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
      const safeAnswers = answers || {};

      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const exam = await prisma.exam.findUnique({ where: { id: examId } });
      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
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
            timeRemaining: timeRemaining !== undefined ? timeRemaining : studentExam.timeRemaining
          }
        });
      }

      // Save Student Answers: Delete existing for this exam and insert
      await prisma.studentAnswer.deleteMany({
        where: { studentExamId: studentExam.id }
      });

      const answerData = Object.keys(safeAnswers).map(qId => {
        const studentAns = safeAnswers[qId];
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
              message: `Student ${student.user.name} (${student.registerNumber}) has been locked out of exam "${exam.title}" due to multiple tab switches.`
            }
          });
        }

        if (exam.facultyId) {
          const faculty = await prisma.faculty.findUnique({
            where: { id: exam.facultyId },
            include: { user: true }
          });
          if (faculty?.userId) {
            await prisma.notification.create({
              data: {
                userId: faculty.userId,
                title: 'Student Exam Locked (Proctoring)',
                message: `Student ${student.user.name} (${student.registerNumber}) has been locked out of exam "${exam.title}" after 3 tab switches.`
              }
            });
          }
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
        where: {
          NOT: {
            subjectName: { startsWith: 'Core Fundamentals -' }
          }
        },
        orderBy: { subjectName: 'asc' }
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
