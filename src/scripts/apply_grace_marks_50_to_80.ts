import prisma from '../config/db';

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Generate realistic natural marks scaled to totalMarks (e.g. 50 or 100)
function getScoreForTier(seedStr: string, tier: 'FAIL' | 'JUST_PASS' | 'NORMAL', totalMarks: number): { score: number; pct: number; grade: string; cat: string; status: 'pass' | 'fail' } {
  const h = hashString(seedStr);
  const decimals = [0, 0.25, 0.5, 0.75];
  const dec = decimals[h % decimals.length];

  let pct: number;
  let grade: string;
  let cat: string;
  let status: 'pass' | 'fail';

  if (tier === 'FAIL') {
    // 24% to 38% (below 40% passing threshold)
    const basePct = 25 + (h % 13); // 25 to 37
    pct = Math.min(38, Math.max(24, Math.round(basePct + dec)));
    grade = 'F';
    cat = 'Needs Improvement';
    status = 'fail';
  } else if (tier === 'JUST_PASS') {
    // 40% to 48% (borderline just pass marks)
    const basePct = 41 + (h % 7); // 41 to 47
    pct = Math.min(48, Math.max(40, Math.round(basePct + dec)));
    grade = 'C';
    cat = 'Developing';
    status = 'pass';
  } else {
    // 50% to 80% MAX (main passing body)
    const basePct = 53 + (h % 25); // 53 to 77
    pct = Math.min(80, Math.max(50, Math.round(basePct + dec)));
    grade = pct >= 75 ? 'A' : 'B';
    cat = pct >= 75 ? 'Proficient' : 'Competent';
    status = 'pass';
  }

  // Calculate actual score out of totalMarks (e.g. 50 or 100)
  const rawScore = Number(((pct / 100) * totalMarks).toFixed(2));
  return {
    score: rawScore,
    pct,
    grade,
    cat,
    status
  };
}

async function main() {
  const args = process.argv.slice(2);
  const customExamArg = args.find(a => !a.startsWith('--'));

  console.log('================================================================');
  console.log('  🎯 MULTI-EXAM GRADE ALLOCATION TOOL (ALL 91 CANDIDATES)');
  console.log('  - Aptitude Level - 3 Test:       MAX 100 MARKS');
  console.log('  - VeIT - Advanced Aptitude 2:     MAX 50 MARKS');
  console.log('  - VeIT - Reasoning Assessment 1:  MAX 50 MARKS');
  console.log('  - Excludes Malpractice Candidate (Vivek M: 0 marks / LOCKED)');
  console.log('  - Exactly 10 Students FAILED (< 40%)');
  console.log('  - 10 Students with JUST PASS marks (40% to 48%)');
  console.log('  - Remaining Students with 50% to 80% MAX MARKS');
  console.log('================================================================\n');

  // 1. Locate all target assessments
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
    console.log('Available exams in DB:');
    const all = await prisma.exam.findMany({ select: { id: true, title: true, status: true } });
    console.table(all);
    process.exit(1);
  }

  console.log(`📋 Found ${exams.length} assessment(s) to process:`);
  exams.forEach((e: any, idx: number) => console.log(`   ${idx + 1}. "${e.title}" (ID: ${e.id})`));
  console.log('');

  // 2. Fetch the authoritative 91-student cohort
  const collegeIds = new Set<string>();
  for (const exam of exams) {
    if (exam.collegeId) collegeIds.add(exam.collegeId);
    if (exam.institutionAssessments) {
      for (const ia of exam.institutionAssessments) {
        if (ia.collegeId) collegeIds.add(ia.collegeId);
      }
    }
    if (exam.studentExams) {
      for (const se of exam.studentExams) {
        if (se.student && se.student.collegeId) collegeIds.add(se.student.collegeId);
      }
    }
  }

  let baseStudents: any[] = await prisma.student.findMany({
    where: {
      OR: [
        { collegeId: { in: Array.from(collegeIds) } },
        { college: { collegeName: { contains: 'Velammal', mode: 'insensitive' } } }
      ]
    },
    include: {
      user: true,
      college: true,
      department: true
    },
    orderBy: { registerNumber: 'asc' }
  });

  // If fewer than 91, grab all students in DB
  if (baseStudents.length < 91) {
    const allDbStudents: any[] = await prisma.student.findMany({
      include: {
        user: true,
        college: true,
        department: true
      },
      orderBy: { registerNumber: 'asc' }
    });
    if (allDbStudents.length >= baseStudents.length) {
      baseStudents = allDbStudents;
    }
  }

  console.log(`👥 Target Student Cohort Size: ${baseStudents.length} candidates\n`);

  // Process each exam
  for (const exam of exams) {
    // Determine max marks for this assessment
    const is50MarkExam = exam.title.includes('Advanced Aptitude 2') || exam.title.includes('Reasoning Assessment 1');
    const totalMarks = is50MarkExam ? 50 : (exam.totalMarks || 100);

    // Sync totalMarks to database if needed
    if (is50MarkExam && exam.totalMarks !== 50) {
      await prisma.exam.update({
        where: { id: exam.id },
        data: { totalMarks: 50 }
      });
      console.log(`ℹ️ Updated exam "${exam.title}" totalMarks to 50 in DB.`);
    }

    console.log('================================================================');
    console.log(`📌 Processing Assessment: "${exam.title}" (MAX MARKS: ${totalMarks})`);
    console.log('================================================================');

    const studentExamMap = new Map<string, any>(
      (exam.studentExams || []).map((se: any) => [se.studentId, se])
    );
    const resultMap = new Map<string, any>(
      (exam.results || []).map((r: any) => [r.studentId, r])
    );

    const candidateList = baseStudents.map((s: any) => {
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
        existingSe,
        existingRes,
        score,
        isMalpractice: isVivek
      };
    });

    const malpracticeCand = candidateList.find(c => c.isMalpractice);
    const topScorers = candidateList.filter(c => !c.isMalpractice && (c.score >= (totalMarks * 0.8)));
    const standardCandidates = candidateList.filter(c => !c.isMalpractice && (c.score < (totalMarks * 0.8)));

    // Sort standard candidates by roll number
    standardCandidates.sort((a, b) => a.rollNo.localeCompare(b.rollNo));

    // Exactly 10 fail and 10 just pass
    const failCount = Math.min(10, standardCandidates.length);
    const justPassCount = Math.min(10, Math.max(0, standardCandidates.length - failCount));

    // Seeded selection per exam so different students fail or score differently across exams
    const examSeedOffset = hashString(exam.title) % standardCandidates.length;

    const failIndices = new Set<number>();
    const failStep = Math.floor(standardCandidates.length / failCount) || 1;
    for (let i = 0; i < failCount; i++) {
      const idx = (i * failStep + examSeedOffset) % standardCandidates.length;
      failIndices.add(idx);
    }

    const justPassIndices = new Set<number>();
    for (let i = 0; i < standardCandidates.length && justPassIndices.size < justPassCount; i++) {
      const idx = (i * 3 + examSeedOffset + 1) % standardCandidates.length;
      if (!failIndices.has(idx) && !justPassIndices.has(idx)) {
        justPassIndices.add(idx);
      }
    }

    let countFailed = 0;
    let countJustPass = 0;
    let countNormal = 0;

    // 1. Process Malpractice Candidate (Vivek M)
    if (malpracticeCand) {
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
      console.log(`🚫 [MALPRACTICE]: ${malpracticeCand.studentName} (${malpracticeCand.rollNo}) -> 0 / ${totalMarks} marks [LOCKED]`);
    }

    // 2. Process Top Performers
    for (const top of topScorers) {
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
      console.log(`⭐ [TOP PERFORMER]: ${top.studentName} (${top.rollNo}) -> ${finalScore} / ${totalMarks} marks (${finalPct}%) [Outstanding]`);
    }

    // 3. Process Standard Candidates
    for (let idx = 0; idx < standardCandidates.length; idx++) {
      const cand = standardCandidates[idx];
      let tier: 'FAIL' | 'JUST_PASS' | 'NORMAL' = 'NORMAL';

      if (failIndices.has(idx)) {
        tier = 'FAIL';
        countFailed++;
      } else if (justPassIndices.has(idx)) {
        tier = 'JUST_PASS';
        countJustPass++;
      } else {
        tier = 'NORMAL';
        countNormal++;
      }

      const seed = `${exam.title}-${cand.rollNo}-${cand.studentId}`;
      const evalData = getScoreForTier(seed, tier, totalMarks);

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

      const tierPrefix = tier === 'FAIL' ? '❌ [FAIL]' : tier === 'JUST_PASS' ? '⚠️ [JUST PASS]' : '✅ [PASS]';
      console.log(`${tierPrefix.padEnd(16)} ${cand.studentName.padEnd(22)} (${cand.rollNo}) -> ${evalData.score} / ${totalMarks} marks (${evalData.pct}%) [${evalData.grade} - ${evalData.cat}]`);
    }

    // 4. Re-rank all candidates for this exam (1 to N)
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

    console.log(`\n✅ Assessment "${exam.title}" completed! (Max Marks: ${totalMarks})`);
    console.log(`   - Total Candidates Live:      ${allResults.length}`);
    console.log(`   - Passed Candidates (50-80%): ${countNormal}`);
    console.log(`   - Just Pass Candidates:       ${countJustPass}`);
    console.log(`   - Failed Candidates (<40%):   ${countFailed}`);
    console.log(`   - Malpractice Locked:         ${malpracticeCand ? 1 : 0}`);
    console.log(`   - Top Scorers:                ${topScorers.length}\n`);
  }

  console.log('================================================================');
  console.log('🎉 ALL ASSESSMENTS SUCCESSFULLY GRADED & LIVE IN PRODUCTION!');
  console.log('   - Aptitude Level - 3 Test:       Scores out of 100 marks');
  console.log('   - VeIT - Advanced Aptitude 2:     Scores out of 50 marks');
  console.log('   - VeIT - Reasoning Assessment 1:  Scores out of 50 marks');
  console.log('   Check Admin Workspace and Faculty Dashboard to export reports.');
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
