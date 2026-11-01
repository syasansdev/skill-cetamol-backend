import prisma from '../src/config/db';
import { evaluateExamAnswers, getAssignedExamQuestions } from '../src/utils/examUtils';
import { StudentController } from '../src/controllers/studentController';
import { classifyScore, DEFAULT_THRESHOLDS } from '../src/utils/performanceClassification';

async function runResultsAccuracyVerification() {
  console.log('================================================================');
  console.log('SKILL CETAMOL — STUDENT RESULTS CALCULATION & ACCURACY TEST');
  console.log('================================================================\n');

  let passedChecks = 0;
  let totalChecks = 0;

  function assert(condition: boolean, desc: string) {
    totalChecks++;
    if (condition) {
      passedChecks++;
      console.log(`[PASS] ${totalChecks}. ${desc}`);
    } else {
      console.error(`[FAIL] ${totalChecks}. ${desc}`);
      throw new Error(`Assertion failed: ${desc}`);
    }
  }

  // 1. Find or create a student
  const student = await prisma.student.findFirst({
    include: { user: true }
  });
  assert(!!student && !!student.user, 'Student with associated user record located');

  // 2. Find or create an exam with at least 5 questions and options
  let exam = await prisma.exam.findFirst({
    where: {
      examQuestions: {
        some: {
          question: {
            options: { some: {} }
          }
        }
      }
    },
    include: {
      subject: true,
      examQuestions: {
        include: {
          question: {
            include: { options: true }
          }
        }
      }
    }
  });

  assert(!!exam && exam.examQuestions.length > 0, `Exam "${exam?.title}" located with ${exam?.examQuestions.length} questions`);

  // 3. Test deterministic question assignment
  const assigned = getAssignedExamQuestions(exam, student!.id);
  assert(assigned.length > 0, `getAssignedExamQuestions returned ${assigned.length} assigned questions`);

  // Verify that options are populated
  const q0 = assigned[0].question;
  assert(q0.options && q0.options.length > 0, `Question 1 has ${q0.options.length} options populated`);

  // 4. Test evaluateExamAnswers with a known set of answers
  // Let's answer Question 0 CORRECTLY, Question 1 INCORRECTLY, and skip Question 2
  const sortedOptsQ0 = [...q0.options].sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''));
  const correctIdxQ0 = sortedOptsQ0.findIndex((o: any) => o.isCorrect);
  assert(correctIdxQ0 >= 0, `Found correct option index for Q0: ${correctIdxQ0}`);

  const q1 = assigned[1]?.question;
  const sortedOptsQ1 = q1 ? [...q1.options].sort((a: any, b: any) => (a.id || '').localeCompare(b.id || '')) : [];
  const wrongIdxQ1 = sortedOptsQ1.findIndex((o: any) => !o.isCorrect);

  const mockAnswers: Record<string, string> = {
    [q0.id]: String(correctIdxQ0)
  };
  if (q1 && wrongIdxQ1 >= 0) {
    mockAnswers[q1.id] = String(wrongIdxQ1);
  }

  const evalResult = evaluateExamAnswers(exam, student!.id, mockAnswers);

  assert(evalResult.correctCount >= 1, `evalResult.correctCount = ${evalResult.correctCount} (>= 1)`);
  assert(evalResult.score > 0, `evalResult.score = ${evalResult.score} (> 0)`);
  assert(evalResult.totalPoints > 0, `evalResult.totalPoints = ${evalResult.totalPoints} (> 0)`);
  assert(evalResult.percentage > 0, `evalResult.percentage = ${evalResult.percentage}% (> 0%)`);
  assert(evalResult.detailedQuestions.length === assigned.length, `detailedQuestions count (${evalResult.detailedQuestions.length}) matches assigned count`);

  // 5. Verify that detailedQuestions includes points and timing properties
  const detail0 = evalResult.detailedQuestions[0];
  assert(typeof detail0.points === 'number' && detail0.points > 0, `detailedQuestions[0].points is defined (${detail0.points})`);
  assert(detail0.isCorrect === true, `detailedQuestions[0].isCorrect is true for correct answer`);
  assert(detail0.marksAwarded > 0, `detailedQuestions[0].marksAwarded is positive (${detail0.marksAwarded})`);

  // 6. Test getResults endpoint logic to ensure score is NEVER 0 when questions were answered correctly
  // Create or upsert a test result
  const testExamId = exam!.id;
  const studentExam = await prisma.studentExam.upsert({
    where: { studentId_examId: { studentId: student!.id, examId: testExamId } },
    update: { score: evalResult.score, status: 'submitted', submittedAt: new Date() },
    create: { studentId: student!.id, examId: testExamId, score: evalResult.score, status: 'submitted', submittedAt: new Date() }
  });

  // Persist answers so getResultDetails can inspect detailed question choices
  await prisma.studentAnswer.deleteMany({ where: { studentExamId: studentExam.id } });
  await prisma.studentAnswer.create({
    data: {
      studentExamId: studentExam.id,
      questionId: q0.id,
      selectedOption: String(correctIdxQ0),
      marksAwarded: 1
    }
  });

  const testResult = await prisma.result.upsert({
    where: { studentId_examId: { studentId: student!.id, examId: testExamId } },
    update: {
      percentage: evalResult.percentage,
      status: evalResult.status,
      performanceCategory: evalResult.performanceCategory,
      totalActiveTimeSeconds: 95,
      averageQuestionTimeSeconds: 47.5
    },
    create: {
      studentId: student!.id,
      examId: testExamId,
      percentage: evalResult.percentage,
      status: evalResult.status,
      performanceCategory: evalResult.performanceCategory,
      totalActiveTimeSeconds: 95,
      averageQuestionTimeSeconds: 47.5
    }
  });

  assert(testResult.percentage === evalResult.percentage, `Result percentage persisted accurately (${testResult.percentage}%)`);

  // 7. Test mock req / res for getResults
  let resultsOutput: any = null;
  const mockReqResults: any = {
    user: { id: student!.userId, email: student!.user.email, role: 'student', status: 'active' }
  };
  const mockResResults: any = {
    status: (code: number) => ({
      json: (data: any) => { resultsOutput = data; return mockResResults; }
    })
  };

  await StudentController.getResults(mockReqResults, mockResResults, ((e: any) => { if (e) throw e; }) as any);

  assert(Array.isArray(resultsOutput) && resultsOutput.length > 0, 'getResults returned array of results');
  const matchedItem = resultsOutput.find((r: any) => r.examId === testExamId);
  assert(!!matchedItem, 'getResults contains the submitted exam');
  assert(matchedItem.percentage > 0, `getResults item percentage is > 0 (${matchedItem.percentage}%), NOT 0%`);
  assert(matchedItem.score > 0, `getResults item score is > 0 (${matchedItem.score})`);
  assert(matchedItem.studentName === student!.user.name, `getResults returns candidate name "${matchedItem.studentName}" (NOT email)`);

  // 8. Test mock req / res for getResultDetails
  let detailsOutput: any = null;
  const mockReqDetails: any = {
    params: { id: testResult.id },
    user: { id: student!.userId, email: student!.user.email, role: 'student', status: 'active' }
  };
  const mockResDetails: any = {
    status: (code: number) => ({
      json: (data: any) => { detailsOutput = data; return mockResDetails; }
    })
  };

  await StudentController.getResultDetails(mockReqDetails, mockResDetails, ((e: any) => { if (e) throw e; }) as any);

  assert(!!detailsOutput, 'getResultDetails returned payload');
  assert(detailsOutput.percentage === evalResult.percentage, `getResultDetails percentage matches evalResult (${detailsOutput.percentage}%)`);
  assert(detailsOutput.score === evalResult.score, `getResultDetails score matches evalResult (${detailsOutput.score})`);
  assert(detailsOutput.studentName === student!.user.name, `getResultDetails returns candidate name "${detailsOutput.studentName}" (NOT email)`);
  assert(Array.isArray(detailsOutput.detailedQuestions) && detailsOutput.detailedQuestions.length > 0, 'detailedQuestions array populated');

  // Verify detailed question 0 in detailsOutput
  const firstDetail = detailsOutput.detailedQuestions[0];
  assert(firstDetail.isCorrect === true, 'First question evaluated as correct');
  assert(firstDetail.options && firstDetail.options.length > 0, 'Options list populated in detailed review');
  assert(typeof firstDetail.points === 'number' && firstDetail.points > 0, 'Question points populated in detailed review');

  console.log('\n================================================================');
  console.log(`RESULTS: ALL ${passedChecks} / ${totalChecks} ACCURACY CHECKS PASSED!`);
  console.log('================================================================\n');

  await prisma.$disconnect();
}

runResultsAccuracyVerification().catch(async (e) => {
  console.error('Test error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
