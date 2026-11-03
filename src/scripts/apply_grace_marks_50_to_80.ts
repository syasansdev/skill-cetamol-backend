import prisma from '../config/db';

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Generate realistic scores for 50-mark assessments:
// - 5 fail at borderline (15.0 to 19.5 / 50 -> 30% to 39%)
// - 15 pass at borderline (20.0 to 24.5 / 50 -> 40% to 49%)
// - Others good marks (25.0 to 42.0 / 50 -> 50% to 84%)
// - Top scorers (45.0 to 48.5 / 50 -> 90% to 97%)
function getScoreFor50MarkExam(
  seedStr: string,
  tier: 'BORDERLINE_FAIL' | 'BORDERLINE_PASS' | 'GOOD' | 'TOP'
): { score: number; pct: number; grade: string; cat: string; status: 'pass' | 'fail' } {
  const h = hashString(seedStr);
  const decimals = [0, 0.25, 0.5, 0.75];
  const dec = decimals[h % decimals.length];

  if (tier === 'BORDERLINE_FAIL') {
    // 5 fail at borderline: 15.0 to 19.5 out of 50 (below 20 pass mark)
    const base = 15 + (h % 5); // 15 to 19
    const score = Math.min(19.5, Math.max(15, Number((base + dec).toFixed(2))));
    const pct = Math.round((score / 50) * 100);
    return {
      score,
      pct,
      grade: 'F',
      cat: 'Needs Improvement',
      status: 'fail'
    };
  } else if (tier === 'BORDERLINE_PASS') {
    // 15 pass at borderline: 20.0 to 24.5 out of 50 (just cleared 20 pass mark)
    const base = 20 + (h % 5); // 20 to 24
    const score = Math.min(24.5, Math.max(20, Number((base + dec).toFixed(2))));
    const pct = Math.round((score / 50) * 100);
    return {
      score,
      pct,
      grade: 'C',
      cat: 'Developing',
      status: 'pass'
    };
  } else if (tier === 'TOP') {
    // Top scorers: 45.0 to 48.5 out of 50 (90% to 97%)
    const base = 45 + (h % 4);
    const score = Math.min(48.5, Math.max(45, Number((base + dec).toFixed(2))));
    const pct = Math.round((score / 50) * 100);
    return {
      score,
      pct,
      grade: 'A+',
      cat: 'Outstanding',
      status: 'pass'
    };
  } else {
    // Others get good marks: 25.0 to 41.5 out of 50 (50% to 83%)
    const base = 26 + (h % 15); // 26 to 40
    const score = Math.min(41.75, Math.max(25, Number((base + dec).toFixed(2))));
    const pct = Math.round((score / 50) * 100);
    const grade = pct >= 75 ? 'A' : 'B';
    const cat = pct >= 75 ? 'Proficient' : 'Competent';
    return {
      score,
      pct,
      grade,
      cat,
      status: 'pass'
    };
  }
}

// Generate scores for 100-mark assessments (Aptitude Level - 3 Test)
function getScoreFor100MarkExam(
  seedStr: string,
  tier: 'FAIL' | 'JUST_PASS' | 'NORMAL'
): { score: number; pct: number; grade: string; cat: string; status: 'pass' | 'fail' } {
  const h = hashString(seedStr);
  const decimals = [0, 0.25, 0.5, 0.75];
  const dec = decimals[h % decimals.length];

  if (tier === 'FAIL') {
    const base = 25 + (h % 13); // 25 to 37
    const score = Math.min(38.75, Math.max(24, Number((base + dec).toFixed(2))));
    const pct = Math.round(score);
    return { score, pct, grade: 'F', cat: 'Needs Improvement', status: 'fail' };
  } else if (tier === 'JUST_PASS') {
    const base = 41 + (h % 7); // 41 to 47
    const score = Math.min(48.5, Math.max(40, Number((base + dec).toFixed(2))));
    const pct = Math.round(score);
    return { score, pct, grade: 'C', cat: 'Developing', status: 'pass' };
  } else {
    const base = 53 + (h % 25); // 53 to 77
    const score = Math.min(80, Math.max(50, Number((base + dec).toFixed(2))));
    const pct = Math.round(score);
    const grade = pct >= 75 ? 'A' : 'B';
    const cat = pct >= 75 ? 'Proficient' : 'Competent';
    return { score, pct, grade, cat, status: 'pass' };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const customExamArg = args.find(a => !a.startsWith('--'));

  console.log('================================================================');
  console.log('  🎯 MULTI-COLLEGE ASSESSMENT GRADE ALLOCATION TOOL');
  console.log('  - VeIT - Advanced Aptitude 2 (MAX 50 MARKS):');
  console.log('    • 5 Fail at Borderline (15.0 to 19.5 / 50)');
  console.log('    • 15 Pass at Borderline (20.0 to 24.5 / 50)');
  console.log('    • Others Good Marks (25.0 to 42.0 / 50)');
  console.log('  - VeIT - Reasoning Assessment 1 (MAX 50 MARKS):');
  console.log('    • 5 Fail at Borderline (15.0 to 19.5 / 50)');
  console.log('    • 15 Pass at Borderline (20.0 to 24.5 / 50)');
  console.log('    • Others Good Marks (25.0 to 42.0 / 50)');
  console.log('  - Aptitude Level - 3 Test (MAX 100 MARKS):');
  console.log('    • 10 Fail, 10 Just Pass, Others 50-80 Marks');
  console.log('  - Malpractice (Vivek M): LOCKED with 0 marks');
  console.log('================================================================\n');

  let examFilter: any = {
    OR: [
      { title: { contains: 'Aptitude Level - 3', mode: 'insensitive' } },
      { title: { contains: 'Advanced Aptitude 2', mode: 'insensitive' } },
      { title: { contains: 'Reasoning Assessment 1', mode: 'insensitive' } }
    ]
  };

  if (customExamArg) {
    examFilter = { title: { contains: customExamArg, mode: 'insensitive' } };
  }

  const rawExams = await prisma.exam.findMany({
    where: examFilter,
    include: {
      college: true,
      institutionAssessments: { include: { college: true } },
      studentExams: {
        include: {
          student: { include: { user: true, college: true, department: true } }
        }
      },
      results: {
        include: {
          student: { include: { user: true, college: true, department: true } }
        }
      }
    }
  });

  const exams: any[] = rawExams;

  if (exams.length === 0) {
    console.error('❌ No matching exams found in database.');
    process.exit(1);
  }

  console.log(`📋 Found ${exams.length} assessment(s) to process:`);
  exams.forEach((e: any, idx: number) => console.log(`   ${idx + 1}. "${e.title}" (ID: ${e.id})`));
  console.log('');

  // Fetch ALL registered students across ALL colleges in the platform
  const allPlatformStudents: any[] = await prisma.student.findMany({
    include: {
      user: true,
      college: true,
      department: true
    },
    orderBy: { registerNumber: 'asc' }
  });

  console.log(`👥 Total Registered Students in Platform: ${allPlatformStudents.length} candidates across all colleges.\n`);

  for (const exam of exams) {
    const is50MarkExam = exam.title.includes('Advanced Aptitude 2') || exam.title.includes('Reasoning Assessment 1');
    const totalMarks = is50MarkExam ? 50 : (exam.totalMarks || 100);

    // Ensure database totalMarks is synced
    if (is50MarkExam && exam.totalMarks !== 50) {
      await prisma.exam.update({
        where: { id: exam.id },
        data: { totalMarks: 50 }
      });
      console.log(`ℹ️ Synced exam "${exam.title}" totalMarks to 50 in database.`);
    }

    console.log('================================================================');
    console.log(`📌 Processing: "${exam.title}" (Max Marks: ${totalMarks})`);
    console.log('================================================================');

    const studentExamMap = new Map<string, any>(
      (exam.studentExams || []).map((se: any) => [se.studentId, se])
    );
    const resultMap = new Map<string, any>(
      (exam.results || []).map((r: any) => [r.studentId, r])
    );

    // Group students by college so ALL colleges get marks accordingly
    const studentsByCollege = new Map<string, any[]>();
    for (const student of allPlatformStudents) {
      const colName = student.college?.collegeName || 'General College';
      if (!studentsByCollege.has(colName)) {
        studentsByCollege.set(colName, []);
      }
      studentsByCollege.get(colName)!.push(student);
    }

    let examTotalGraded = 0;
    let examFailCount = 0;
    let examBorderlinePassCount = 0;
    let examGoodMarksCount = 0;
    let examMalpracticeCount = 0;

    for (const [collegeName, collegeStudents] of studentsByCollege.entries()) {
      console.log(`\n🏫 College: "${collegeName}" (${collegeStudents.length} students)`);

      const candidateList = collegeStudents.map((s: any) => {
        const existingSe = studentExamMap.get(s.id);
        const existingRes = resultMap.get(s.id);
        const rollNo = s.registerNumber || 'N/A';
        const isVivek = rollNo === '113323105026' || (existingSe && existingSe.status === 'LOCKED');
        const score = (existingSe && existingSe.score > 0)
          ? existingSe.score
          : (existingRes ? existingRes.percentage : 0);

        return {
          studentId: s.id,
          studentName: s.user?.name || 'Unknown Student',
          rollNo,
          collegeName,
          existingSe,
          existingRes,
          score,
          isMalpractice: isVivek
        };
      });

      const malpracticeCand = candidateList.find(c => c.isMalpractice);
      const topScorers = candidateList.filter(c => !c.isMalpractice && (c.score >= (totalMarks * 0.85)));
      const standardCandidates = candidateList.filter(c => !c.isMalpractice && (c.score < (totalMarks * 0.85)));

      // Sort standard candidates by roll number
      standardCandidates.sort((a, b) => a.rollNo.localeCompare(b.rollNo));

      // Calculate quotas for this college
      // Requirement: 5 fail at borderline, 15 pass at borderline, others good marks
      const targetFailCount = is50MarkExam
        ? Math.min(5, standardCandidates.length)
        : Math.min(10, standardCandidates.length);

      const targetJustPassCount = is50MarkExam
        ? Math.min(15, Math.max(0, standardCandidates.length - targetFailCount))
        : Math.min(10, Math.max(0, standardCandidates.length - targetFailCount));

      // Seeded selection per exam & college
      const seedOffset = hashString(`${exam.title}-${collegeName}`) % standardCandidates.length;

      const failIndices = new Set<number>();
      const failStep = Math.max(1, Math.floor(standardCandidates.length / targetFailCount));
      for (let i = 0; i < targetFailCount; i++) {
        const idx = (i * failStep + seedOffset) % standardCandidates.length;
        failIndices.add(idx);
      }

      const justPassIndices = new Set<number>();
      for (let i = 0; i < standardCandidates.length && justPassIndices.size < targetJustPassCount; i++) {
        const idx = (i * 2 + seedOffset + 1) % standardCandidates.length;
        if (!failIndices.has(idx) && !justPassIndices.has(idx)) {
          justPassIndices.add(idx);
        }
      }

      // 1. Process Malpractice Candidate
      if (malpracticeCand) {
        examMalpracticeCount++;
        examTotalGraded++;
        if (malpracticeCand.existingSe) {
          await prisma.studentExam.update({
            where: { id: malpracticeCand.existingSe.id },
            data: { score: 0, status: 'LOCKED', lockReason: 'MALPRACTICE_EXCEEDED' }
          });
        }
        await prisma.result.upsert({
          where: { studentId_examId: { studentId: malpracticeCand.studentId, examId: exam.id } },
          update: { percentage: 0, status: 'fail', grade: 'F', performanceCategory: 'Needs Improvement' },
          create: { studentId: malpracticeCand.studentId, examId: exam.id, percentage: 0, status: 'fail', grade: 'F', performanceCategory: 'Needs Improvement' }
        });
        console.log(`   🚫 [MALPRACTICE]: ${malpracticeCand.studentName} (${malpracticeCand.rollNo}) -> 0 / ${totalMarks} [LOCKED]`);
      }

      // 2. Process Top Performers
      for (const top of topScorers) {
        examTotalGraded++;
        const finalScore = Number(top.score.toFixed(2));
        const finalPct = Math.min(100, Math.round((finalScore / totalMarks) * 100));

        if (top.existingSe) {
          await prisma.studentExam.update({
            where: { id: top.existingSe.id },
            data: { score: finalScore, status: 'submitted' }
          });
        } else {
          await prisma.studentExam.create({
            data: {
              studentId: top.studentId,
              examId: exam.id,
              score: finalScore,
              status: 'submitted',
              submittedAt: new Date()
            }
          });
        }

        await prisma.result.upsert({
          where: { studentId_examId: { studentId: top.studentId, examId: exam.id } },
          update: { percentage: finalPct, status: 'pass', grade: 'A+', performanceCategory: 'Outstanding' },
          create: { studentId: top.studentId, examId: exam.id, percentage: finalPct, status: 'pass', grade: 'A+', performanceCategory: 'Outstanding' }
        });
        console.log(`   ⭐ [TOP PERFORMER]: ${top.studentName} (${top.rollNo}) -> ${finalScore} / ${totalMarks} (${finalPct}%) [Outstanding]`);
      }

      // 3. Process Standard Candidates
      for (let idx = 0; idx < standardCandidates.length; idx++) {
        examTotalGraded++;
        const cand = standardCandidates[idx];
        const seed = `${exam.title}-${cand.rollNo}-${cand.studentId}`;
        let evalData: any;

        if (is50MarkExam) {
          if (failIndices.has(idx)) {
            evalData = getScoreFor50MarkExam(seed, 'BORDERLINE_FAIL');
            examFailCount++;
          } else if (justPassIndices.has(idx)) {
            evalData = getScoreFor50MarkExam(seed, 'BORDERLINE_PASS');
            examBorderlinePassCount++;
          } else {
            evalData = getScoreFor50MarkExam(seed, 'GOOD');
            examGoodMarksCount++;
          }
        } else {
          // 100-mark assessment
          if (failIndices.has(idx)) {
            evalData = getScoreFor100MarkExam(seed, 'FAIL');
            examFailCount++;
          } else if (justPassIndices.has(idx)) {
            evalData = getScoreFor100MarkExam(seed, 'JUST_PASS');
            examBorderlinePassCount++;
          } else {
            evalData = getScoreFor100MarkExam(seed, 'NORMAL');
            examGoodMarksCount++;
          }
        }

        if (cand.existingSe) {
          await prisma.studentExam.update({
            where: { id: cand.existingSe.id },
            data: {
              score: evalData.score,
              status: 'submitted',
              submittedAt: cand.existingSe.submittedAt || new Date()
            }
          });
        } else {
          await prisma.studentExam.create({
            data: {
              studentId: cand.studentId,
              examId: exam.id,
              score: evalData.score,
              status: 'submitted',
              startedAt: exam.startDate || new Date(Date.now() - 3600000),
              submittedAt: exam.endDate || new Date(),
              timeRemaining: 0
            }
          });
        }

        await prisma.result.upsert({
          where: { studentId_examId: { studentId: cand.studentId, examId: exam.id } },
          update: {
            percentage: evalData.pct,
            status: evalData.status,
            grade: evalData.grade,
            performanceCategory: evalData.cat,
            totalActiveTimeSeconds: 2400
          },
          create: {
            studentId: cand.studentId,
            examId: exam.id,
            percentage: evalData.pct,
            status: evalData.status,
            grade: evalData.grade,
            performanceCategory: evalData.cat,
            totalActiveTimeSeconds: 2400
          }
        });

        const tierPrefix = evalData.status === 'fail'
          ? '❌ [FAIL BORDERLINE]'
          : evalData.pct < 50
            ? '⚠️ [PASS BORDERLINE]'
            : '✅ [GOOD MARKS]     ';

        console.log(`   ${tierPrefix} ${cand.studentName.padEnd(22)} (${cand.rollNo}) -> ${evalData.score} / ${totalMarks} (${evalData.pct}%) [${evalData.grade} - ${evalData.cat}]`);
      }
    }

    // 4. Re-rank all candidates for this exam across all colleges (1 to N)
    const allResults = await prisma.result.findMany({
      where: { examId: exam.id },
      orderBy: { percentage: 'desc' }
    });

    for (let rIdx = 0; rIdx < allResults.length; rIdx++) {
      await prisma.result.update({
        where: { id: allResults[rIdx].id },
        data: { rank: rIdx + 1 }
      });
    }

    console.log(`\n📊 Final Breakdown for "${exam.title}" (Total: ${allResults.length} candidates):`);
    console.log(`   - ❌ Failed at Borderline:       ${examFailCount} candidates`);
    console.log(`   - ⚠️ Passed at Borderline:       ${examBorderlinePassCount} candidates`);
    console.log(`   - ✅ Good Marks (Solid Pass):     ${examGoodMarksCount} candidates`);
    console.log(`   - 🚫 Malpractice Locked:          ${examMalpracticeCount} candidate(s)\n`);
  }

  console.log('================================================================');
  console.log('🎉 ALL ASSESSMENTS AND ALL COLLEGES ARE NOW 100% GRADED & LIVE!');
  console.log('================================================================');
}

main()
  .catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
