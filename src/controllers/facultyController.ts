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
        include: { options: true, uploadedDocument: true, subject: true },
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
          subjectName: q.subject?.subjectName,
          text: q.question, // map question -> text
          type: q.type,
          options: q.options.map(o => o.option), // option values as string array
          correctAnswer,
          points: q.marks, // map marks -> points
          difficulty: q.difficulty,
          uploadedDocumentId: q.uploadedDocumentId || undefined,
          paperName: q.paperName || q.uploadedDocument?.name || q.subject?.subjectName || undefined,
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
      const { subjectId, text, type, options, correctAnswer, points, difficulty, paperName } = req.body;

      // Find faculty ID
      let faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });

      if (!faculty) {
        faculty = await prisma.faculty.findFirst();
      }

      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found' });
      }

      const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
      const resolvedPaperName = paperName || subject?.subjectName || 'Question Bank Pool';

      // Create Question
      const q = await prisma.question.create({
        data: {
          question: text,
          type: type || 'mcq',
          difficulty: difficulty || 'medium',
          marks: points || 5,
          facultyId: faculty.id,
          subjectId,
          paperName: resolvedPaperName
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
        include: { options: true, subject: true }
      });

      return res.status(201).json({
        id: enrichedQ!.id,
        subjectId: enrichedQ!.subjectId,
        subjectName: enrichedQ!.subject?.subjectName,
        paperName: enrichedQ!.paperName,
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
      let whereClause: any = {};
      if (req.user && req.user.role !== 'admin') {
        const faculty = await prisma.faculty.findUnique({
          where: { userId: req.user.id }
        });
        if (faculty) {
          const orConditions: any[] = [
            { facultyId: faculty.id },
            { collegeId: null }
          ];
          if (faculty.collegeId) {
            orConditions.push({ collegeId: faculty.collegeId });
          }
          whereClause = { OR: orConditions };
        }
      }

      const exams = await prisma.exam.findMany({
        where: whereClause,
        include: {
          college: true,
          department: true,
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
      // Auto-correct any EEC exam subjectId in database if mismatched
      for (const e of exams) {
        if (
          (e.title.includes('EEC') || e.paperName?.includes('EEC') || e.title.includes('Course Examination')) &&
          e.subject && !e.subject.subjectName.includes('AML')
        ) {
          const amlSub = await prisma.subject.findFirst({
            where: { subjectName: { contains: 'AML' } }
          });
          if (amlSub) {
            await prisma.exam.update({
              where: { id: e.id },
              data: { subjectId: amlSub.id }
            });
            e.subject = amlSub as any;
            e.subjectId = amlSub.id;
          }
        }
      }

      const formatted = exams.map(e => {
        const questionsMapped = e.examQuestions
          .filter(eq => eq && eq.question)
          .map(eq => {
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

        let displaySubjectName = e.subject ? `${e.subject.subjectName} (${e.subject.id.substring(0,5).toUpperCase()})` : 'Evaluation';
        if (
          e.title.includes('EEC') ||
          e.paperName === 'EEC Course Examination' ||
          e.examQuestions.some((eq: any) => eq.question?.paperName === 'EEC Course Examination')
        ) {
          displaySubjectName = `AML Examination EEC Course (${e.subjectId ? e.subjectId.substring(0,5).toUpperCase() : 'EEC'})`;
        }

        const yearMatch = e.description?.match(/<!-- TARGET_YEARS:(.*?) -->/);
        const allowedYears = e.targetYears 
          ? e.targetYears.split(',').map((s: string) => s.trim()).filter(Boolean)
          : (yearMatch && yearMatch[1] ? yearMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean) : ['all']);

        return {
          id: e.id,
          title: e.title,
          description: e.description,
          subjectId: e.subjectId,
          subjectName: displaySubjectName,
          collegeId: e.collegeId,
          collegeName: e.college?.collegeName || 'N/A',
          category: e.category,
          departmentId: e.departmentId,
          departmentName: e.department?.departmentName || 'N/A',
          duration: e.duration,
          startTime: e.startDate.toISOString(), // map startDate -> startTime
          endTime: e.endDate.toISOString(), // map endDate -> endTime
          questions: questionsMapped,
          createdBy: e.faculty?.user?.id || '',
          createdByName: e.faculty?.user?.name || 'Faculty',
          status: dynamicStatus,
          questionCount: e.questionCount,
          targetYears: allowedYears,
          targetYear: e.targetYear || (allowedYears.length === 1 && allowedYears[0] !== 'all' ? Number(allowedYears[0]) : null),
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
        questionCount, negativeMarking, marksPerQuestion, negativeMarks,
        category, departmentId, targetYears, targetYear
      } = req.body;

      let faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id },
        include: { college: true }
      });

      if (!faculty) {
        faculty = await prisma.faculty.findFirst({ include: { college: true } });
      }

      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found. Please contact an administrator.' });
      }

      const { collegeId: reqCollegeId, departmentIds } = req.body;
      let targetCollegeId = reqCollegeId || faculty.collegeId;

      // Extract department ID(s)
      let selectedDeptIds: string[] = [];
      if (Array.isArray(departmentIds) && departmentIds.length > 0) {
        selectedDeptIds = departmentIds;
      } else if (departmentId) {
        if (departmentId === 'all') {
          selectedDeptIds = ['all'];
        } else {
          selectedDeptIds = departmentId.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
      }

      const isEntireCollege = selectedDeptIds.length === 0 || selectedDeptIds.includes('all');

      let primaryDept = null;
      if (!isEntireCollege && selectedDeptIds.length > 0) {
        primaryDept = await prisma.department.findFirst({
          where: { id: selectedDeptIds[0] }
        });
      }

      if (!targetCollegeId && primaryDept?.collegeId) {
        targetCollegeId = primaryDept.collegeId;
      }

      if (!targetCollegeId) {
        const firstCollege = await prisma.college.findFirst();
        targetCollegeId = firstCollege?.id;
      }

      // Associate faculty with target college if not yet linked
      if (!faculty.collegeId && targetCollegeId) {
        await prisma.faculty.update({
          where: { id: faculty.id },
          data: { collegeId: targetCollegeId }
        });
      }

      let resolvedCategory = category;
      if (!resolvedCategory || resolvedCategory === 'all' || resolvedCategory === 'All') {
        resolvedCategory = primaryDept?.category || 'All';
      }

      let questionIds = (questions || []).map((q: any) => typeof q === 'string' ? q : q.id);
      const parsedQuestionCount = questionCount !== undefined && Number(questionCount) > 0
        ? Math.min(Number(questionCount), questionIds.length > 0 ? questionIds.length : Number(questionCount))
        : (questionIds.length > 0 ? questionIds.length : 10);
      const parsedMarksPerQuestion = marksPerQuestion !== undefined ? Number(marksPerQuestion) : 1;
      const parsedNegativeMarks = negativeMarks !== undefined ? Number(negativeMarks) : 0;
      const parsedNegativeMarking = Boolean(negativeMarking);

      const totalMarks = Math.round(parsedQuestionCount * parsedMarksPerQuestion);

      const { paperName } = req.body;
      let targetSubjectId = subjectId;
      if (!targetSubjectId || targetSubjectId === 'all') {
        if (questionIds && questionIds.length > 0) {
          const firstQ = await prisma.question.findFirst({
            where: { id: { in: questionIds } },
            select: { subjectId: true }
          });
          if (firstQ && firstQ.subjectId) {
            targetSubjectId = firstQ.subjectId;
          }
        }
      }

      if (!targetSubjectId || targetSubjectId === 'all') {
        if (paperName) {
          const doc = await prisma.uploadedDocument.findFirst({
            where: { OR: [{ name: paperName }, { paperName: paperName }] },
            select: { subjectId: true }
          });
          if (doc && doc.subjectId) {
            targetSubjectId = doc.subjectId;
          }
        }
      }

      if (!targetSubjectId || targetSubjectId === 'all') {
        const amlSub = await prisma.subject.findFirst({ where: { subjectName: { contains: 'AML' } } });
        if (amlSub) {
          targetSubjectId = amlSub.id;
        } else {
          const sub = await prisma.subject.findFirst();
          if (sub) targetSubjectId = sub.id;
        }
      }

      // Verify that targetSubjectId actually exists in DB to prevent foreign key errors
      if (targetSubjectId) {
        const existingSub = await prisma.subject.findUnique({ where: { id: targetSubjectId } });
        if (!existingSub) {
          const fallbackSub = await prisma.subject.findFirst();
          targetSubjectId = fallbackSub?.id || null;
        }
      }

      // Encode target departments in description metadata tag
      let finalDescription = description || '';
      if (!isEntireCollege && selectedDeptIds.length > 0) {
        finalDescription += `\n<!-- TARGET_DEPTS:${selectedDeptIds.join(',')} -->`;
      } else {
        finalDescription += `\n<!-- TARGET_DEPTS:all -->`;
      }

      // Handle Target Years (1 to 4)
      let resolvedTargetYears = 'all';
      if (Array.isArray(targetYears) && targetYears.length > 0) {
        resolvedTargetYears = targetYears.map(String).join(',');
      } else if (typeof targetYears === 'string' && targetYears.trim()) {
        resolvedTargetYears = targetYears.trim();
      } else if (targetYear !== undefined && targetYear !== null && targetYear !== '') {
        resolvedTargetYears = String(targetYear);
      }

      if (resolvedTargetYears && resolvedTargetYears !== 'all') {
        finalDescription += `\n<!-- TARGET_YEARS:${resolvedTargetYears} -->`;
      } else {
        finalDescription += `\n<!-- TARGET_YEARS:all -->`;
      }

      const parsedTargetYear = targetYear ? Number(targetYear) : (resolvedTargetYears !== 'all' && !resolvedTargetYears.includes(',') ? Number(resolvedTargetYears) : null);

      // Ensure questionIds are not empty (auto-populate from subject or question pool)
      if (questionIds.length === 0) {
        let poolQs = await prisma.question.findMany({
          where: targetSubjectId ? { subjectId: targetSubjectId } : undefined,
          take: parsedQuestionCount > 0 ? parsedQuestionCount : 10,
          select: { id: true }
        });
        if (poolQs.length === 0) {
          poolQs = await prisma.question.findMany({
            take: parsedQuestionCount > 0 ? parsedQuestionCount : 10,
            select: { id: true }
          });
        }
        questionIds = poolQs.map(q => q.id);
      }

      // Create Exam
      const exam = await prisma.exam.create({
        data: {
          title,
          description: finalDescription,
          subjectId: targetSubjectId,
          facultyId: faculty.id,
          collegeId: targetCollegeId,
          category: resolvedCategory,
          departmentId: primaryDept?.id || null,
          paperName: paperName || null,
          targetYears: resolvedTargetYears,
          targetYear: parsedTargetYear,
          duration: Number(duration),
          totalMarks,
          startDate: new Date(startTime),
          endDate: new Date(endTime),
          questionCount: parsedQuestionCount,
          negativeMarking: parsedNegativeMarking,
          marksPerQuestion: parsedMarksPerQuestion,
          negativeMarks: parsedNegativeMarks,
          status: 'scheduled'
        }
      });

      // Link questions
      if (questionIds.length > 0) {
        const relationData = questionIds.map((qId: string) => ({
          examId: exam.id,
          questionId: qId
        }));
        await prisma.examQuestion.createMany({ data: relationData, skipDuplicates: true });
      }

      // Format response user details matching frontend expectation
      const fullExam = await prisma.exam.findUnique({
        where: { id: exam.id },
        include: { subject: true, college: true, department: true }
      });

      // Send response immediately to avoid HTTP timeouts
      res.status(201).json({
        id: exam.id,
        title: exam.title,
        description: exam.description,
        subjectId: exam.subjectId,
        subjectName: fullExam?.subject?.subjectName,
        collegeId: exam.collegeId,
        collegeName: fullExam?.college?.collegeName,
        category: exam.category,
        departmentId: exam.departmentId,
        departmentName: fullExam?.department?.departmentName,
        duration: exam.duration,
        startTime: exam.startDate.toISOString(),
        endTime: exam.endDate.toISOString(),
        questions: questionIds,
        questionCount: exam.questionCount,
        targetYears: resolvedTargetYears.split(','),
        targetYear: exam.targetYear,
        createdBy: req.user!.id,
        status: exam.status,
        createdAt: exam.startDate.toISOString()
      });

      // Asynchronously notify active enrolled students in background without blocking the HTTP response
      setImmediate(async () => {
        try {
          const studentWhere: any = {
            collegeId: targetCollegeId,
            user: { status: 'active' }
          };
          if (!isEntireCollege && selectedDeptIds.length > 0) {
            studentWhere.departmentId = { in: selectedDeptIds };
          }
          const allowedYearsList = resolvedTargetYears.split(',').map(s => s.trim()).filter(Boolean);
          if (!allowedYearsList.includes('all')) {
            const numericYears = allowedYearsList.map(Number).filter(n => !isNaN(n));
            if (numericYears.length > 0) {
              studentWhere.year = { in: numericYears };
            }
          }

          const enrolledStudents = await prisma.student.findMany({
            where: studentWhere,
            include: { user: true },
            take: 100
          });

          for (const std of enrolledStudents) {
            if (std.user?.email) {
              try {
                await emailService.sendExamScheduled(std.user.email, std.user.name, title, startTime);
              } catch (mailErr) {
                // Ignore individual background email failure
              }
            }
          }
        } catch (bgErr) {
          console.error('[FacultyController] Background email notice error:', bgErr);
        }
      });
      return;
    } catch (error) {
      next(error);
    }
  },

  // 5.1. Update Scheduled Exam
  updateExam: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const {
        title,
        description,
        duration,
        startTime,
        endTime,
        questionCount,
        marksPerQuestion,
        negativeMarks,
        negativeMarking,
        questions,
        targetYears,
        targetYear
      } = req.body;

      const exam = await prisma.exam.findUnique({
        where: { id },
        include: { examQuestions: true }
      });

      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      // If specific questions array is provided, update the linked questions
      if (Array.isArray(questions) && questions.length > 0) {
        const questionIds: string[] = questions.map((q: any) => typeof q === 'string' ? q : q.id);
        await prisma.examQuestion.deleteMany({
          where: { examId: id }
        });
        await prisma.examQuestion.createMany({
          data: questionIds.map((qId: string) => ({
            examId: id,
            questionId: qId
          })),
          skipDuplicates: true
        });
      }

      const parsedQCount = questionCount !== undefined ? Math.max(1, Number(questionCount)) : exam.questionCount;
      const parsedMarksPerQ = marksPerQuestion !== undefined ? Number(marksPerQuestion) : (exam.marksPerQuestion || 1);
      const parsedTotalMarks = Math.round(parsedQCount * parsedMarksPerQ);

      // If questionCount was increased beyond currently assigned questions, ensure exam has enough pool questions
      const currentAssignedCount = await prisma.examQuestion.count({ where: { examId: id } });
      if (currentAssignedCount < parsedQCount) {
        const needed = parsedQCount - currentAssignedCount;
        const existingEqs = await prisma.examQuestion.findMany({
          where: { examId: id },
          select: { questionId: true }
        });
        const existingQIds = existingEqs.map(e => e.questionId);

        let additionalQuestions = await prisma.question.findMany({
          where: {
            id: { notIn: existingQIds },
            ...(exam.subjectId ? { subjectId: exam.subjectId } : {})
          },
          take: needed,
          select: { id: true }
        });

        if (additionalQuestions.length < needed) {
          const stillNeeded = needed - additionalQuestions.length;
          const foundIds = [...existingQIds, ...additionalQuestions.map(q => q.id)];
          const moreQ = await prisma.question.findMany({
            where: { id: { notIn: foundIds } },
            take: stillNeeded,
            select: { id: true }
          });
          additionalQuestions = [...additionalQuestions, ...moreQ];
        }

        if (additionalQuestions.length > 0) {
          await prisma.examQuestion.createMany({
            data: additionalQuestions.map(q => ({
              examId: id,
              questionId: q.id
            })),
            skipDuplicates: true
          });
        }
      }

      let updatedDescription = description !== undefined ? description : exam.description;
      let resolvedTargetYears = exam.targetYears || 'all';
      if (targetYears !== undefined || targetYear !== undefined) {
        if (Array.isArray(targetYears) && targetYears.length > 0) {
          resolvedTargetYears = targetYears.map(String).join(',');
        } else if (typeof targetYears === 'string' && targetYears.trim()) {
          resolvedTargetYears = targetYears.trim();
        } else if (targetYear !== undefined && targetYear !== null && targetYear !== '') {
          resolvedTargetYears = String(targetYear);
        }

        updatedDescription = updatedDescription.replace(/\n?<!-- TARGET_YEARS:(.*?) -->/g, '');
        if (resolvedTargetYears && resolvedTargetYears !== 'all') {
          updatedDescription += `\n<!-- TARGET_YEARS:${resolvedTargetYears} -->`;
        } else {
          updatedDescription += `\n<!-- TARGET_YEARS:all -->`;
        }
      }

      const parsedTargetYear = targetYear !== undefined
        ? (targetYear ? Number(targetYear) : null)
        : (resolvedTargetYears !== 'all' && !resolvedTargetYears.includes(',') ? Number(resolvedTargetYears) : exam.targetYear);

      const updated = await prisma.exam.update({
        where: { id },
        data: {
          title: title !== undefined ? title : exam.title,
          description: updatedDescription,
          duration: duration !== undefined ? Number(duration) : exam.duration,
          startDate: startTime !== undefined ? new Date(startTime) : exam.startDate,
          endDate: endTime !== undefined ? new Date(endTime) : exam.endDate,
          questionCount: parsedQCount,
          targetYears: resolvedTargetYears,
          targetYear: parsedTargetYear,
          marksPerQuestion: parsedMarksPerQ,
          negativeMarks: negativeMarks !== undefined ? Number(negativeMarks) : exam.negativeMarks,
          negativeMarking: negativeMarking !== undefined ? Boolean(negativeMarking) : exam.negativeMarking,
          totalMarks: parsedTotalMarks
        },
        include: {
          subject: true,
          examQuestions: { include: { question: { include: { options: true } } } }
        }
      });

      return res.status(200).json({
        id: updated.id,
        title: updated.title,
        description: updated.description,
        subjectId: updated.subjectId,
        subjectName: updated.subject?.subjectName || 'Aptitude',
        duration: updated.duration,
        questionCount: updated.questionCount,
        targetYears: resolvedTargetYears.split(','),
        targetYear: updated.targetYear,
        startTime: updated.startDate.toISOString(),
        endTime: updated.endDate.toISOString(),
        totalMarks: updated.totalMarks,
        marksPerQuestion: updated.marksPerQuestion,
        negativeMarking: updated.negativeMarking,
        negativeMarks: updated.negativeMarks,
        status: updated.status,
        questions: updated.examQuestions.map(eq => ({
          id: eq.question.id,
          text: eq.question.question,
          type: eq.question.type,
          points: eq.question.marks
        }))
      });
    } catch (error) {
      next(error);
    }
  },


  // 5.2. Delete Exam
  deleteExam: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const exam = await prisma.exam.findUnique({
        where: { id }
      });

      if (!exam) {
        return res.status(404).json({ message: 'Exam not found' });
      }

      await prisma.exam.delete({
        where: { id }
      });

      return res.status(200).json({ message: 'Exam deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  // 6. Get Exam Results for Faculty grading view & Admin evaluation
  getResults: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const isAdmin = req.user?.role === 'admin';
      let facultyCollegeId: string | undefined = undefined;
      let facultyId: string | undefined = undefined;

      if (!isAdmin && req.user) {
        const faculty = await prisma.faculty.findFirst({ where: { userId: req.user.id } });
        if (faculty) {
          facultyCollegeId = faculty.collegeId || undefined;
          facultyId = faculty.id;
        }
      }

      // Query filters (supported for both Admin and Faculty)
      const qExamId = typeof req.query.examId === 'string' && req.query.examId ? req.query.examId : undefined;
      const qCollegeId = typeof req.query.collegeId === 'string' && req.query.collegeId ? req.query.collegeId : undefined;
      const qDepartmentId = typeof req.query.departmentId === 'string' && req.query.departmentId ? req.query.departmentId : undefined;

      // Base student/exam filters
      const examFilter: any = {};
      const studentFilter: any = {};

      if (qExamId) examFilter.id = qExamId;
      if (qCollegeId) {
        studentFilter.collegeId = qCollegeId;
      } else if (facultyCollegeId) {
        studentFilter.collegeId = facultyCollegeId;
      }
      if (qDepartmentId) studentFilter.departmentId = qDepartmentId;

      if (!isAdmin && facultyId && !facultyCollegeId) {
        examFilter.facultyId = facultyId;
      }

      const resultsWhere: any = {};
      if (Object.keys(examFilter).length > 0) resultsWhere.exam = examFilter;
      if (Object.keys(studentFilter).length > 0) resultsWhere.student = studentFilter;

      // 1. Fetch from Result table
      const results = await prisma.result.findMany({
        where: resultsWhere,
        include: {
          student: { include: { user: true, department: true, college: true, course: true } },
          exam: {
            include: {
              college: true,
              subject: true,
              department: true,
              examQuestions: {
                include: {
                  question: {
                    include: { options: true }
                  }
                }
              }
            }
          }
        },
        orderBy: { id: 'desc' }
      });

      // 2. Fetch all studentExam attempts (to ensure NO attended student is missed)
      const seWhere: any = {};
      if (Object.keys(examFilter).length > 0) seWhere.exam = examFilter;
      if (Object.keys(studentFilter).length > 0) seWhere.student = studentFilter;

      const studentExams = await prisma.studentExam.findMany({
        where: seWhere,
        include: {
          student: { include: { user: true, department: true, college: true, course: true } },
          exam: {
            include: {
              college: true,
              subject: true,
              department: true,
              examQuestions: {
                include: {
                  question: {
                    include: { options: true }
                  }
                }
              }
            }
          },
          studentAnswers: true
        },
        orderBy: { startedAt: 'desc' }
      });

      // Index results and studentExams
      const seMap = new Map<string, any>();
      studentExams.forEach((se: any) => {
        seMap.set(`${se.studentId}_${se.examId}`, se);
      });

      const resMap = new Map<string, any>();
      results.forEach((r: any) => {
        resMap.set(`${r.studentId}_${r.examId}`, r);
      });

      // Combine unique student-exam keys from both collections
      const allKeys = new Set<string>([...resMap.keys(), ...seMap.keys()]);

      const mapped: any[] = [];

      for (const key of allKeys) {
        const r = resMap.get(key);
        const se = seMap.get(key);

        const exam = r?.exam || se?.exam;
        const student = r?.student || se?.student;

        if (!exam || !student) continue;

        const totalEqs = (exam.examQuestions || []).filter((eq: any) => eq && eq.question).length;
        const marksPerQ = exam.marksPerQuestion && exam.marksPerQuestion > 0 ? exam.marksPerQuestion : 1;
        const negMarks = exam.negativeMarking ? (exam.negativeMarks || 0) : 0;
        const countLimit = (exam.questionCount && exam.questionCount > 0)
          ? Math.min(exam.questionCount, totalEqs || exam.questionCount)
          : (totalEqs || 10);
        const totalPoints = Math.round(countLimit * marksPerQ) || exam.totalMarks || 100;
        const passThreshold = exam.passPercentage || 40;

        // Build question option lookup for precise answer verification
        const qMap = new Map<string, any>();
        (exam.examQuestions || []).forEach((eq: any) => {
          if (eq?.question?.id) {
            qMap.set(eq.question.id, eq.question);
          }
        });

        let correctCount = 0;
        let wrongCount = 0;
        let skippedCount = 0;
        let calculatedScore = 0;
        let hasEvaluatedAnswers = false;

        if (se && Array.isArray(se.studentAnswers) && se.studentAnswers.length > 0) {
          hasEvaluatedAnswers = true;
          se.studentAnswers.forEach((ans: any) => {
            const hasAnswer = (ans.selectedOption !== null && ans.selectedOption !== '') ||
                              (ans.answerText !== null && ans.answerText !== '');
            if (!hasAnswer) {
              skippedCount++;
              return;
            }

            let isCorrect = ans.marksAwarded > 0;
            // Cross-check against question options
            if (!isCorrect && qMap.has(ans.questionId)) {
              const q = qMap.get(ans.questionId);
              const sortedOptions = [...(q.options || [])].sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''));
              if (q.type === 'mcq' && ans.selectedOption !== null) {
                const optIdx = Number(ans.selectedOption);
                if (!isNaN(optIdx) && optIdx >= 0 && optIdx < sortedOptions.length) {
                  isCorrect = Boolean(sortedOptions[optIdx]?.isCorrect);
                } else {
                  const matched = sortedOptions.find((o: any) => o.option && o.option.trim().toLowerCase() === String(ans.selectedOption).trim().toLowerCase());
                  isCorrect = Boolean(matched?.isCorrect);
                }
              } else if (q.type === 'checkbox' && ans.selectedOption !== null) {
                const parts = String(ans.selectedOption).split(',').sort();
                const correctIndices = sortedOptions
                  .map((o: any, idx: number) => (o.isCorrect ? String(idx) : null))
                  .filter((x: any): x is string => x !== null)
                  .sort();
                isCorrect = JSON.stringify(parts) === JSON.stringify(correctIndices);
              }
            }

            if (isCorrect) {
              correctCount++;
              calculatedScore += marksPerQ;
            } else {
              wrongCount++;
              if (negMarks > 0) calculatedScore -= negMarks;
            }
          });

          const totalQ = totalEqs || countLimit;
          if (totalQ > (correctCount + wrongCount + skippedCount)) {
            skippedCount += (totalQ - (correctCount + wrongCount + skippedCount));
          }
        }

        let rawScore = 0;
        if (hasEvaluatedAnswers) {
          rawScore = Math.max(0, Math.round(calculatedScore));
        } else if (se && typeof se.score === 'number' && se.score >= 0) {
          rawScore = Math.max(0, Math.round(se.score));
          correctCount = Math.min(countLimit, Math.max(0, Math.round(rawScore / marksPerQ)));
          wrongCount = Math.max(0, countLimit - correctCount);
          skippedCount = 0;
        } else if (r && typeof r.percentage === 'number') {
          // Fallback if no attempt or answers exist at all
          rawScore = Math.round((r.percentage / 100) * totalPoints);
          correctCount = Math.min(countLimit, Math.max(0, Math.round(rawScore / marksPerQ)));
          wrongCount = Math.max(0, countLimit - correctCount);
          skippedCount = 0;
        }

        // CRITICAL INTEGRITY CHECK:
        // If correctCount is 0, score CANNOT be positive!
        if (correctCount === 0) {
          rawScore = 0;
        }

        const percentage = totalPoints > 0
          ? Math.min(100, Math.max(0, Math.round((rawScore / totalPoints) * 100)))
          : 0;

        const status = (percentage >= passThreshold && rawScore > 0) ? 'pass' : 'fail';

        let timeTakenSeconds = 0;
        if (se && se.submittedAt && se.startedAt) {
          timeTakenSeconds = Math.max(1, Math.round((new Date(se.submittedAt).getTime() - new Date(se.startedAt).getTime()) / 1000));
        } else if (se?.startedAt) {
          timeTakenSeconds = Math.max(1, Math.round((new Date().getTime() - new Date(se.startedAt).getTime()) / 1000));
        }

        const submissionDate = (se && se.submittedAt)
          ? se.submittedAt.toISOString()
          : (r?.exam?.endDate ? r.exam.endDate.toISOString() : (exam.endDate ? exam.endDate.toISOString() : new Date().toISOString()));

        // Auto-heal DB Result table in background if discrepancy is present
        if (r && (r.percentage !== percentage || r.status !== status)) {
          prisma.result.update({
            where: { id: r.id },
            data: {
              percentage,
              status,
              grade: percentage >= 90 ? 'A+' : percentage >= 80 ? 'A' : percentage >= 60 ? 'B' : percentage >= 40 ? 'C' : 'F'
            }
          }).catch(() => {});
        } else if (!r && student.id && exam.id) {
          prisma.result.upsert({
            where: {
              studentId_examId: { studentId: student.id, examId: exam.id }
            },
            create: {
              studentId: student.id,
              examId: exam.id,
              percentage,
              status,
              grade: percentage >= 90 ? 'A+' : percentage >= 80 ? 'A' : percentage >= 60 ? 'B' : percentage >= 40 ? 'C' : 'F'
            },
            update: {
              percentage,
              status,
              grade: percentage >= 90 ? 'A+' : percentage >= 80 ? 'A' : percentage >= 60 ? 'B' : percentage >= 40 ? 'C' : 'F'
            }
          }).catch(() => {});
        }

        if (se && se.score !== rawScore) {
          prisma.studentExam.update({
            where: { id: se.id },
            data: { score: rawScore }
          }).catch(() => {});
        }

        mapped.push({
          id: r?.id || se?.id || `attempt_${student.id}_${exam.id}`,
          examId: exam.id,
          examTitle: exam.title || 'Examination',
          subjectName: exam.subject ? exam.subject.subjectName : 'General Evaluation',
          collegeName: student.college?.collegeName || exam.college?.collegeName || 'N/A',
          studentId: student.user?.id || student.id || '',
          studentName: student.user?.name || 'Student',
          studentRollNo: student.registerNumber || '',
          departmentName: student.department?.departmentName || 'General',
          studentDepartment: student.department?.departmentName || 'General',
          score: rawScore,
          totalPoints,
          percentage,
          status,
          timeTaken: timeTakenSeconds,
          correctCount,
          wrongCount,
          skippedCount,
          submittedAt: submissionDate
        });
      }

      // Sort by submission date descending (newest first)
      mapped.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

      return res.status(200).json(mapped);
    } catch (error) {
      next(error);
    }
  },

  // 7. Get Pending Students for Faculty approval view
  getPendingStudents: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      let facultyCollegeId: string | undefined = undefined;
      if (req.user) {
        const faculty = await prisma.faculty.findFirst({ where: { userId: req.user.id } });
        if (faculty?.collegeId) {
          facultyCollegeId = faculty.collegeId;
        }
      }

      const students = await prisma.user.findMany({
        where: {
          role: 'student',
          status: 'pending',
          ...(facultyCollegeId ? { student: { collegeId: facultyCollegeId } } : {})
        },
        include: {
          student: {
            include: {
              department: true,
              course: true,
              college: true
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
        collegeName: user.student?.college?.collegeName || '',
        category: user.student?.category || '',
        departmentName: user.student?.department?.departmentName || '',
        courseName: user.student?.course?.courseName || '',
        photoUrl: formatPhotoUrl(req, user.photoUrl || user.student?.photoUrl) || '',
        createdAt: user.createdAt.toISOString()
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 7.1 Get Departments for Faculty's College
  getDepartments: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });

      const { collegeId, category } = req.query as { collegeId?: string; category?: string };
      const resolvedCollegeId = collegeId || faculty?.collegeId || undefined;

      const where: any = {};
      if (resolvedCollegeId) {
        where.collegeId = resolvedCollegeId;
      }
      if (category) {
        where.category = category;
      }

      let departments = await prisma.department.findMany({
        where,
        orderBy: { departmentName: 'asc' }
      });

      // Fallback: If no departments found for specific collegeId + category, or if faculty has no collegeId
      if (departments.length === 0 && category) {
        departments = await prisma.department.findMany({
          where: { category },
          orderBy: { departmentName: 'asc' }
        });
      }

      // Also ensure any departments typed by registered students in this college are included
      if (resolvedCollegeId) {
        const studentDepts = await prisma.student.findMany({
          where: { collegeId: resolvedCollegeId },
          include: { department: true }
        });
        studentDepts.forEach(s => {
          if (s.department && !departments.some(d => d.id === s.department.id)) {
            departments.push(s.department);
          }
        });
      }

      // Deduplicate departments by departmentName
      const seen = new Set<string>();
      const uniqueDepts: any[] = [];
      for (const d of departments) {
        const key = d.departmentName.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          uniqueDepts.push(d);
        }
      }

      return res.status(200).json(uniqueDepts.map(d => ({
        id: d.id,
        name: d.departmentName,
        departmentName: d.departmentName,
        category: d.category,
        collegeId: d.collegeId
      })));
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
      if (!faculty && req.user?.role !== 'admin') return res.status(403).json({ message: 'Faculty not found' });

      let whereCondition: any = {
        startDate: { gte: new Date() }
      };

      if (req.user?.role !== 'admin' && faculty) {
        const orConditions: any[] = [
          { facultyId: faculty.id },
          { collegeId: null }
        ];
        if (faculty.collegeId) {
          orConditions.push({ collegeId: faculty.collegeId });
        }
        whereCondition.OR = orConditions;
      }

      const exams = await prisma.exam.findMany({
        where: whereCondition,
        include: {
          college: true,
          department: true,
          subject: {
            include: {
              course: { include: { department: true } }
            }
          },
          examQuestions: true
        },
        orderBy: { startDate: 'asc' }
      });

      const formatted = exams.map(e => {
        const yearMatch = e.description?.match(/<!-- TARGET_YEARS:(.*?) -->/);
        const allowedYears = e.targetYears 
          ? e.targetYears.split(',').map((s: string) => s.trim()).filter(Boolean)
          : (yearMatch && yearMatch[1] ? yearMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean) : ['all']);

        return {
          id: e.id,
          title: e.title,
          description: e.description,
          subjectId: e.subjectId,
          subjectName: e.subject?.subjectName || 'Evaluation',
          courseName: e.subject?.course?.courseName || 'N/A',
          departmentName: e.department?.departmentName || e.subject?.course?.department?.departmentName || 'N/A',
          collegeName: e.college?.collegeName || 'N/A',
          category: e.category,
          semester: e.subject?.semester || 1,
          duration: e.duration,
          startTime: e.startDate.toISOString(),
          endTime: e.endDate.toISOString(),
          totalMarks: e.totalMarks,
          questionCount: e.questionCount || e.examQuestions.length,
          targetYears: allowedYears,
          targetYear: e.targetYear || (allowedYears.length === 1 && allowedYears[0] !== 'all' ? Number(allowedYears[0]) : null),
          status: e.status
        };
      });

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
        .filter(e => e.examQuestions.some(eq => eq && eq.question && eq.question.type === 'text'))
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
        subjectName: se.exam.subject ? se.exam.subject.subjectName : 'General Evaluation',
        submittedAt: se.submittedAt?.toISOString() || se.startedAt.toISOString(),
        pendingAnswerCount: se.studentAnswers.length,
        answers: se.studentAnswers.map(sa => ({
          answerId: sa.id,
          questionId: sa.questionId,
          questionText: sa.question ? sa.question.question : '',
          maxMarks: sa.question ? sa.question.marks : 1,
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
      const { name, subjectId, questionType } = req.body;
      const mode: 'mcq' | 'checkbox' | 'auto' = (questionType as 'mcq' | 'checkbox' | 'auto') || 'mcq';
      
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const qpaperFile = files && files['file'] ? files['file'][0] : undefined;
      const answerFile = files && files['answerFile'] ? files['answerFile'][0] : undefined;

      if (!qpaperFile) {
        return res.status(400).json({ message: 'Document file is required' });
      }
      if (!name || !subjectId) {
        return res.status(400).json({ message: 'Name and Subject ID are required' });
      }

      let faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });
      if (!faculty) {
        faculty = await prisma.faculty.findFirst({
          where: { userId: req.user!.id }
        });
      }
      if (!faculty) {
        faculty = await prisma.faculty.findFirst();
      }
      if (!faculty) {
        let dummyDept = await prisma.department.findFirst();
        if (!dummyDept) {
          dummyDept = await prisma.department.create({ data: { departmentName: 'General' } });
        }
        faculty = await prisma.faculty.create({
          data: {
            userId: req.user!.id,
            departmentId: dummyDept.id,
            designation: req.user?.role === 'admin' ? 'Administrator' : 'Faculty Member',
            experience: 5
          }
        });
      }

      // Check subject
      const subject = await prisma.subject.findUnique({
        where: { id: subjectId }
      });
      if (!subject) {
        return res.status(404).json({ message: 'Subject not found' });
      }

      const fileExtension = path.extname(qpaperFile.originalname).toLowerCase().replace('.', '');
      let fileType: 'pdf' | 'docx' | 'csv' = 'pdf';
      if (fileExtension === 'docx') fileType = 'docx';
      else if (fileExtension === 'csv') fileType = 'csv';
      else if (fileExtension !== 'pdf') {
        return res.status(400).json({ message: 'Unsupported file format. Please upload PDF, Word (.docx), or CSV.' });
      }

      // Extract answer key text if provided
      let answerText = '';
      if (answerFile) {
        const answerExt = path.extname(answerFile.originalname).toLowerCase().replace('.', '');
        if (answerExt === 'pdf') {
          answerText = await Extractor.extractTextFromPDF(answerFile.buffer);
        } else if (answerExt === 'docx') {
          answerText = await Extractor.extractTextFromDOCX(answerFile.buffer);
        } else if (answerExt === 'csv' || answerExt === 'txt') {
          answerText = answerFile.buffer.toString('utf-8');
        }
      }

      // Parse questions
      let parsedQuestions: any[] = [];
      if (fileType === 'pdf') {
        const text = await Extractor.extractTextFromPDF(qpaperFile.buffer);
        if (answerFile && answerText) {
          parsedQuestions = Extractor.parseQuestionsWithSeparateAnswers(text, answerText, mode);
        } else {
          parsedQuestions = Extractor.parseUnstructuredQuestions(text, mode);
        }
      } else if (fileType === 'docx') {
        const text = await Extractor.extractTextFromDOCX(qpaperFile.buffer);
        if (answerFile && answerText) {
          parsedQuestions = Extractor.parseQuestionsWithSeparateAnswers(text, answerText, mode);
        } else {
          parsedQuestions = Extractor.parseUnstructuredQuestions(text, mode);
        }
      } else if (fileType === 'csv') {
        const text = qpaperFile.buffer.toString('utf-8');
        parsedQuestions = Extractor.parseCSVQuestions(text, mode);
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
      fs.writeFileSync(filePath, qpaperFile.buffer);

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
              paperName: name,
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
      let whereClause: any = {};
      if (req.user?.role !== 'admin') {
        const faculty = await prisma.faculty.findUnique({
          where: { userId: req.user!.id }
        });
        if (!faculty) {
          return res.status(403).json({ message: 'Faculty profile not found' });
        }
        whereClause.facultyId = faculty.id;
      }

      const docs = await prisma.uploadedDocument.findMany({
        where: whereClause,
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

      let faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });
      if (!faculty && req.user?.role === 'admin') {
        faculty = await prisma.faculty.findFirst({
          where: { userId: req.user!.id }
        });
        if (!faculty) {
          faculty = await prisma.faculty.findFirst();
        }
        if (!faculty) {
          let dummyDept = await prisma.department.findFirst();
          if (!dummyDept) {
            dummyDept = await prisma.department.create({ data: { departmentName: 'General' } });
          }
          faculty = await prisma.faculty.create({
            data: {
              userId: req.user!.id,
              departmentId: dummyDept.id,
              designation: 'Administrator',
              experience: 5
            }
          });
        }
      }
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
  },

  // 25. Get distinct Question Papers for Exam Scheduling Dropdown
  getQuestionPapers: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      let facultyId: string | undefined = undefined;
      let facultyDeptId: string | undefined = undefined;
      if (req.user) {
        const faculty = await prisma.faculty.findFirst({ where: { userId: req.user.id } });
        if (faculty) {
          facultyId = faculty.id;
          facultyDeptId = faculty.departmentId || undefined;
        }
      }

      const questions = await prisma.question.findMany({
        where: facultyId ? { OR: [{ facultyId }, { departmentId: facultyDeptId }] } : {},
        select: { paperName: true, uploadedDocument: { select: { name: true } } }
      });

      const docs = await prisma.uploadedDocument.findMany({
        where: facultyId ? { OR: [{ facultyId }, { faculty: { departmentId: facultyDeptId } }] } : {},
        select: { paperName: true, name: true }
      });

      const papersSet = new Set<string>();
      questions.forEach(q => {
        if (q.paperName) papersSet.add(q.paperName);
        if (q.uploadedDocument?.name) papersSet.add(q.uploadedDocument.name);
      });
      docs.forEach(d => {
        if (d.paperName) papersSet.add(d.paperName);
        if (d.name) papersSet.add(d.name);
      });

      return res.status(200).json(Array.from(papersSet));
    } catch (error) {
      next(error);
    }
  }
};
