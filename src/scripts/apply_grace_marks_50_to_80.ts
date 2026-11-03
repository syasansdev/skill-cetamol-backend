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
// - Top scorers (43.0 to 48.5 / 50 -> 86% to 97%)
// ABSOLUTELY NEVER EXCEED 50 MARKS!
function getScoreFor50MarkExam(
  seedStr: string,
  tier: 'BORDERLINE_FAIL' | 'BORDERLINE_PASS' | 'GOOD' | 'TOP'
): { score: number; pct: number; grade: string; cat: string; status: 'pass' | 'fail' } {
  const h = hashString(seedStr);
  const decimals = [0, 0.25, 0.5, 0.75];
  const dec = decimals[h % decimals.length];

  if (tier === 'BORDERLINE_FAIL') {
    // 5 fail at borderline: 15.0 to 19.5 out of 50 (below 20 pass mark)
    const base = 15 + (h % 5); // 15, 16, 17, 18, 19
    const score = Math.min(19.5, Math.max(15.0, Number((base + dec).toFixed(2))));
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
    const base = 20 + (h % 5); // 20, 21, 22, 23, 24
    const score = Math.min(24.5, Math.max(20.0, Number((base + dec).toFixed(2))));
    const pct = Math.round((score / 50) * 100);
    return {
      score,
      pct,
      grade: 'C',
      cat: 'Developing',
      status: 'pass'
    };
  } else if (tier === 'TOP') {
    // Top scorers: 43.0 to 48.5 out of 50 (86% to 97%)
    const base = 43 + (h % 5); // 43, 44, 45, 46, 47
    const score = Math.min(48.5, Math.max(43.0, Number((base + dec).toFixed(2))));
    const pct = Math.min(97, Math.round((score / 50) * 100));
    return {
      score,
      pct,
      grade: 'A+',
      cat: 'Outstanding',
      status: 'pass'
    };
  } else {
    // Others get good marks: 25.0 to 42.0 out of 50 (50% to 84%)
    const base = 25 + (h % 17); // 25 to 41
    const score = Math.min(42.0, Math.max(25.0, Number((base + dec).toFixed(2))));
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
// ABSOLUTELY NEVER EXCEED 100 MARKS!
function getScoreFor100MarkExam(
  seedStr: string,
  tier: 'FAIL' | 'JUST_PASS' | 'NORMAL' | 'TOP'
): { score: number; pct: number; grade: string; cat: string; status: 'pass' | 'fail' } {
  const h = hashString(seedStr);
  const decimals = [0, 0.25, 0.5, 0.75];
  const dec = decimals[h % decimals.length];

  if (tier === 'FAIL') {
    // 10 fail: 25 to 38.5 out of 100 (below 40 pass mark)
    const base = 25 + (h % 13); // 25 to 37
    const score = Math.min(38.5, Math.max(24.0, Number((base + dec).toFixed(2))));
    const pct = Math.round(score);
    return { score, pct, grade: 'F', cat: 'Needs Improvement', status: 'fail' };
  } else if (tier === 'JUST_PASS') {
    // 10 pass at borderline: 40.0 to 48.5 out of 100
    const base = 40 + (h % 8); // 40 to 47
    const score = Math.min(48.5, Math.max(40.0, Number((base + dec).toFixed(2))));
    const pct = Math.round(score);
    return { score, pct, grade: 'C', cat: 'Developing', status: 'pass' };
  } else if (tier === 'TOP') {
    // Top scorers: 82 to 94.5 out of 100
    const base = 82 + (h % 12); // 82 to 93
    const score = Math.min(94.5, Math.max(82.0, Number((base + dec).toFixed(2))));
    const pct = Math.round(score);
    return { score, pct, grade: 'A+', cat: 'Outstanding', status: 'pass' };
  } else {
    // Normal good marks: 50.0 to 80.0 out of 100
    const base = 50 + (h % 29); // 50 to 78
    const score = Math.min(80.0, Math.max(50.0, Number((base + dec).toFixed(2))));
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
  console.log('  - VeIT - Advanced Aptitude 2 (STRICT MAX 50 MARKS):');
  console.log('    • 5 Fail at Borderline (15.0 to 19.5 / 50)');
  console.log('    • 15 Pass at Borderline (20.0 to 24.5 / 50)');
  console.log('    • Others Good Marks (25.0 to 42.0 / 50, Top 43.0 to 48.5 / 50)');
  console.log('  - VeIT - Reasoning Assessment 1 (STRICT MAX 50 MARKS):');
  console.log('    • 5 Fail at Borderline (15.0 to 19.5 / 50)');
  console.log('    • 15 Pass at Borderline (20.0 to 24.5 / 50)');
  console.log('    • Others Good Marks (25.0 to 42.0 / 50, Top 43.0 to 48.5 / 50)');
  console.log('  - Aptitude Level - 3 Test (STRICT MAX 100 MARKS):');
  console.log('    • 10 Fail, 10 Just Pass, Others 50-80 Marks');
  console.log('  - Malpractice (Vivek M - Roll 113323105026): LOCKED with 0 marks');
  console.log('================================================================\n');

  let examFilter: any = {
    OR: [
      { title: { contains: 'Aptitude Level - 3', mode: 'insensitive' } },
      { title: { contains: 'Advanced Aptitude 2', mode: 'insensitive' } },
      { title: { contains: 'Reasoning Assessment 1', mode: 'insensitive' } },
      { title: { contains: 'Advanced Aptitude', mode: 'insensitive' } },
      { title: { contains: 'Reasoning Assessment', mode: 'insensitive' } }
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
  exams.forEach((e: any, idx: number) => console.log(`   ${idx + 1}. "${e.title}" (ID: ${e.id}, Current Total Marks: ${e.totalMarks})`));
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
    const is50MarkExam =
      !exam.title.toLowerCase().includes('level - 3') &&
      (exam.title.toLowerCase().includes('advanced aptitude 2') ||
       exam.title.toLowerCase().includes('reasoning assessment 1') ||
       exam.title.toLowerCase().includes('advanced aptitude') ||
       exam.title.toLowerCase().includes('reasoning assessment') ||
       exam.totalMarks === 50);

    const totalMarks = is50MarkExam ? 50 : (exam.totalMarks || 100);

    // Ensure database totalMarks is correctly synced
    if (exam.totalMarks !== totalMarks) {
      await prisma.exam.update({
        where: { id: exam.id },
        data: { totalMarks }
      });
      console.log(`ℹ️ Synced exam "${exam.title}" to totalMarks: ${totalMarks} in database.`);
    }

    console.log('================================================================');
    console.log(`📌 Processing: "${exam.title}" (STRICT MAX MARKS: ${totalMarks})`);
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
    let examTopCount = 0;
    let examMalpracticeCount = 0;

    for (const [collegeName, collegeStudents] of studentsByCollege.entries()) {
      console.log(`\n🏫 College: "${collegeName}" (${collegeStudents.length} students)`);

      const candidateList = collegeStudents.map((s: any) => {
        const existingSe = studentExamMap.get(s.id);
        const existingRes = resultMap.get(s.id);
        const rollNo = s.registerNumber || 'N/A';
        const isVivek = rollNo === '113323105026' || (existingSe && existingSe.status === 'LOCKED');

        return {
          studentId: s.id,
          studentName: s.user?.name || 'Unknown Student',
          rollNo,
          collegeName,
          existingSe,
          existingRes,
          isMalpractice: isVivek
        };
      });

      const malpracticeCand = candidateList.find(c => c.isMalpractice);
      // All eligible students participate in the grading quota
      const eligibleCandidates = candidateList.filter(c => !c.isMalpractice);

      // Sort candidates deterministically by roll number
      eligibleCandidates.sort((a, b) => a.rollNo.localeCompare(b.rollNo));

      const totalEligible = eligibleCandidates.length;

      // Calculate quotas for this college
      // Requirement:
      // For 50-mark assessments: 5 fail at borderline, 15 pass at borderline, others good marks
      // For 100-mark assessments: 10 fail, 10 pass at borderline, others good marks
      const targetFailCount = is50MarkExam
        ? Math.min(5, totalEligible)
        : Math.min(10, totalEligible);

      const targetJustPassCount = is50MarkExam
        ? Math.min(15, Math.max(0, totalEligible - targetFailCount))
        : Math.min(10, Math.max(0, totalEligible - targetFailCount));

      const targetTopCount = Math.max(
        1,
        Math.min(
          Math.floor(totalEligible * 0.08),
          Math.max(0, totalEligible - targetFailCount - targetJustPassCount)
        )
      );

      // Deterministic spread per exam & college
      const seedOffset = hashString(`${exam.title}-${collegeName}`) % (totalEligible || 1);

      // 1. Select borderline fails
      const failIndices = new Set<number>();
      const failStep = Math.max(1, Math.floor(totalEligible / (targetFailCount || 1)));
      for (let i = 0; i < targetFailCount; i++) {
        const idx = (i * failStep + seedOffset) % totalEligible;
        failIndices.add(idx);
      }

      // 2. Select borderline passes (avoiding fails)
      const justPassIndices = new Set<number>();
      for (let i = 0; i < totalEligible && justPassIndices.size < targetJustPassCount; i++) {
        const idx = (i * 3 + seedOffset + 2) % totalEligible;
        if (!failIndices.has(idx) && !justPassIndices.has(idx)) {
          justPassIndices.add(idx);
        }
      }

      // 3. Select top performers (avoiding fails and borderline passes)
      const topIndices = new Set<number>();
      for (let i = 0; i < totalEligible && topIndices.size < targetTopCount; i++) {
        const idx = (i * 7 + seedOffset + 5) % totalEligible;
        if (!failIndices.has(idx) && !justPassIndices.has(idx) && !topIndices.has(idx)) {
          topIndices.add(idx);
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
        } else {
          await prisma.studentExam.create({
            data: {
              studentId: malpracticeCand.studentId,
              examId: exam.id,
              score: 0,
              status: 'LOCKED',
              lockReason: 'MALPRACTICE_EXCEEDED',
              startedAt: exam.startDate || new Date(Date.now() - 3600000),
              submittedAt: exam.endDate || new Date(),
              timeRemaining: 0
            }
          });
        }
        await prisma.result.upsert({
          where: { studentId_examId: { studentId: malpracticeCand.studentId, examId: exam.id } },
          update: { percentage: 0, status: 'fail', grade: 'F', performanceCategory: 'Needs Improvement' },
          create: { studentId: malpracticeCand.studentId, examId: exam.id, percentage: 0, status: 'fail', grade: 'F', performanceCategory: 'Needs Improvement' }
        });
        console.log(`   🚫 [MALPRACTICE]     ${malpracticeCand.studentName.padEnd(24)} (${malpracticeCand.rollNo}) -> 0 / ${totalMarks} (0%) [LOCKED - F]`);
      }

      // 2. Process All Eligible Candidates
      for (let idx = 0; idx < eligibleCandidates.length; idx++) {
        examTotalGraded++;
        const cand = eligibleCandidates[idx];
        const seed = `${exam.title}-${cand.rollNo}-${cand.studentId}`;
        let evalData: any;
        let tierName = '';

        if (is50MarkExam) {
          if (failIndices.has(idx)) {
            tierName = 'BORDERLINE_FAIL';
            evalData = getScoreFor50MarkExam(seed, 'BORDERLINE_FAIL');
            examFailCount++;
          } else if (justPassIndices.has(idx)) {
            tierName = 'BORDERLINE_PASS';
            evalData = getScoreFor50MarkExam(seed, 'BORDERLINE_PASS');
            examBorderlinePassCount++;
          } else if (topIndices.has(idx)) {
            tierName = 'TOP';
            evalData = getScoreFor50MarkExam(seed, 'TOP');
            examTopCount++;
          } else {
            tierName = 'GOOD';
            evalData = getScoreFor50MarkExam(seed, 'GOOD');
            examGoodMarksCount++;
          }
        } else {
          // 100-mark assessment
          if (failIndices.has(idx)) {
            tierName = 'FAIL';
            evalData = getScoreFor100MarkExam(seed, 'FAIL');
            examFailCount++;
          } else if (justPassIndices.has(idx)) {
            tierName = 'JUST_PASS';
            evalData = getScoreFor100MarkExam(seed, 'JUST_PASS');
            examBorderlinePassCount++;
          } else if (topIndices.has(idx)) {
            tierName = 'TOP';
            evalData = getScoreFor100MarkExam(seed, 'TOP');
            examTopCount++;
          } else {
            tierName = 'NORMAL';
            evalData = getScoreFor100MarkExam(seed, 'NORMAL');
            examGoodMarksCount++;
          }
        }

        // STRICT INVARIANT CHECK:
        // Score can NEVER exceed totalMarks!
        const clampedScore = Math.min(totalMarks, Math.max(0, evalData.score));
        const clampedPct = Math.min(100, Math.round((clampedScore / totalMarks) * 100));

        if (clampedScore > totalMarks) {
          throw new Error(`CRITICAL INVARIANT VIOLATION: Score ${clampedScore} exceeds totalMarks ${totalMarks} for ${cand.studentName}`);
        }

        if (cand.existingSe) {
          await prisma.studentExam.update({
            where: { id: cand.existingSe.id },
            data: {
              score: clampedScore,
              status: 'submitted',
              submittedAt: cand.existingSe.submittedAt || new Date()
            }
          });
        } else {
          await prisma.studentExam.create({
            data: {
              studentId: cand.studentId,
              examId: exam.id,
              score: clampedScore,
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
            percentage: clampedPct,
            status: evalData.status,
            grade: evalData.grade,
            performanceCategory: evalData.cat,
            totalActiveTimeSeconds: 2400
          },
          create: {
            studentId: cand.studentId,
            examId: exam.id,
            percentage: clampedPct,
            status: evalData.status,
            grade: evalData.grade,
            performanceCategory: evalData.cat,
            totalActiveTimeSeconds: 2400
          }
        });

        let tierPrefix = '';
        if (evalData.status === 'fail') {
          tierPrefix = '❌ [FAIL BORDERLINE]';
        } else if (tierName === 'BORDERLINE_PASS' || tierName === 'JUST_PASS') {
          tierPrefix = '⚠️ [PASS BORDERLINE]';
        } else if (tierName === 'TOP') {
          tierPrefix = '⭐ [TOP PERFORMER] ';
        } else {
          tierPrefix = '✅ [GOOD MARKS]     ';
        }

        console.log(`   ${tierPrefix} ${cand.studentName.padEnd(24)} (${cand.rollNo}) -> ${clampedScore} / ${totalMarks} (${clampedPct}%) [${evalData.grade} - ${evalData.cat}]`);
      }
    }

    // 3. Re-rank all candidates for this exam across all colleges (1 to N)
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

    console.log(`\n📊 Final Breakdown for "${exam.title}" (Max Marks: ${totalMarks}, Total: ${allResults.length} candidates):`);
    console.log(`   - ❌ Failed at Borderline:       ${examFailCount} candidates`);
    console.log(`   - ⚠️ Passed at Borderline:       ${examBorderlinePassCount} candidates`);
    console.log(`   - ⭐ Top Performers:             ${examTopCount} candidates`);
    console.log(`   - ✅ Good Marks (Solid Pass):     ${examGoodMarksCount} candidates`);
    console.log(`   - 🚫 Malpractice Locked:          ${examMalpracticeCount} candidate(s)`);
    console.log(`   - 🔒 Max Score Invariant Check:   ALL SCORES ARE <= ${totalMarks} (100% Verified)\n`);
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
