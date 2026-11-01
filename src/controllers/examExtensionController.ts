import { Response, NextFunction } from 'express';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth';

export const ExamExtensionController = {
  // 1. Grant Time Extension (+5 or +10 minutes)
  extendTime: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { studentExamId, examId, studentId, extensionMinutes, reason } = req.body;
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      if (!['admin', 'faculty'].includes(user.role)) {
        return res.status(403).json({ message: 'Forbidden: Only authorized administrators and invigilators can grant test extensions.' });
      }

      const minutes = Number(extensionMinutes);
      if (minutes !== 5 && minutes !== 10) {
        return res.status(400).json({ message: 'Invalid extension duration. Only +5 minutes or +10 minutes extensions are permitted.' });
      }

      // Find target StudentExam
      let studentExam: any = null;
      if (studentExamId) {
        studentExam = await prisma.studentExam.findUnique({
          where: { id: studentExamId },
          include: { student: { include: { user: true } }, exam: true }
        });
      } else if (examId && studentId) {
        studentExam = await prisma.studentExam.findUnique({
          where: { studentId_examId: { studentId, examId } },
          include: { student: { include: { user: true } }, exam: true }
        });
      }

      if (!studentExam) {
        return res.status(404).json({ message: 'Active candidate assessment session not found.' });
      }

      if (studentExam.status === 'submitted') {
        return res.status(400).json({ message: 'Cannot extend time: candidate has already submitted this examination.' });
      }

      // Faculty / Invigilator institution check
      if (user.role === 'faculty') {
        const faculty = await prisma.faculty.findUnique({ where: { userId: user.id } });
        if (faculty && faculty.collegeId && studentExam.student.collegeId && faculty.collegeId !== studentExam.student.collegeId) {
          return res.status(403).json({ message: 'Forbidden: You are not authorized to invigilate students from other institutions.' });
        }
      }

      const examDurationMinutes = studentExam.exam.duration || 30;
      const originalStartedAt = studentExam.startedAt ? new Date(studentExam.startedAt) : new Date();

      // Original deadline calculation
      const currentTotalExt = studentExam.totalExtensionMinutes || 0;
      const originalDeadline = studentExam.deadline 
        ? new Date(studentExam.deadline)
        : new Date(originalStartedAt.getTime() + (examDurationMinutes + currentTotalExt) * 60 * 1000);

      const newDeadline = new Date(originalDeadline.getTime() + minutes * 60 * 1000);
      const newTimeRemaining = (studentExam.timeRemaining || 0) + minutes * 60;
      const newTotalExt = currentTotalExt + minutes;

      // Transactional update: Create audit log entry and update StudentExam
      const [extensionRecord, updatedStudentExam] = await prisma.$transaction([
        prisma.timeExtension.create({
          data: {
            studentExamId: studentExam.id,
            studentId: studentExam.studentId,
            examId: studentExam.examId,
            originalDeadline,
            newDeadline,
            extensionMinutes: minutes,
            reason: reason ? String(reason).trim() : null,
            grantedById: user.id,
            grantedByRole: user.role
          }
        }),
        prisma.studentExam.update({
          where: { id: studentExam.id },
          data: {
            deadline: newDeadline,
            timeRemaining: newTimeRemaining,
            totalExtensionMinutes: newTotalExt
          },
          include: {
            student: { include: { user: true } },
            exam: true
          }
        }),
        prisma.activityLog.create({
          data: {
            userId: user.id,
            action: `Granted +${minutes} minutes extension to student ${studentExam.student.user.name} (${studentExam.student.registerNumber}) for exam "${studentExam.exam.title}". Reason: ${reason || 'N/A'}`
          }
        })
      ]);

      return res.status(200).json({
        success: true,
        message: `Successfully granted +${minutes} minutes extension. Authoritative deadline updated.`,
        extension: extensionRecord,
        studentExam: {
          id: updatedStudentExam.id,
          studentName: updatedStudentExam.student.user.name,
          registerNumber: updatedStudentExam.student.registerNumber,
          examTitle: updatedStudentExam.exam.title,
          timeRemaining: updatedStudentExam.timeRemaining,
          totalExtensionMinutes: updatedStudentExam.totalExtensionMinutes,
          deadline: updatedStudentExam.deadline?.toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  },

  // 2. Get Extension Audit Log History
  getExtensionHistory: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { examId, studentId } = req.query;
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const whereClause: any = {};
      if (examId) whereClause.examId = String(examId);
      if (studentId) whereClause.studentId = String(studentId);

      // Institution isolation for admin or faculty
      if (user.role === 'faculty') {
        const faculty = await prisma.faculty.findUnique({ where: { userId: user.id } });
        if (faculty && faculty.collegeId) {
          whereClause.student = { collegeId: faculty.collegeId };
        }
      }

      const extensions = await prisma.timeExtension.findMany({
        where: whereClause,
        include: {
          student: { include: { user: true } },
          exam: true
        },
        orderBy: { createdAt: 'desc' }
      });

      const userIds = Array.from(new Set(extensions.map(e => e.grantedById)));
      const granters = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, role: true }
      });
      const granterMap = new Map(granters.map(g => [g.id, g]));

      const formatted = extensions.map(ext => {
        const granter = granterMap.get(ext.grantedById);
        return {
          id: ext.id,
          studentExamId: ext.studentExamId,
          studentId: ext.studentId,
          studentName: ext.student.user.name,
          registerNumber: ext.student.registerNumber,
          examId: ext.examId,
          examTitle: ext.exam.title,
          extensionMinutes: ext.extensionMinutes,
          originalDeadline: ext.originalDeadline?.toISOString(),
          newDeadline: ext.newDeadline?.toISOString(),
          reason: ext.reason,
          grantedById: ext.grantedById,
          grantedByName: granter?.name || 'Authorized Proctor',
          grantedByEmail: granter?.email || '',
          grantedByRole: ext.grantedByRole,
          createdAt: ext.createdAt.toISOString()
        };
      });

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 3. Get Active Invigilation Sessions (Students taking test now)
  getActiveSessions: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const whereClause: any = {
        status: { in: ['started', 'in_progress', 'LOCKED'] }
      };

      if (user.role === 'faculty') {
        const faculty = await prisma.faculty.findUnique({ where: { userId: user.id } });
        if (faculty && faculty.collegeId) {
          whereClause.student = { collegeId: faculty.collegeId };
        }
      }

      const activeAttempts = await prisma.studentExam.findMany({
        where: whereClause,
        include: {
          student: { include: { user: true, college: true, department: true } },
          exam: { include: { subject: true } },
          timeExtensions: true
        },
        orderBy: { startedAt: 'desc' }
      });

      const formatted = activeAttempts.map(attempt => ({
        studentExamId: attempt.id,
        studentId: attempt.studentId,
        studentName: attempt.student.user.name,
        studentEmail: attempt.student.user.email,
        registerNumber: attempt.student.registerNumber,
        collegeName: attempt.student.college?.collegeName || 'General Institution',
        departmentName: attempt.student.department?.departmentName || 'General',
        examId: attempt.examId,
        examTitle: attempt.exam.title,
        subjectName: attempt.exam.subject?.subjectName || 'General Evaluation',
        duration: attempt.exam.duration,
        startedAt: attempt.startedAt.toISOString(),
        deadline: attempt.deadline?.toISOString() || null,
        timeRemaining: attempt.timeRemaining,
        warningCount: attempt.warningCount,
        status: attempt.status,
        totalExtensionMinutes: attempt.totalExtensionMinutes,
        extensionCount: attempt.timeExtensions.length
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  }
};

