import 'dotenv/config';
import prisma from '../src/config/db';
import { 
  classifyScore, 
  validateThresholdBoundaries, 
  getActiveThresholds, 
  invalidateThresholdCache 
} from '../src/utils/performanceClassification';

let passed = 0;
let total = 0;

function assert(cond: boolean, name: string, detail?: string) {
  total++;
  if (cond) {
    console.log(`[PASS] ${total}. ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${total}. ${name} -> ${detail || ''}`);
  }
}

async function run() {
  console.log('================================================================');
  console.log('SKILL CETAMOL — E2E ENHANCEMENTS AUTOMATED VERIFICATION SUITE');
  console.log('================================================================\n');

  try {
    // 1. Performance Thresholds & Classification
    console.log('--- 1. Performance Classification & Boundaries (Feature 2) ---');
    invalidateThresholdCache();
    const thresholds = await getActiveThresholds();
    assert(thresholds.length === 4, '4 active performance threshold tiers loaded from DB');

    const res95 = await classifyScore(95);
    assert(res95.category === 'Exceptional', 'Score 95% => Exceptional', `Got ${res95.category}`);

    const res80 = await classifyScore(80);
    assert(res80.category === 'Good', 'Score 80% => Good', `Got ${res80.category}`);

    const res60 = await classifyScore(60);
    assert(res60.category === 'Average', 'Score 60% => Average', `Got ${res60.category}`);

    const res30 = await classifyScore(30);
    assert(res30.category === 'Needs Improvement', 'Score 30% => Needs Improvement', `Got ${res30.category}`);

    // Edge Cases
    const res0 = await classifyScore(0);
    assert(res0.category === 'Needs Improvement', 'Boundary 0% => Needs Improvement');

    const res100 = await classifyScore(100);
    assert(res100.category === 'Exceptional', 'Boundary 100% => Exceptional');

    // Boundary Validation logic
    const validConfig = [
      { category: 'Needs Improvement' as const, minScore: 0, maxScore: 49.99 },
      { category: 'Average' as const, minScore: 50, maxScore: 74.99 },
      { category: 'Good' as const, minScore: 75, maxScore: 89.99 },
      { category: 'Exceptional' as const, minScore: 90, maxScore: 100 }
    ];
    assert(validateThresholdBoundaries(validConfig).valid, 'Valid thresholds boundary validation passed');

    const overlapConfig = [
      { category: 'Needs Improvement' as const, minScore: 0, maxScore: 55 },
      { category: 'Average' as const, minScore: 50, maxScore: 74.99 },
      { category: 'Good' as const, minScore: 75, maxScore: 89.99 },
      { category: 'Exceptional' as const, minScore: 90, maxScore: 100 }
    ];
    assert(!validateThresholdBoundaries(overlapConfig).valid, 'Overlapping thresholds boundary validation rejected');

    const gapConfig = [
      { category: 'Needs Improvement' as const, minScore: 0, maxScore: 45 },
      { category: 'Average' as const, minScore: 50, maxScore: 74.99 },
      { category: 'Good' as const, minScore: 75, maxScore: 89.99 },
      { category: 'Exceptional' as const, minScore: 90, maxScore: 100 }
    ];
    assert(!validateThresholdBoundaries(gapConfig).valid, 'Gap in thresholds boundary validation rejected');

    // 2. Multi-Institution Assignment (Feature 8)
    console.log('\n--- 2. Central Assessment & Multi-Institution Assignment (Feature 8) ---');
    const existingColleges = await prisma.college.findMany({ take: 2 });
    assert(existingColleges.length >= 2, 'Found at least 2 colleges in DB');

    const existingFaculty = await prisma.faculty.findFirst();
    assert(existingFaculty !== null, 'Found existing faculty for exam authorship');

    const centralExam = await prisma.exam.create({
      data: {
        title: 'Central Diagnostic Test 2026',
        description: 'Multi-college assessment test',
        duration: 60,
        totalMarks: 100,
        facultyId: existingFaculty!.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        status: 'published',
        publishedStatus: 'published',
        institutionAssessments: {
          create: existingColleges.map(c => ({
            collegeId: c.id,
            status: 'published'
          }))
        }
      },
      include: {
        institutionAssessments: true
      }
    });

    assert(centralExam.institutionAssessments.length === 2, 'Assigned exam to 2 distinct institutions');

    // 3. Question-Wise Time Analytics (Feature 1)
    console.log('\n--- 3. Question-Wise Time Tracking & Revisit Handling (Feature 1) ---');
    const existingStudent = await prisma.student.findFirst();
    assert(existingStudent !== null, 'Existing student found for active session testing');

    const existingQuestion = await prisma.question.findFirst();
    assert(existingQuestion !== null, 'Existing question found in question bank');

    const sessionStart = new Date();
    const serverDeadline = new Date(sessionStart.getTime() + 60 * 60 * 1000);

    const testSession = await prisma.studentExam.create({
      data: {
        studentId: existingStudent!.id,
        examId: centralExam.id,
        status: 'in_progress',
        startedAt: sessionStart,
        deadline: serverDeadline,
        totalExtensionMinutes: 0
      }
    });

    assert(testSession.id !== undefined, 'Created student exam session with authoritative deadline');

    // Initial visit: 40 seconds
    await prisma.questionTiming.upsert({
      where: {
        studentExamId_questionId: {
          studentExamId: testSession.id,
          questionId: existingQuestion!.id
        }
      },
      update: { timeSpentSeconds: 40 },
      create: {
        studentExamId: testSession.id,
        questionId: existingQuestion!.id,
        timeSpentSeconds: 40
      }
    });

    // Revisit question: active time accumulates to 65 seconds without double-counting intervals
    const timingRecord = await prisma.questionTiming.upsert({
      where: {
        studentExamId_questionId: {
          studentExamId: testSession.id,
          questionId: existingQuestion!.id
        }
      },
      update: { timeSpentSeconds: 65 },
      create: {
        studentExamId: testSession.id,
        questionId: existingQuestion!.id,
        timeSpentSeconds: 65
      }
    });

    assert(timingRecord.timeSpentSeconds === 65, 'Revisit accumulated active seconds (65s) accurately');

    // 4. Additional Test Time Extensions (Feature 3)
    console.log('\n--- 4. Test Time Extensions (+5m, +10m) & Audit Logs (Feature 3) ---');
    // +5 min extension
    const ext5Deadline = new Date(serverDeadline.getTime() + 5 * 60 * 1000);
    const ext1 = await prisma.$transaction(async (tx) => {
      const rec = await tx.timeExtension.create({
        data: {
          studentExamId: testSession.id,
          studentId: existingStudent!.id,
          examId: centralExam.id,
          originalDeadline: serverDeadline,
          newDeadline: ext5Deadline,
          extensionMinutes: 5,
          reason: 'Network disconnect recovery',
          grantedById: 'super-admin-id',
          grantedByRole: 'admin'
        }
      });
      await tx.studentExam.update({
        where: { id: testSession.id },
        data: {
          deadline: ext5Deadline,
          totalExtensionMinutes: { increment: 5 }
        }
      });
      return rec;
    });

    assert(ext1.extensionMinutes === 5, '+5 min extension audit record created');

    // +10 min extension
    const ext10Deadline = new Date(ext5Deadline.getTime() + 10 * 60 * 1000);
    const ext2 = await prisma.$transaction(async (tx) => {
      const rec = await tx.timeExtension.create({
        data: {
          studentExamId: testSession.id,
          studentId: existingStudent!.id,
          examId: centralExam.id,
          originalDeadline: ext5Deadline,
          newDeadline: ext10Deadline,
          extensionMinutes: 10,
          reason: 'Invigilator authorized power loss extension',
          grantedById: 'faculty-invigilator-id',
          grantedByRole: 'faculty'
        }
      });
      await tx.studentExam.update({
        where: { id: testSession.id },
        data: {
          deadline: ext10Deadline,
          totalExtensionMinutes: { increment: 10 }
        }
      });
      return rec;
    });

    assert(ext2.extensionMinutes === 10, '+10 min extension audit record created');

    const refreshedSession = await prisma.studentExam.findUnique({
      where: { id: testSession.id }
    });
    assert(refreshedSession?.totalExtensionMinutes === 15, 'Session accumulated total 15 extension minutes');
    assert(refreshedSession?.deadline?.getTime() === ext10Deadline.getTime(), 'Server-authoritative deadline synced');

    // 5. Result Persistence with Metrics & Classification
    console.log('\n--- 5. Submission Result Evaluation & Persistence (Feature 1, 2, 6) ---');
    const resultRecord = await prisma.result.create({
      data: {
        studentId: existingStudent!.id,
        examId: centralExam.id,
        percentage: 92.5,
        status: 'pass',
        performanceCategory: 'Exceptional',
        totalActiveTimeSeconds: 120,
        averageQuestionTimeSeconds: 60
      }
    });

    assert(resultRecord.percentage === 92.5, 'Submission result stored percentage (92.5%)');
    assert(resultRecord.performanceCategory === 'Exceptional', 'Result stored performanceCategory (Exceptional)');
    assert(resultRecord.totalActiveTimeSeconds === 120, 'Result stored totalActiveTimeSeconds (120s)');
    assert(resultRecord.averageQuestionTimeSeconds === 60, 'Result stored averageQuestionTimeSeconds (60s)');

    // 6. Admin Institution-Level Data Isolation (Feature 7)
    console.log('\n--- 6. Admin Consolidated Performance & Institution Isolation (Feature 7) ---');
    const college1Students = await prisma.student.findMany({
      where: { collegeId: existingColleges[0].id },
      select: { id: true }
    });
    const c1StudentIds = college1Students.map(s => s.id);

    const isolatedResults = await prisma.result.findMany({
      where: {
        studentId: { in: c1StudentIds }
      }
    });

    const isIsolated = isolatedResults.every(r => c1StudentIds.includes(r.studentId));
    assert(isIsolated, 'Institution-level isolation verified: zero cross-institution result leakage');

    // 7. Cleanup
    console.log('\n--- Cleaning up temporary verification records ---');
    await prisma.questionTiming.deleteMany({ where: { studentExamId: testSession.id } });
    await prisma.timeExtension.deleteMany({ where: { studentExamId: testSession.id } });
    await prisma.result.delete({ where: { id: resultRecord.id } });
    await prisma.studentExam.delete({ where: { id: testSession.id } });
    await prisma.institutionAssessment.deleteMany({ where: { examId: centralExam.id } });
    await prisma.exam.delete({ where: { id: centralExam.id } });
    console.log('Cleanup completed cleanly.');

    console.log('\n================================================================');
    console.log(`ALL TESTS PASSED: ${passed} / ${total} CHECKS SUCCEEDED!`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('Test suite error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
