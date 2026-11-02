import { Response, NextFunction } from 'express';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { getActiveThresholds, classifyScore, normalizeCategory, GRADE_EMOJIS } from '../utils/performanceClassification';
import { evaluateExamAnswers } from '../utils/examUtils';

export const StudentAnalyticsController = {
  // 1. Student Master Analytics Dashboard
  getMasterAnalytics: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id },
        include: { user: true, college: true, department: true }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      const { startDate, endDate, subjectId } = req.query;

      const whereClause: any = { studentId: student.id };
      if (subjectId && subjectId !== 'all') {
        whereClause.exam = { subjectId: String(subjectId) };
      }

      // Fetch all completed results for this student
      const results = await prisma.result.findMany({
        where: whereClause,
        include: {
          exam: {
            include: {
              subject: true,
              examQuestions: { include: { question: true } }
            }
          }
        },
        orderBy: { id: 'asc' }
      });

      const examIds = results.map(r => r.examId);
      const studentExams = await prisma.studentExam.findMany({
        where: {
          studentId: student.id,
          examId: { in: examIds }
        },
        include: {
          questionTimings: true,
          studentAnswers: true
        }
      });

      const seMap = new Map<string, any>();
      studentExams.forEach(se => seMap.set(se.examId, se));

      const thresholds = await getActiveThresholds();

      // Filter by date if provided
      let filteredResults = results.map(r => {
        const se = seMap.get(r.examId);
        const attemptDate = se?.submittedAt || se?.startedAt || r.exam?.startDate || new Date();
        return { ...r, attemptDate: new Date(attemptDate), se };
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

      const totalTestsCompleted = filteredResults.length;

      if (totalTestsCompleted === 0) {
        return res.status(200).json({
          kpiCards: {
            totalTestsCompleted: 0,
            averageScore: 0,
            highestScore: 0,
            overallPerformanceCategory: 'Needs Improvement',
            categoryColor: '#ef4444',
            averageTimePerQuestion: 0,
            performanceImprovement: 0
          },
          recentActivity: [],
          performanceTrend: [],
          assessmentComparison: [],
          categoryDistribution: [
            { name: 'Outstanding', count: 0, color: '#10b981', emoji: '🌟' },
            { name: 'Proficient', count: 0, color: '#3b82f6', emoji: '🎯' },
            { name: 'Competent', count: 0, color: '#06b6d4', emoji: '✅' },
            { name: 'Developing', count: 0, color: '#f59e0b', emoji: '📈' },
            { name: 'Needs Improvement', count: 0, color: '#ef4444', emoji: '⚠️' }
          ],
          subjectPerformance: [],
          strongestSubjects: [],
          weakestSubjects: [],
          areasForPractice: [],
          timeManagementTrend: []
        });
      }

      // 1. KPI Calculations
      const scores = filteredResults.map(r => r.percentage);
      const sumScore = scores.reduce((a, b) => a + b, 0);
      const averageScore = Math.round((sumScore / totalTestsCompleted) * 10) / 10;
      const highestScore = Math.round(Math.max(...scores) * 10) / 10;
      const { category: overallCategory, color: categoryColor } = classifyScore(averageScore, thresholds);

      // Performance improvement: compare average of first 30% vs last 30% of tests
      let performanceImprovement = 0;
      if (filteredResults.length >= 2) {
        const half = Math.floor(filteredResults.length / 2);
        const earlierSlice = filteredResults.slice(0, Math.max(1, half));
        const recentSlice = filteredResults.slice(Math.max(1, half));
        const earlierAvg = earlierSlice.reduce((acc, r) => acc + r.percentage, 0) / earlierSlice.length;
        const recentAvg = recentSlice.reduce((acc, r) => acc + r.percentage, 0) / recentSlice.length;
        performanceImprovement = Math.round((recentAvg - earlierAvg) * 10) / 10;
      }

      // Timing calculations
      let grandTotalActiveTime = 0;
      let grandTotalQuestionsAttempted = 0;

      // Category distribution counts
      const categoryCounts: Record<string, number> = {
        'Outstanding': 0,
        'Proficient': 0,
        'Competent': 0,
        'Developing': 0,
        'Needs Improvement': 0
      };

      // Subject groupings
      const subjectMap: Record<string, { subjectName: string; scores: number[]; times: number[] }> = {};

      const performanceTrend: any[] = [];
      const assessmentComparison: any[] = [];
      const timeManagementTrend: any[] = [];
      const recentActivity: any[] = [];

      filteredResults.forEach(r => {
        const se = r.se;
        const { category, color } = classifyScore(r.percentage, thresholds);
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;

        // Timings for this exam
        const timings = se?.questionTimings || [];
        const examActiveTime = timings.reduce((acc: number, t: any) => acc + (t.timeSpentSeconds || 0), 0);
        const attemptedQCount = timings.filter((t: any) => t.timeSpentSeconds > 0).length || r.exam?.examQuestions?.length || 1;
        const examAvgQTime = attemptedQCount > 0 ? Math.round(examActiveTime / attemptedQCount) : 0;

        grandTotalActiveTime += examActiveTime > 0 ? examActiveTime : (se?.submittedAt && se?.startedAt ? (new Date(se.submittedAt).getTime() - new Date(se.startedAt).getTime()) / 1000 : 600);
        grandTotalQuestionsAttempted += attemptedQCount;

        const subName = r.exam?.subject?.subjectName || 'General Aptitude';
        if (!subjectMap[subName]) {
          subjectMap[subName] = { subjectName: subName, scores: [], times: [] };
        }
        subjectMap[subName].scores.push(r.percentage);
        if (examAvgQTime > 0) subjectMap[subName].times.push(examAvgQTime);

        const dateStr = r.attemptDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        performanceTrend.push({
          date: dateStr,
          timestamp: r.attemptDate.toISOString(),
          examTitle: r.exam?.title,
          Score: Math.round(r.percentage),
          percentage: Math.round(r.percentage),
          category,
          color
        });

        assessmentComparison.push({
          examTitle: r.exam?.title?.length > 18 ? r.exam.title.substring(0, 16) + '...' : r.exam?.title,
          fullTitle: r.exam?.title,
          score: Math.round(r.percentage),
          totalMarks: r.exam?.totalMarks || 100,
          category,
          color
        });

        timeManagementTrend.push({
          examTitle: r.exam?.title?.length > 16 ? r.exam.title.substring(0, 14) + '...' : r.exam?.title,
          fullTitle: r.exam?.title,
          avgSecondsPerQuestion: examAvgQTime || 45,
          totalDurationMinutes: Math.round((examActiveTime > 0 ? examActiveTime : 600) / 60)
        });

        recentActivity.push({
          id: r.id,
          examId: r.examId,
          examTitle: r.exam?.title,
          subjectName: subName,
          percentage: Math.round(r.percentage),
          category,
          grade: category,
          emoji: GRADE_EMOJIS[category] || '📊',
          displayGrade: `${GRADE_EMOJIS[category] || '📊'} ${category}`,
          color,
          date: r.attemptDate.toISOString(),
          timeTakenSeconds: examActiveTime
        });
      });

      // Overall average time per question in seconds
      const overallAvgTimePerQuestion = grandTotalQuestionsAttempted > 0
        ? Math.round(grandTotalActiveTime / grandTotalQuestionsAttempted)
        : 45;

      // Subject performance breakdown
      const subjectPerformance = Object.values(subjectMap).map(s => {
        const avg = Math.round((s.scores.reduce((a, b) => a + b, 0) / s.scores.length) * 10) / 10;
        const highest = Math.round(Math.max(...s.scores) * 10) / 10;
        const { category, color } = classifyScore(avg, thresholds);
        return {
          subjectName: s.subjectName,
          averageScore: avg,
          highestScore: highest,
          testsTaken: s.scores.length,
          category,
          color
        };
      });

      // Sort subjects by averageScore descending
      const sortedSubjects = [...subjectPerformance].sort((a, b) => b.averageScore - a.averageScore);
      const strongestSubjects = sortedSubjects.filter(s => s.averageScore >= 75);
      const weakestSubjects = sortedSubjects.filter(s => s.averageScore < 75);

      // Areas requiring additional practice
      const areasForPractice = weakestSubjects.map(w => ({
        subjectName: w.subjectName,
        currentScore: w.averageScore,
        category: w.category,
        recommendation: w.averageScore < 50
          ? 'Priority Remediation: Review foundational question sets and attempt targeted quizzes.'
          : 'Refinement Required: Practice timed question sets to improve speed and consistency.'
      }));

      const categoryDistribution = [
        { name: 'Outstanding', count: categoryCounts['Outstanding'] || 0, color: '#10b981', emoji: '🌟' },
        { name: 'Proficient', count: categoryCounts['Proficient'] || 0, color: '#3b82f6', emoji: '🎯' },
        { name: 'Competent', count: categoryCounts['Competent'] || 0, color: '#06b6d4', emoji: '✅' },
        { name: 'Developing', count: categoryCounts['Developing'] || 0, color: '#f59e0b', emoji: '📈' },
        { name: 'Needs Improvement', count: categoryCounts['Needs Improvement'] || 0, color: '#ef4444', emoji: '⚠️' }
      ];

      // Sort recent activity descending
      recentActivity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return res.status(200).json({
        student: {
          id: student.id,
          name: student.user.name,
          registerNumber: student.registerNumber,
          college: student.college?.collegeName || 'General Institution',
          department: student.department?.departmentName || 'General'
        },
        kpiCards: {
          totalTestsCompleted,
          averageScore,
          highestScore,
          overallPerformanceCategory: overallCategory,
          grade: overallCategory,
          emoji: GRADE_EMOJIS[overallCategory] || '📊',
          displayGrade: `${GRADE_EMOJIS[overallCategory] || '📊'} ${overallCategory}`,
          categoryColor,
          averageTimePerQuestion: overallAvgTimePerQuestion,
          performanceImprovement
        },
        recentActivity: recentActivity.slice(0, 5),
        performanceTrend,
        assessmentComparison: assessmentComparison.slice(-10),
        categoryDistribution,
        subjectPerformance,
        strongestSubjects,
        weakestSubjects,
        areasForPractice,
        timeManagementTrend: timeManagementTrend.slice(-10)
      });
    } catch (error) {
      next(error);
    }
  },

  // 2. Individual Test Comprehensive Performance Report
  getIndividualReport: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params; // Result ID or Exam ID

      const student = await prisma.student.findUnique({
        where: { userId: req.user!.id },
        include: { user: true, college: true, department: true }
      });

      if (!student) {
        return res.status(403).json({ message: 'Student profile not found' });
      }

      // Find result
      const result = await prisma.result.findFirst({
        where: {
          OR: [{ id }, { examId: id }],
          studentId: student.id
        },
        include: {
          exam: {
            include: {
              subject: true,
              college: true,
              examQuestions: {
                include: {
                  question: { include: { options: true } }
                }
              }
            }
          }
        }
      });

      if (!result) {
        return res.status(404).json({ message: 'Assessment result not found.' });
      }

      const thresholds = await getActiveThresholds();
      const exam = result.exam;

      // Find candidate attempt and question timings
      const studentExam = await prisma.studentExam.findFirst({
        where: { studentId: student.id, examId: exam.id },
        include: {
          studentAnswers: true,
          questionTimings: true,
          timeExtensions: true
        }
      });

      // Prepare answer map
      const ansMap: Record<string, any> = {};
      if (studentExam?.studentAnswers) {
        studentExam.studentAnswers.forEach(ans => {
          if (ans.selectedOption !== null && ans.selectedOption !== '') {
            ansMap[ans.questionId] = ans.selectedOption.includes(',') ? ans.selectedOption.split(',') : ans.selectedOption;
          } else if (ans.answerText !== null && ans.answerText !== '') {
            ansMap[ans.questionId] = ans.answerText;
          }
        });
      }

      const evalRes = evaluateExamAnswers(exam, student.id, ansMap);
      const { category: classificationCategory, color: classificationColor, description: classificationDesc } = classifyScore(evalRes.percentage, thresholds);

      // Question-wise timings
      const timingMap = new Map<string, number>();
      if (studentExam?.questionTimings) {
        studentExam.questionTimings.forEach(qt => {
          timingMap.set(qt.questionId, qt.timeSpentSeconds);
        });
      }

      let totalActiveSeconds = 0;
      let minTimeSeconds = Infinity;
      let maxTimeSeconds = 0;
      let longestQuestionNumber = 1;
      let shortestQuestionNumber = 1;

      const questionsAnalysis = evalRes.detailedQuestions.map((q, idx) => {
        const qNumber = idx + 1;
        const timeSpent = timingMap.get(q.id) || 0;
        totalActiveSeconds += timeSpent;

        if (timeSpent > maxTimeSeconds) {
          maxTimeSeconds = timeSpent;
          longestQuestionNumber = qNumber;
        }
        if (timeSpent > 0 && timeSpent < minTimeSeconds) {
          minTimeSeconds = timeSpent;
          shortestQuestionNumber = qNumber;
        }

        return {
          questionNumber: qNumber,
          questionId: q.id,
          questionText: q.text,
          type: q.type,
          options: q.options,
          studentAnswer: q.studentOption,
          correctAnswer: q.correctAnswer,
          isCorrect: q.isCorrect,
          marksAwarded: q.marksAwarded,
          difficulty: q.difficulty,
          timeSpentSeconds: timeSpent
        };
      });

      if (minTimeSeconds === Infinity) minTimeSeconds = 0;

      const attemptedQuestionsCount = questionsAnalysis.filter(q => q.studentAnswer !== null && q.studentAnswer !== '').length;
      const unattemptedQuestionsCount = questionsAnalysis.length - attemptedQuestionsCount;
      const averageTimePerQuestion = attemptedQuestionsCount > 0
        ? Math.round((totalActiveSeconds / attemptedQuestionsCount) * 10) / 10
        : (questionsAnalysis.length > 0 ? Math.round((totalActiveSeconds / questionsAnalysis.length) * 10) / 10 : 0);

      const submissionDate = studentExam?.submittedAt || exam.endDate || new Date();

      const report = {
        // Section A: Assessment Information
        assessmentInfo: {
          testName: exam.title,
          description: exam.description,
          instructions: exam.instructions,
          subjectName: exam.subject ? exam.subject.subjectName : 'General Assessment',
          subjectCode: exam.subject ? exam.subject.id.substring(0, 6).toUpperCase() : 'GEN-01',
          assessmentDate: submissionDate.toISOString(),
          durationMinutes: exam.duration,
          totalQuestions: evalRes.assignedEqs.length,
          totalMarks: evalRes.totalPoints
        },

        // Section B: Performance Summary
        performanceSummary: {
          marksObtained: evalRes.score,
          maximumMarks: evalRes.totalPoints,
          percentage: evalRes.percentage,
          status: evalRes.status,
          performanceCategory: classificationCategory,
          grade: classificationCategory,
          emoji: GRADE_EMOJIS[classificationCategory] || '📊',
          displayGrade: `${GRADE_EMOJIS[classificationCategory] || '📊'} ${classificationCategory}`,
          categoryColor: classificationColor,
          categoryDescription: classificationDesc,
          rank: result.rank || 1,
          correctAnswers: evalRes.correctCount,
          incorrectAnswers: evalRes.wrongCount,
          unattemptedQuestions: unattemptedQuestionsCount,
          attemptedQuestions: attemptedQuestionsCount
        },

        // Section C: Visual Analytics & Timing Breakdown
        visualAnalytics: {
          totalActiveTimeSeconds: totalActiveSeconds,
          averageTimePerQuestionSeconds: averageTimePerQuestion,
          longestQuestionTimeSeconds: maxTimeSeconds,
          longestQuestionNumber,
          shortestQuestionTimeSeconds: minTimeSeconds,
          shortestQuestionNumber,
          questionTimingChartData: questionsAnalysis.map(q => ({
            question: `Q${q.questionNumber}`,
            questionNumber: q.questionNumber,
            timeSpent: q.timeSpentSeconds,
            isCorrect: q.isCorrect,
            status: q.isCorrect ? 'Correct' : (q.studentAnswer ? 'Incorrect' : 'Skipped')
          })),
          scoreDistribution: [
            { name: 'Correct', value: evalRes.correctCount, color: '#10b981' },
            { name: 'Incorrect', value: evalRes.wrongCount, color: '#ef4444' },
            { name: 'Unattempted', value: unattemptedQuestionsCount, color: '#94a3b8' }
          ]
        },

        // Section D: Detailed Question Analysis
        questionAnalysis: questionsAnalysis,

        student: {
          id: student.id,
          name: student.user.name,
          registerNumber: student.registerNumber,
          email: student.user.email,
          college: student.college?.collegeName || 'General Institution',
          department: student.department?.departmentName || 'General'
        }
      };

      return res.status(200).json(report);
    } catch (error) {
      next(error);
    }
  }
};

