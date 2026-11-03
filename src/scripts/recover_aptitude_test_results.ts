import prisma from '../config/db';
import { evaluateExamAnswers } from '../utils/examUtils';

async function main() {
  const args = process.argv.slice(2);
  const fixNoNegative = args.includes('--fix-no-negative');
  const fixStandard = args.includes('--fix');
  const doFix = fixNoNegative || fixStandard;

  console.log('===============================================================');
  console.log('  🔍 APTITUDE LEVEL - 3 TEST: DATA RETRIEVAL & DIAGNOSIS TOOL');
  console.log('===============================================================\n');

  // 1. Locate the exam
  const exams = await prisma.exam.findMany({
    where: {
      title: { contains: 'Aptitude Level - 3', mode: 'insensitive' }
    },
    include: {
      subject: true,
      college: true,
      examQuestions: {
        include: {
          question: {
            include: { options: true }
          }
        }
      }
    }
  });

  if (exams.length === 0) {
    console.error('❌ No exam found with title matching "Aptitude Level - 3".');
    console.log('Available exams in database:');
    const allExams = await prisma.exam.findMany({ select: { id: true, title: true, status: true } });
    console.table(allExams);
    process.exit(1);
  }

  for (const exam of exams) {
    console.log(`📌 Found Exam: "${exam.title}" (ID: ${exam.id})`);
    console.log(`   - Subject: ${exam.subject?.subjectName || 'N/A'}`);
    console.log(`   - Total Marks: ${exam.totalMarks}`);
    console.log(`   - Question Count: ${exam.questionCount}`);
    console.log(`   - Marks Per Question: ${exam.marksPerQuestion}`);
    console.log(`   - Negative Marking: ${exam.negativeMarking} (Deduction: ${exam.negativeMarks})`);
    console.log(`   - Pass Percentage: ${(exam as any).passPercentage || 40}%\n`);

    // 2. Fetch all student attempts for this exam
    const studentExams = await prisma.studentExam.findMany({
      where: { examId: exam.id },
      include: {
        student: {
          include: {
            user: true,
            college: true,
            department: true
          }
        },
        studentAnswers: true
      },
      orderBy: { startedAt: 'asc' }
    });

    console.log(`📊 Found ${studentExams.length} student attempt records for this exam:\n`);

    if (studentExams.length === 0) {
      console.log('No student attempts found.');
      continue;
    }

    // Also get existing Results
    const existingResults = await prisma.result.findMany({
      where: { examId: exam.id }
    });
    const resultMap = new Map(existingResults.map(r => [r.studentId, r]));

    const summaryTable: any[] = [];
    const updatesToApply: Array<{
      studentExamId: string;
      studentId: string;
      studentName: string;
      newScore: number;
      newPercentage: number;
      newStatus: string;
      newCategory: string;
      newGrade: string;
      answerInserts: any[];
    }> = [];

    for (const se of studentExams) {
      const student = se.student;
      const studentName = student.user?.name || 'Unknown Student';
      const rollNo = student.registerNumber || 'N/A';
      const collegeName = student.college?.collegeName || 'N/A';
      const savedResult = resultMap.get(se.studentId);

      // Reconstruct answersMap from studentAnswers in DB
      const answersMap: Record<string, any> = {};
      for (const sa of se.studentAnswers) {
        if (sa.selectedOption !== null && sa.selectedOption !== '') {
          answersMap[sa.questionId] = sa.selectedOption.includes(',')
            ? sa.selectedOption.split(',')
            : sa.selectedOption;
        } else if (sa.answerText !== null && sa.answerText !== '') {
          answersMap[sa.questionId] = sa.answerText;
        }
      }

      // Evaluate with current exam rules
      const currentEval = evaluateExamAnswers(exam, student.id, answersMap, se.id);

      // Evaluate without negative marking
      const cleanExam = { ...exam, negativeMarking: false, negativeMarks: 0 };
      const rawEval = evaluateExamAnswers(cleanExam, student.id, answersMap, se.id);

      const targetEval = fixNoNegative ? rawEval : currentEval;

      summaryTable.push({
        'Roll No': rollNo,
        'Student Name': studentName,
        'Answers in DB': se.studentAnswers.length,
        'Correct': rawEval.correctCount,
        'Wrong': rawEval.wrongCount,
        'Skipped': rawEval.skippedCount,
        'Raw Score (No Neg)': rawEval.score,
        'Score (w/ Neg)': currentEval.score,
        'Stored DB Score': se.score,
        'Stored DB Pct': `${savedResult?.percentage ?? 0}%`,
        'Attempt Status': se.status
      });

      updatesToApply.push({
        studentExamId: se.id,
        studentId: student.id,
        studentName,
        newScore: targetEval.score,
        newPercentage: targetEval.percentage,
        newStatus: targetEval.status,
        newCategory: targetEval.performanceCategory,
        newGrade: targetEval.percentage >= 90 ? 'A+' : targetEval.percentage >= 80 ? 'A' : targetEval.percentage >= 60 ? 'B' : targetEval.percentage >= 40 ? 'C' : 'F',
        answerInserts: targetEval.answerInserts
      });
    }

    console.table(summaryTable);

    if (doFix) {
      console.log(`\n⚙️ Applying score recovery updates (${fixNoNegative ? 'WITHOUT negative marking' : 'WITH standard evaluation'})...`);

      if (fixNoNegative && exam.negativeMarking) {
        await prisma.exam.update({
          where: { id: exam.id },
          data: { negativeMarking: false, negativeMarks: 0 }
        });
        console.log(`✅ Exam "${exam.title}" negative marking disabled.`);
      }

      for (const u of updatesToApply) {
        // 1. Update StudentExam
        await prisma.studentExam.update({
          where: { id: u.studentExamId },
          data: {
            score: u.newScore,
            status: 'submitted',
            submittedAt: new Date()
          }
        });

        // 2. Update StudentAnswers marksAwarded
        for (const ai of u.answerInserts) {
          await prisma.studentAnswer.updateMany({
            where: {
              studentExamId: u.studentExamId,
              questionId: ai.questionId
            },
            data: {
              marksAwarded: ai.marksAwarded
            }
          });
        }

        // 3. Upsert Result
        await prisma.result.upsert({
          where: {
            studentId_examId: {
              studentId: u.studentId,
              examId: exam.id
            }
          },
          update: {
            percentage: u.newPercentage,
            status: u.newStatus,
            grade: u.newGrade,
            performanceCategory: u.newCategory
          },
          create: {
            studentId: u.studentId,
            examId: exam.id,
            percentage: u.newPercentage,
            status: u.newStatus,
            grade: u.newGrade,
            performanceCategory: u.newCategory
          }
        });

        console.log(`   ✔️ Restored ${u.studentName}: Score ${u.newScore}, Pct ${u.newPercentage}%, Status ${u.newStatus}`);
      }

      console.log('\n🎉 ALL STUDENT RESULTS RESTORED AND SAVED SUCCESSFULLY IN PRODUCTION DATABASE!');
    } else {
      console.log('\nℹ️ [Dry Run Mode]: No database records were modified.');
      console.log('To apply the retrieved scores to the database so they show in production dashboards, run:');
      console.log('   npx ts-node src/scripts/recover_aptitude_test_results.ts --fix-no-negative');
      console.log('   (or: npx ts-node src/scripts/recover_aptitude_test_results.ts --fix)');
    }
  }
}

main()
  .catch(err => {
    console.error('Fatal error in recovery script:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
