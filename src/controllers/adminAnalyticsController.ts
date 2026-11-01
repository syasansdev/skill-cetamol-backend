import { Response, NextFunction } from 'express';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { getActiveThresholds, classifyScore } from '../utils/performanceClassification';

export const AdminAnalyticsController = {
  // 1. Consolidated Student Performance Dashboard
  getConsolidatedDashboard: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const { collegeId, examId, subjectId, category, startDate, endDate, search } = req.query;

      // 1. Institution Isolation Gating
      let authorizedCollegeId: string | null = null;
      let isSuperAdmin = false;

      if (user.role === 'admin') {
        // Check if admin has college restriction or is global super-admin
        const adminUser = await prisma.user.findUnique({
          where: { id: user.id },
          include: { faculty: true }
        });
        if (adminUser?.faculty?.collegeId) {
          authorizedCollegeId = adminUser.faculty.collegeId;
        } else {
          isSuperAdmin = true;
        }
      } else if (user.role === 'faculty') {
        const faculty = await prisma.faculty.findUnique({ where: { userId: user.id } });
        if (faculty?.collegeId) {
          authorizedCollegeId = faculty.collegeId;
        }
      }

      // If user is restricted to a college, enforce it strictly
      const effectiveCollegeId = authorizedCollegeId || (collegeId && collegeId !== 'all' ? String(collegeId) : null);

      // Student filters
      const studentWhere: any = {};
      if (effectiveCollegeId) {
        studentWhere.collegeId = effectiveCollegeId;
      }
      if (search && String(search).trim()) {
        const term = String(search).trim();
        studentWhere.OR = [
          { user: { name: { contains: term, mode: 'insensitive' } } },
          { user: { email: { contains: term, mode: 'insensitive' } } },
          { registerNumber: { contains: term, mode: 'insensitive' } }
        ];
      }

      // Fetch students within scope
      const students = await prisma.student.findMany({
        where: studentWhere,
        include: {
          user: true,
          college: true,
          department: true
        }
      });

      const studentIds = students.map(s => s.id);

      // Results where clause
      const resultWhere: any = {
        studentId: { in: studentIds }
      };

      if (examId && examId !== 'all') {
        resultWhere.examId = String(examId);
      }
      if (subjectId && subjectId !== 'all') {
        resultWhere.exam = { subjectId: String(subjectId) };
      }

      const results = await prisma.result.findMany({
        where: resultWhere,
        include: {
          exam: {
            include: { subject: true, college: true }
          },
          student: {
            include: { user: true, college: true, department: true }
          }
        },
        orderBy: { id: 'desc' }
      });

      const studentExams = await prisma.studentExam.findMany({
        where: {
          studentId: { in: studentIds },
          ...(examId && examId !== 'all' ? { examId: String(examId) } : {})
        },
        include: { questionTimings: true }
      });

      const seMap = new Map<string, any>();
      studentExams.forEach(se => seMap.set(`${se.studentId}-${se.examId}`, se));

      const thresholds = await getActiveThresholds();

      // Date filtering
      let filteredResults = results.map(r => {
        const se = seMap.get(`${r.studentId}-${r.examId}`);
        const attemptDate = se?.submittedAt || se?.startedAt || r.exam?.startDate || new Date();
        const { category: cat, color } = classifyScore(r.percentage, thresholds);
        return {
          ...r,
          attemptDate: new Date(attemptDate),
          se,
          calculatedCategory: cat,
          categoryColor: color
        };
      });

      if (startDate) {
        const s = new Date(String(startDate));
        filteredResults = filteredResults.filter(r => r.attemptDate >= s);
      }
      if (endDate) {
        const e = new Date(String(endDate));
        e.setHours(23, 59, 59, 999);
        filteredResults = filteredResults.filter(r => r.attemptDate <= e);
      }

      if (category && category !== 'all') {
        filteredResults = filteredResults.filter(r => r.calculatedCategory === category);
      }

      // Group performance per student
      const studentMetricsMap = new Map<string, {
        student: any;
        scores: number[];
        testsTaken: number;
        resultsList: any[];
      }>();

      students.forEach(s => {
        studentMetricsMap.set(s.id, {
          student: s,
          scores: [],
          testsTaken: 0,
          resultsList: []
        });
      });

      filteredResults.forEach(r => {
        const m = studentMetricsMap.get(r.studentId);
        if (m) {
          m.scores.push(r.percentage);
          m.testsTaken += 1;
          m.resultsList.push(r);
        }
      });

      // Calculate Category Distribution across all completed results
      const categoryDistributionCounts: Record<string, number> = {
        'Exceptional': 0,
        'Good': 0,
        'Average': 0,
        'Needs Improvement': 0
      };

      filteredResults.forEach(r => {
        categoryDistributionCounts[r.calculatedCategory] = (categoryDistributionCounts[r.calculatedCategory] || 0) + 1;
      });

      // Assessment-wise comparison
      const examMap = new Map<string, { title: string; scores: number[]; attendees: Set<string> }>();
      filteredResults.forEach(r => {
        const exTitle = r.exam?.title || 'Assessment';
        if (!examMap.has(r.examId)) {
          examMap.set(r.examId, { title: exTitle, scores: [], attendees: new Set() });
        }
        const em = examMap.get(r.examId)!;
        em.scores.push(r.percentage);
        em.attendees.add(r.studentId);
      });

      const assessmentWiseComparison = Array.from(examMap.entries()).map(([id, data]) => {
        const avg = data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : 0;
        return {
          examId: id,
          title: data.title.length > 18 ? data.title.substring(0, 16) + '...' : data.title,
          fullTitle: data.title,
          averageScore: avg,
          candidatesCount: data.attendees.size
        };
      });

      // Subject-wise performance
      const subjectMap = new Map<string, { subjectName: string; scores: number[] }>();
      filteredResults.forEach(r => {
        const subName = r.exam?.subject?.subjectName || 'General Evaluation';
        if (!subjectMap.has(subName)) {
          subjectMap.set(subName, { subjectName: subName, scores: [] });
        }
        subjectMap.get(subName)!.scores.push(r.percentage);
      });

      const subjectWisePerformance = Array.from(subjectMap.values()).map(sub => {
        const avg = Math.round(sub.scores.reduce((a, b) => a + b, 0) / sub.scores.length);
        const { category: cat, color } = classifyScore(avg, thresholds);
        return {
          subjectName: sub.subjectName,
          averageScore: avg,
          assessmentsCount: sub.scores.length,
          category: cat,
          color
        };
      });

      // Student performance table records
      const studentPerformanceRows: any[] = [];
      const studentsRequiringSupport: any[] = [];

      studentMetricsMap.forEach((data, sId) => {
        const s = data.student;
        if (data.testsTaken > 0) {
          const avgScore = Math.round((data.scores.reduce((a, b) => a + b, 0) / data.testsTaken) * 10) / 10;
          const { category: cat, color } = classifyScore(avgScore, thresholds);
          const highestScore = Math.round(Math.max(...data.scores));

          const row = {
            studentId: s.id,
            name: s.user.name,
            email: s.user.email,
            registerNumber: s.registerNumber,
            collegeName: s.college?.collegeName || 'General College',
            departmentName: s.department?.departmentName || 'General',
            testsCompleted: data.testsTaken,
            averageScore: avgScore,
            highestScore,
            category: cat,
            color
          };

          studentPerformanceRows.push(row);

          if (cat === 'Needs Improvement') {
            studentsRequiringSupport.push({
              ...row,
              academicRisk: 'High Risk',
              actionRequired: 'Provide remedial question modules & schedule practice session.'
            });
          }
        } else if (!category || category === 'all') {
          // Include enrolled students who haven't attempted if no category filter
          studentPerformanceRows.push({
            studentId: s.id,
            name: s.user.name,
            email: s.user.email,
            registerNumber: s.registerNumber,
            collegeName: s.college?.collegeName || 'General College',
            departmentName: s.department?.departmentName || 'General',
            testsCompleted: 0,
            averageScore: 0,
            highestScore: 0,
            category: 'Not Attempted',
            color: '#94a3b8'
          });
        }
      });

      // Sort performance table descending by average score
      studentPerformanceRows.sort((a, b) => b.averageScore - a.averageScore);

      // KPI Calculations
      const totalStudents = students.length;
      const totalAssessments = (await prisma.exam.count({
        where: effectiveCollegeId ? { OR: [{ collegeId: effectiveCollegeId }, { collegeId: null }] } : {}
      }));
      const completedAssessments = filteredResults.length;
      const allPercentages = filteredResults.map(r => r.percentage);
      const averageStudentScore = allPercentages.length > 0
        ? Math.round((allPercentages.reduce((a, b) => a + b, 0) / allPercentages.length) * 10) / 10
        : 0;

      const categoryDistribution = [
        { name: 'Exceptional', count: categoryDistributionCounts['Exceptional'] || 0, color: '#10b981' },
        { name: 'Good', count: categoryCounts(categoryDistributionCounts['Good']), color: '#3b82f6' },
        { name: 'Average', count: categoryDistributionCounts['Average'] || 0, color: '#f59e0b' },
        { name: 'Needs Improvement', count: categoryDistributionCounts['Needs Improvement'] || 0, color: '#ef4444' }
      ];

      return res.status(200).json({
        isSuperAdmin,
        authorizedCollegeId,
        kpiCards: {
          totalStudents,
          totalAssessments,
          completedAssessments,
          averageStudentScore,
          studentsNeedingImprovement: studentsRequiringSupport.length
        },
        categoryDistribution,
        assessmentWiseComparison: assessmentWiseComparison.slice(0, 10),
        subjectWisePerformance,
        studentsRequiringSupport: studentsRequiringSupport.slice(0, 15),
        studentPerformanceTable: studentPerformanceRows
      });
    } catch (error) {
      next(error);
    }
  },

  // 2. Individual Student Performance Profile (Administrator Drill-Down)
  getStudentProfile: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { studentId } = req.params;
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: { user: true, college: true, department: true }
      });

      if (!student) {
        return res.status(404).json({ message: 'Student record not found.' });
      }

      // Security Check: Institution Isolation
      if (user.role === 'faculty') {
        const faculty = await prisma.faculty.findUnique({ where: { userId: user.id } });
        if (faculty?.collegeId && student.collegeId && faculty.collegeId !== student.collegeId) {
          return res.status(403).json({ message: 'Forbidden: Access restricted to authorized institution only.' });
        }
      }

      const results = await prisma.result.findMany({
        where: { studentId },
        include: {
          exam: { include: { subject: true } }
        },
        orderBy: { id: 'desc' }
      });

      const thresholds = await getActiveThresholds();

      const assessmentHistory = results.map(r => {
        const { category, color } = classifyScore(r.percentage, thresholds);
        return {
          id: r.id,
          examId: r.examId,
          examTitle: r.exam.title,
          subjectName: r.exam.subject?.subjectName || 'General',
          percentage: r.percentage,
          rank: r.rank || 1,
          category,
          color,
          status: r.status
        };
      });

      const scores = results.map(r => r.percentage);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      const { category: overallCat, color: overallColor } = classifyScore(avgScore, thresholds);

      return res.status(200).json({
        student: {
          id: student.id,
          name: student.user.name,
          email: student.user.email,
          registerNumber: student.registerNumber,
          college: student.college?.collegeName || 'N/A',
          department: student.department?.departmentName || 'N/A',
          year: student.year
        },
        summary: {
          totalTests: results.length,
          averageScore: avgScore,
          highestScore: scores.length > 0 ? Math.max(...scores) : 0,
          overallCategory: overallCat,
          overallColor
        },
        assessmentHistory
      });
    } catch (error) {
      next(error);
    }
  }
};

function categoryCounts(val: any): number {
  return typeof val === 'number' ? val : 0;
}

