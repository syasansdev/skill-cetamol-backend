import { Response, NextFunction } from 'express';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { getActiveThresholds, classifyScore } from '../utils/performanceClassification';

export const SuperAdminAssessmentController = {
  // 1. Centralized Assessment Creation & Multi-Institution Assignment
  createCentralAssessment: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden: Super Admin access required.' });
      }

      const {
        title,
        description,
        instructions,
        subjectId,
        departmentId,
        duration,
        durationMinutes,
        subject,
        totalMarks,
        questionCount,
        negativeMarking,
        marksPerQuestion,
        negativeMarks,
        startDate,
        endDate,
        targetYears,
        gradingThresholds,
        collegeIds, // array of selected college UUIDs
        questionIds, // optional array of selected question UUIDs from Question Bank
        publishedStatus // 'draft' | 'scheduled' | 'published'
      } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ message: 'Assessment title is required.' });
      }

      const finalDuration = Number(duration || durationMinutes || 60);
      if (!finalDuration || finalDuration <= 0) {
        return res.status(400).json({ message: 'A positive test duration in minutes is required.' });
      }

      // Resolve subjectId if either subjectId or subject name string was provided
      let resolvedSubjectId = subjectId || null;
      if (!resolvedSubjectId && subject) {
        const foundSub = await prisma.subject.findFirst({
          where: {
            OR: [
              { id: subject },
              { subjectName: { equals: subject, mode: 'insensitive' } }
            ]
          }
        });
        if (foundSub) {
          resolvedSubjectId = foundSub.id;
        } else if (typeof subject === 'string' && subject.trim()) {
          try {
            let course = await prisma.course.findFirst();
            if (!course) {
              let dept = await prisma.department.findFirst();
              if (!dept) {
                dept = await prisma.department.create({ data: { departmentName: 'General Academics' } });
              }
              course = await prisma.course.create({
                data: {
                  courseName: 'General Degree',
                  departmentId: dept.id
                }
              });
            }
            const createdSub = await prisma.subject.create({
              data: {
                subjectName: subject.trim(),
                courseId: course.id,
                semester: 1
              }
            });
            resolvedSubjectId = createdSub.id;
          } catch {
            // ignore if creation conflict occurs
          }
        }
      }

      // Find or create admin faculty evaluator profile to anchor exam
      let faculty = await prisma.faculty.findFirst({ where: { userId: user.id } });
      if (!faculty) {
        let generalDept = await prisma.department.findFirst();
        if (!generalDept) {
          generalDept = await prisma.department.create({ data: { departmentName: 'Central Assessment Office' } });
        }
        faculty = await prisma.faculty.create({
          data: {
            userId: user.id,
            departmentId: generalDept.id,
            designation: 'Super Administrator',
            experience: 10
          }
        });
      }

      const finalStartDate = startDate ? new Date(startDate) : new Date();
      const finalEndDate = endDate ? new Date(endDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const initialStatus = publishedStatus === 'published' ? 'active' : publishedStatus || 'draft';

      // Create Exam
      const exam = await prisma.exam.create({
        data: {
          title: title.trim(),
          description: description?.trim() || 'Centralized Assessment administered by Super Admin',
          instructions: instructions?.trim() || null,
          subjectId: resolvedSubjectId,
          facultyId: faculty.id,
          departmentId: departmentId || null,
          collegeId: null, // null indicates centrally created
          duration: finalDuration,
          totalMarks: totalMarks ? Number(totalMarks) : (Number(questionCount || 10) * (marksPerQuestion || 1)),
          questionCount: questionCount ? Number(questionCount) : 10,
          negativeMarking: !!negativeMarking,
          marksPerQuestion: marksPerQuestion ? Number(marksPerQuestion) : 1.0,
          negativeMarks: negativeMarks ? Number(negativeMarks) : 0.0,
          startDate: finalStartDate,
          endDate: finalEndDate,
          status: initialStatus,
          publishedStatus: publishedStatus || 'draft',
          targetYears: targetYears || 'all',
          gradingThresholds: gradingThresholds ? (typeof gradingThresholds === 'string' ? gradingThresholds : JSON.stringify(gradingThresholds)) : null
        }
      });

      // 2. Link Questions from Question Bank
      let selectedQIds: string[] = [];
      if (questionIds && Array.isArray(questionIds) && questionIds.length > 0) {
        selectedQIds = questionIds;
      } else if (resolvedSubjectId) {
        const pool = await prisma.question.findMany({
          where: { subjectId: resolvedSubjectId },
          take: exam.questionCount || 20
        });
        selectedQIds = pool.map(q => q.id);
      } else {
        // Fallback: pick any questions from pool
        const pool = await prisma.question.findMany({
          take: exam.questionCount || 20
        });
        selectedQIds = pool.map(q => q.id);
      }

      if (selectedQIds.length > 0) {
        await prisma.examQuestion.createMany({
          data: selectedQIds.map(qId => ({ examId: exam.id, questionId: qId })),
          skipDuplicates: true
        });

        // Ensure questionCount matches actual linked questions count
        await prisma.exam.update({
          where: { id: exam.id },
          data: { questionCount: selectedQIds.length }
        });
      }

      // 3. Multi-Institution Assignment
      if (collegeIds && Array.isArray(collegeIds) && collegeIds.length > 0) {
        const assignments = collegeIds.map((cId: string) => ({
          examId: exam.id,
          collegeId: cId,
          status: publishedStatus || 'draft',
          publishedAt: publishedStatus === 'published' ? new Date() : null
        }));

        await prisma.institutionAssessment.createMany({
          data: assignments,
          skipDuplicates: true
        });
      }

      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: `Super Admin created centralized assessment "${exam.title}" assigned to ${collegeIds?.length || 0} institution(s).`
        }
      });

      return res.status(201).json({
        success: true,
        message: 'Central assessment created successfully.',
        exam
      });
    } catch (error) {
      next(error);
    }
  },

  // 2. Publish or Update Publishing Status
  publishAssessment: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { collegeIds, status, startDate, endDate } = req.body; // status: 'published' | 'scheduled' | 'draft' | 'archived'

      const user = req.user;
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden: Super Admin access required.' });
      }

      const exam = await prisma.exam.findUnique({
        where: { id },
        include: { institutionAssessments: true, examQuestions: true }
      });

      if (!exam) {
        return res.status(404).json({ message: 'Assessment not found.' });
      }

      const newPublishedStatus = status || 'published';
      let dynamicStatus = newPublishedStatus === 'published' ? 'active' : newPublishedStatus;

      // Update exam dates & status
      await prisma.exam.update({
        where: { id },
        data: {
          status: dynamicStatus,
          publishedStatus: newPublishedStatus,
          ...(startDate ? { startDate: new Date(startDate) } : {}),
          ...(endDate ? { endDate: new Date(endDate) } : {})
        }
      });

      // Update institution assignments if provided
      if (collegeIds && Array.isArray(collegeIds)) {
        // Remove existing institutions not in new list
        await prisma.institutionAssessment.deleteMany({
          where: {
            examId: id,
            collegeId: { notIn: collegeIds }
          }
        });

        // Upsert new list
        for (const cId of collegeIds) {
          await prisma.institutionAssessment.upsert({
            where: { examId_collegeId: { examId: id, collegeId: cId } },
            update: {
              status: newPublishedStatus,
              publishedAt: newPublishedStatus === 'published' ? new Date() : undefined
            },
            create: {
              examId: id,
              collegeId: cId,
              status: newPublishedStatus,
              publishedAt: newPublishedStatus === 'published' ? new Date() : null
            }
          });
        }
      } else {
        // Update status for all currently assigned institutions
        await prisma.institutionAssessment.updateMany({
          where: { examId: id },
          data: {
            status: newPublishedStatus,
            publishedAt: newPublishedStatus === 'published' ? new Date() : undefined
          }
        });
      }

      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: `Super Admin updated publishing status for "${exam.title}" to ${newPublishedStatus}`
        }
      });

      return res.status(200).json({
        success: true,
        message: `Assessment status successfully updated to "${newPublishedStatus}".`
      });
    } catch (error) {
      next(error);
    }
  },

  // 3. Central Assessment Overview List
  getCentralAssessments: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      let whereClause: any = {};
      if (req.user && req.user.role === 'faculty') {
        const faculty = await prisma.faculty.findUnique({
          where: { userId: req.user.id }
        });
        if (faculty?.collegeId) {
          whereClause = {
            OR: [
              { collegeId: faculty.collegeId },
              {
                institutionAssessments: {
                  some: {
                    collegeId: faculty.collegeId,
                    status: { in: ['published', 'active'] }
                  }
                }
              },
              { collegeId: null, institutionAssessments: { none: {} } }
            ]
          };
        } else {
          whereClause = {
            OR: [
              { facultyId: faculty?.id || '__none__' },
              { collegeId: null, institutionAssessments: { none: {} } }
            ]
          };
        }
      }

      const exams = await prisma.exam.findMany({
        where: whereClause,
        include: {
          subject: true,
          institutionAssessments: {
            include: { college: true }
          },
          _count: {
            select: {
              results: true,
              studentExams: true,
              examQuestions: true
            }
          }
        },
        orderBy: { startDate: 'desc' }
      });

      const formatted = (exams || []).map(e => ({
        id: e.id,
        title: e.title,
        description: e.description,
        instructions: e.instructions || '',
        subject: e.subject?.subjectName || 'General Evaluation',
        subjectName: e.subject?.subjectName || 'General Evaluation',
        subjectId: e.subjectId,
        duration: e.duration,
        durationMinutes: e.duration,
        totalMarks: e.totalMarks,
        passingMarks: Math.round(Number(e.totalMarks || 100) * 0.4),
        questionCount: e.questionCount || e._count?.examQuestions || 0,
        questionsCount: e.questionCount || e._count?.examQuestions || 0,
        startDate: e.startDate ? e.startDate.toISOString() : new Date().toISOString(),
        endDate: e.endDate ? e.endDate.toISOString() : new Date().toISOString(),
        status: e.status,
        publishedStatus: e.publishedStatus || 'published',
        assignedInstitutionsCount: e.institutionAssessments ? e.institutionAssessments.length : 0,
        assignedInstitutions: (e.institutionAssessments || []).map(ia => ({
          id: ia.id,
          collegeId: ia.collegeId,
          collegeName: ia.college?.collegeName || 'Unknown College',
          collegeCode: ia.college?.code || '',
          status: ia.status,
          publishedAt: ia.publishedAt ? ia.publishedAt.toISOString() : ''
        })),
        completedCount: e._count?.results || 0,
        startedCount: e._count?.studentExams || 0,
        createdAt: e.startDate ? e.startDate.toISOString() : new Date().toISOString()
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  // 4. Cross-Institution Monitoring Console
  getCrossInstitutionMonitoring: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { examId } = req.params;

      const exam = await prisma.exam.findUnique({
        where: { id: examId },
        include: {
          subject: true,
          institutionAssessments: {
            include: {
              college: {
                include: {
                  _count: { select: { students: true } }
                }
              }
            }
          }
        }
      });

      if (!exam) {
        return res.status(404).json({ message: 'Assessment not found.' });
      }

      // Fetch all student attempts and results for this exam
      const results = await prisma.result.findMany({
        where: { examId },
        include: {
          student: { include: { college: true, user: true } }
        }
      });

      const studentExams = await prisma.studentExam.findMany({
        where: { examId },
        include: {
          student: { include: { college: true } }
        }
      });

      const thresholds = await getActiveThresholds();

      // Aggregate stats per assigned institution
      const assignedColleges = exam.institutionAssessments.map(ia => ia.college);
      // If none assigned explicitly, collect all colleges with participating students
      const allCollegesMap = new Map<string, any>();
      assignedColleges.forEach(c => allCollegesMap.set(c.id, c));
      results.forEach(r => {
        if (r.student.college && !allCollegesMap.has(r.student.college.id)) {
          allCollegesMap.set(r.student.college.id, r.student.college);
        }
      });

      const institutionReports = Array.from(allCollegesMap.values()).map(college => {
        const collegeStudentsCount = college._count?.students || 0;
        const collegeAttempts = studentExams.filter(se => se.student.collegeId === college.id);
        const collegeResults = results.filter(r => r.student.collegeId === college.id);

        const scores = collegeResults.map(r => r.percentage);
        const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
        const passCount = collegeResults.filter(r => r.status === 'pass').length;
        const passPercentage = collegeResults.length > 0 ? Math.round((passCount / collegeResults.length) * 100) : 0;

        const { category: topCategory, color } = classifyScore(avgScore, thresholds);

        return {
          collegeId: college.id,
          collegeName: college.collegeName,
          registeredStudents: collegeStudentsCount,
          startedAssessments: collegeAttempts.length,
          completedAssessments: collegeResults.length,
          completionRate: collegeAttempts.length > 0 ? Math.round((collegeResults.length / collegeAttempts.length) * 100) : 0,
          averageScore: avgScore,
          passPercentage,
          performanceCategory: topCategory,
          categoryColor: color
        };
      });

      // Overall assessment KPI summary
      const allScores = results.map(r => r.percentage);
      const overallAvg = allScores.length > 0 ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10 : 0;

      return res.status(200).json({
        exam: {
          id: exam.id,
          title: exam.title,
          subjectName: exam.subject?.subjectName || 'General',
          totalMarks: exam.totalMarks,
          duration: exam.duration,
          publishedStatus: exam.publishedStatus,
          startDate: exam.startDate.toISOString(),
          endDate: exam.endDate.toISOString()
        },
        summary: {
          totalAssignedInstitutions: allCollegesMap.size,
          totalStarted: studentExams.length,
          totalCompleted: results.length,
          overallAverageScore: overallAvg
        },
        institutionReports
      });
    } catch (error) {
      next(error);
    }
  }
};

