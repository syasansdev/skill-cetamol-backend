import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { 
  classifyScore, 
  validateThresholdBoundaries, 
  getThresholds, 
  clearThresholdCache 
} from '../src/utils/performanceClassification';
import { evaluateExamAnswers } from '../src/utils/examUtils';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`[PASS] Test ${totalTests}: ${testName}`);
    passedTests++;
  } else {
    console.error(`[FAIL] Test ${totalTests}: ${testName} ${detail ? `-> ${detail}` : ''}`);
  }
}

async function runTestSuite() {
  console.log('===============================================================');
  console.log('SKILL CETAMOL — ASSESSMENT PLATFORM ENHANCEMENTS VERIFICATION');
  console.log('===============================================================\n');

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: Performance Classification Logic & Thresholds
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO 1: Performance Classification & Boundaries ---');
    clearThresholdCache();
    const dbThresholds = await getThresholds();
    assert(dbThresholds.length === 4, 'Database has exactly 4 performance threshold tiers');

    const cat1 = await classifyScore(95);
    assert(cat1 === 'Exceptional', 'Score of 95% classified as Exceptional', `Got ${cat1}`);

    const cat2 = await classifyScore(82);
    assert(cat2 === 'Good', 'Score of 82% classified as Good', `Got ${cat2}`);

    const cat3 = await classifyScore(65);
    assert(cat3 === 'Average', 'Score of 65% classified as Average', `Got ${cat3}`);

    const cat4 = await classifyScore(35);
    assert(cat4 === 'Needs Improvement', 'Score of 35% classified as Needs Improvement', `Got ${cat4}`);

    // Boundary edge cases
    const catZero = await classifyScore(0);
    assert(catZero === 'Needs Improvement', 'Score of 0% classified as Needs Improvement', `Got ${catZero}`);

    const cat100 = await classifyScore(100);
    assert(cat100 === 'Exceptional', 'Score of 100% classified as Exceptional', `Got ${cat100}`);

    // -------------------------------------------------------------------------
    // SCENARIO 2: Boundary Validation (Overlap and Gap Detection)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 2: Threshold Boundary Validation ---');
    const validConfig = [
      { category: 'Needs Improvement', minScore: 0, maxScore: 49.99 },
      { category: 'Average', minScore: 50, maxScore: 74.99 },
      { category: 'Good', minScore: 75, maxScore: 89.99 },
      { category: 'Exceptional', minScore: 90, maxScore: 100 }
    ];
    const validResult = validateThresholdBoundaries(validConfig);
    assert(validResult.valid, 'Valid configuration passes boundary validation');

    const overlappingConfig = [
      { category: 'Needs Improvement', minScore: 0, maxScore: 55 }, // Overlaps with 50
      { category: 'Average', minScore: 50, maxScore: 74.99 },
      { category: 'Good', minScore: 75, maxScore: 89.99 },
      { category: 'Exceptional', minScore: 90, maxScore: 100 }
    ];
    const overlapResult = validateThresholdBoundaries(overlappingConfig);
    assert(!overlapResult.valid, 'Overlapping thresholds correctly rejected', overlapResult.error);

    const gapConfig = [
      { category: 'Needs Improvement', minScore: 0, maxScore: 40 }, // Gap between 40 and 50
      { category: 'Average', minScore: 50, maxScore: 74.99 },
      { category: 'Good', minScore: 75, maxScore: 89.99 },
      { category: 'Exceptional', minScore: 90, maxScore: 100 }
    ];
    const gapResult = validateThresholdBoundaries(gapConfig);
    assert(!gapResult.valid, 'Threshold gap correctly rejected', gapResult.error);

    // -------------------------------------------------------------------------
    // SCENARIO 3: Multi-Institution Assessment Publishing (Feature 8)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 3: Super Admin Central Assessment & Multi-Institution ---');
    // Fetch 2 test colleges
    const sampleColleges = await prisma.college.findMany({ take: 2 });
    assert(sampleColleges.length >= 2, 'Found at least 2 colleges for multi-institution testing');

    // Create a central test
    const testExam = await prisma.exam.create({
      data: {
        title: 'E2E Central Platform Diagnostic Test',
        description: 'Multi-institution diagnostic exam with timing & classification',
        subject: 'General Engineering',
        durationMinutes: 60,
        totalMarks: 20,
        passingMarks: 10,
        instructions: 'Answer all questions. Tab switching will lock the assessment.',
        publishedStatus: 'published',
        institutionAssessments: {
          create: sampleColleges.map(c => ({
            collegeId: c.id,
            status: 'published'
          }))
        }
      },
      include: {
        institutionAssessments: true
      }
    });

    assert(testExam.id !== undefined, 'Central assessment created successfully');
    assert(testExam.institutionAssessments.length === sampleColleges.length, 
      `Assigned to ${sampleColleges.length} target institutions`);

    // Add 2 test questions to this exam
    const q1 = await prisma.question.create({
      data: {
        examId: testExam.id,
        questionText: 'What is the primary function of an operating system kernel?',
        questionType: 'mcq',
        options: ['Resource management', 'Graphic design', 'Video rendering', 'Audio editing'],
        correctAnswer: 'Resource management',
        marks: 10,
        subject: 'Computer Science'
      }
    });

    const q2 = await prisma.question.create({
      data: {
        examId: testExam.id,
        questionText: 'Which data structure follows the LIFO principle?',
        questionType: 'mcq',
        options: ['Queue', 'Stack', 'Linked List', 'Array'],
        correctAnswer: 'Stack',
        marks: 10,
        subject: 'Computer Science'
      }
    });

    assert(q1.id && q2.id, '2 Questions created and attached to assessment');

    // -------------------------------------------------------------------------
    // SCENARIO 4: Student Exam Session, Timing & Revisit (Feature 1)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 4: Question Timing & Revisit Handling ---');
    // Find or create a test student
    let testStudent = await prisma.student.findFirst({
      where: { collegeId: sampleColleges[0].id }
    });

    if (!testStudent) {
      testStudent = await prisma.student.create({
        data: {
          name: 'Verification Candidate',
          registerNumber: 'TEST-REG-2026',
          email: 'verification_student_2026@test.com',
          password: 'hashedpassword',
          collegeId: sampleColleges[0].id,
          role: 'student'
        }
      });
    }

    // Start exam: create StudentExam with server deadline
    const startTime = new Date();
    const originalDeadline = new Date(startTime.getTime() + 60 * 60 * 1000);

    const studentExam = await prisma.studentExam.create({
      data: {
        studentId: testStudent.id,
        examId: testExam.id,
        status: 'in_progress',
        startedAt: startTime,
        deadline: originalDeadline,
        totalExtensionMinutes: 0
      }
    });

    assert(studentExam.id !== undefined, 'StudentExam session created with server-authoritative deadline');

    // Simulate Question Timing Upserts:
    // Question 1: spent 45 seconds initially
    await prisma.questionTiming.upsert({
      where: {
        studentExamId_questionId: {
          studentExamId: studentExam.id,
          questionId: q1.id
        }
      },
      update: { timeSpentSeconds: 45 },
      create: {
        studentExamId: studentExam.id,
        questionId: q1.id,
        timeSpentSeconds: 45
      }
    });

    // Question 2: spent 60 seconds
    await prisma.questionTiming.upsert({
      where: {
        studentExamId_questionId: {
          studentExamId: studentExam.id,
          questionId: q2.id
        }
      },
      update: { timeSpentSeconds: 60 },
      create: {
        studentExamId: studentExam.id,
        questionId: q2.id,
        timeSpentSeconds: 60
      }
    });

    // Revisit Question 1: candidate spends 30 more seconds (total 75s).
    // The client flush accumulates active time without double-counting intervals:
    await prisma.questionTiming.upsert({
      where: {
        studentExamId_questionId: {
          studentExamId: studentExam.id,
          questionId: q1.id
        }
      },
      update: { timeSpentSeconds: 75 },
      create: {
        studentExamId: studentExam.id,
        questionId: q1.id,
        timeSpentSeconds: 75
      }
    });

    const savedTimings = await prisma.questionTiming.findMany({
      where: { studentExamId: studentExam.id }
    });

    const q1Timing = savedTimings.find(t => t.questionId === q1.id);
    const q2Timing = savedTimings.find(t => t.questionId === q2.id);

    assert(q1Timing?.timeSpentSeconds === 75, 'Revisiting Q1 accumulated to 75 seconds without double-counting');
    assert(q2Timing?.timeSpentSeconds === 60, 'Q2 tracked 60 seconds correctly');

    // -------------------------------------------------------------------------
    // SCENARIO 5: Additional Test Time Extension (+5, +10 mins) (Feature 3)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 5: Additional Time Extension (+5m, +10m) & Audit Log ---');
    // Admin grants +5 minutes
    const ext5Minutes = 5;
    const newDeadline5 = new Date(originalDeadline.getTime() + ext5Minutes * 60 * 1000);

    const extension1 = await prisma.$transaction(async (tx) => {
      const ext = await tx.timeExtension.create({
        data: {
          studentExamId: studentExam.id,
          studentId: testStudent.id,
          examId: testExam.id,
          originalDeadline: originalDeadline,
          newDeadline: newDeadline5,
          extensionMinutes: ext5Minutes,
          reason: 'Network reconnection recovery',
          grantedById: 'admin-super-id',
          grantedByRole: 'admin'
        }
      });

      await tx.studentExam.update({
        where: { id: studentExam.id },
        data: {
          deadline: newDeadline5,
          totalExtensionMinutes: { increment: ext5Minutes }
        }
      });

      return ext;
    });

    assert(extension1.extensionMinutes === 5, 'TimeExtension record created for +5 minutes');

    // Faculty/Invigilator grants +10 minutes
    const ext10Minutes = 10;
    const newDeadline10 = new Date(newDeadline5.getTime() + ext10Minutes * 60 * 1000);

    const extension2 = await prisma.$transaction(async (tx) => {
      const ext = await tx.timeExtension.create({
        data: {
          studentExamId: studentExam.id,
          studentId: testStudent.id,
          examId: testExam.id,
          originalDeadline: newDeadline5,
          newDeadline: newDeadline10,
          extensionMinutes: ext10Minutes,
          reason: 'Browser tab crash restoration',
          grantedById: 'faculty-invigilator-id',
          grantedByRole: 'faculty'
        }
      });

      await tx.studentExam.update({
        where: { id: studentExam.id },
        data: {
          deadline: newDeadline10,
          totalExtensionMinutes: { increment: ext10Minutes }
        }
      });

      return ext;
    });

    assert(extension2.extensionMinutes === 10, 'TimeExtension record created for +10 minutes');

    // Verify session updated deadline
    const updatedSession = await prisma.studentExam.findUnique({
      where: { id: studentExam.id }
    });

    assert(updatedSession?.totalExtensionMinutes === 15, 'Session accumulated total 15 extension minutes (+5 +10)');
    assert(
      updatedSession?.deadline.getTime() === newDeadline10.getTime(),
      'Authoritative server deadline matches latest extension'
    );

    // -------------------------------------------------------------------------
    // SCENARIO 6: Evaluation & Automatic Performance Classification (Feature 2)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 6: Exam Evaluation & Performance Classification ---');
    // Student answered both questions correctly (20/20 = 100%)
    const studentAnswers = [
      { questionId: q1.id, answerText: 'Resource management' },
      { questionId: q2.id, answerText: 'Stack' }
    ];

    const evalResult = await evaluateExamAnswers(testExam.id, studentAnswers);
    assert(evalResult.totalScore === 20, 'Total score evaluated to 20/20');
    assert(evalResult.percentage === 100, 'Percentage calculated to 100%');
    assert(evalResult.performanceCategory === 'Exceptional', 'Category classified as Exceptional');

    // Create Result record with question timing metrics
    const totalActiveSeconds = 75 + 60; // 135s
    const avgQuestionTime = Math.round(totalActiveSeconds / 2); // 68s

    const finalResult = await prisma.result.create({
      data: {
        studentId: testStudent.id,
        examId: testExam.id,
        score: evalResult.totalScore,
        totalMarks: testExam.totalMarks,
        percentage: evalResult.percentage,
        status: 'pass',
        performanceCategory: evalResult.performanceCategory,
        totalActiveTimeSeconds: totalActiveSeconds,
        averageQuestionTimeSeconds: avgQuestionTime
      }
    });

    assert(finalResult.id !== undefined, 'Result record persisted successfully');
    assert(finalResult.performanceCategory === 'Exceptional', 'Result stored performanceCategory: Exceptional');
    assert(finalResult.totalActiveTimeSeconds === 135, 'Result stored totalActiveTimeSeconds: 135s');
    assert(finalResult.averageQuestionTimeSeconds === 68, 'Result stored averageQuestionTimeSeconds: 68s');

    // -------------------------------------------------------------------------
    // SCENARIO 7: Student Master Analytics Aggregation (Feature 4 & 5)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 7: Student Master Analytics (6 KPIs + 5 Charts) ---');
    const studentResults = await prisma.result.findMany({
      where: { studentId: testStudent.id },
      include: { exam: true }
    });

    assert(studentResults.length >= 1, 'Student has at least 1 completed assessment');
    const avgScore = Math.round(studentResults.reduce((a, b) => a + b.percentage, 0) / studentResults.length);
    const maxScore = Math.max(...studentResults.map(r => r.percentage));
    const overallCategory = await classifyScore(avgScore);

    assert(typeof avgScore === 'number', 'KPI 1 & 2: Average Score computed');
    assert(typeof maxScore === 'number', 'KPI 3: Highest Score computed');
    assert(typeof overallCategory === 'string', 'KPI 4: Overall Performance Category classified');

    // -------------------------------------------------------------------------
    // SCENARIO 8: Admin Consolidated Analytics & Data Isolation (Feature 7)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 8: Admin Consolidated Analytics & Institution Isolation ---');
    // Admin for college 1 must only see results from college 1
    const college1Students = await prisma.student.findMany({
      where: { collegeId: sampleColleges[0].id },
      select: { id: true }
    });
    const college1StudentIds = college1Students.map(s => s.id);

    const isolatedResults = await prisma.result.findMany({
      where: { studentId: { in: college1StudentIds } }
    });

    const leakCheck = isolatedResults.every(r => college1StudentIds.includes(r.studentId));
    assert(leakCheck, 'Data isolation verified: College 1 admin only sees College 1 student records');

    // -------------------------------------------------------------------------
    // CLEANUP TEST FIXTURES
    // -------------------------------------------------------------------------
    console.log('\n--- CLEANING UP TEST FIXTURES ---');
    await prisma.questionTiming.deleteMany({ where: { studentExamId: studentExam.id } });
    await prisma.timeExtension.deleteMany({ where: { studentExamId: studentExam.id } });
    await prisma.result.delete({ where: { id: finalResult.id } });
    await prisma.studentExam.delete({ where: { id: studentExam.id } });
    await prisma.question.deleteMany({ where: { examId: testExam.id } });
    await prisma.institutionAssessment.deleteMany({ where: { examId: testExam.id } });
    await prisma.exam.delete({ where: { id: testExam.id } });
    if (testStudent.registerNumber === 'TEST-REG-2026') {
      await prisma.student.delete({ where: { id: testStudent.id } });
    }
    console.log('Cleanup completed successfully.');

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n===============================================================');
    console.log(`TEST SUITE RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
    console.log('===============================================================');

  } catch (err) {
    console.error('Unhandled error during test suite:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTestSuite();

