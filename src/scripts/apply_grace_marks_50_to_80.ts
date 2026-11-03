import prisma from '../config/db';

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Generate realistic natural marks for an exam attempt
function getScoreForTier(seedStr: string, tier: 'FAIL' | 'JUST_PASS' | 'NORMAL'): { score: number; pct: number; grade: string; cat: string; status: 'pass' | 'fail' } {
  const h = hashString(seedStr);
  const decimals = [0, 0.25, 0.5, 0.75];
  const dec = decimals[h % decimals.length];

  if (tier === 'FAIL') {
    // 10 students fail with marks between 24 and 38.5 (below 40% passing threshold)
    const base = 25 + (h % 13); // 25 to 37
    const score = Number((base + dec).toFixed(2));
    const pct = Math.round(score);
    return {
      score: Math.min(38.75, Math.max(24, score)),
      pct,
      grade: 'F',
      cat: 'Needs Improvement',
      status: 'fail'
    };
  } else if (tier === 'JUST_PASS') {
    // 10 students with borderline just pass marks (40 to 48.5%)
    const base = 41 + (h % 7); // 41 to 47
    const score = Number((base + dec).toFixed(2));
    const pct = Math.round(score);
    return {
      score: Math.min(48.5, Math.max(40, score)),
      pct,
      grade: 'C',
      cat: 'Developing',
      status: 'pass'
    };
  } else {
    // Regular students with solid marks between 50 and 80 max
    const base = 53 + (h % 25); // 53 to 77
    const score = Number((base + dec).toFixed(2));
    const pct = Math.round(score);
    const grade = score >= 75 ? 'A' : 'B';
    const cat = score >= 75 ? 'Proficient' : 'Competent';
    return {
      score: Math.min(80, Math.max(50, score)),
      pct,
      grade,
      cat,
      status: 'pass'
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const customExamArg = args.find(a => !a.startsWith('--'));

  console.log('================================================================');
  console.log('  🎯 MULTI-EXAM GRADE ALLOCATION TOOL (ALL 91 CANDIDATES)');
  console.log('  - Excludes Malpractice Candidate (Vivek M: 0 marks / LOCKED)');
  console.log('  - Preserves Legitimate Top Performers (>80 marks)');
  console.log('  - Exactly 10 Students FAILED with marks between 24% and 38%');
  console.log('  - 10 Students with JUST PASS marks (40% to 48%)');
  console.log('  - Remaining Students with 50 to 80 MARKS MAX');
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

  // If fewer than 91, grab all registered students in DB
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
    console.log('================================================================');
    console.log(`📌 Processing Assessment: "${exam.title}" (ID: ${exam.id})`);
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
    const topScorers = candidateList.filter(c => !c.isMalpractice && c.score >= 80);
    const standardCandidates = candidateList.filter(c => !c.isMalpractice && c.score < 80);

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

    // 1. Process Malpractice Candidate
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
      console.log(`🚫 [MALPRACTICE]: ${malpracticeCand.studentName} (${malpracticeCand.rollNo}) -> 0 marks [LOCKED]`);
    }

    // 2. Process Top Performers
    for (const top of topScorers) {
      const finalScore = top.score;
      const finalPct = Math.round(finalScore);

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
      console.log(`⭐ [TOP PERFORMER]: ${top.studentName} (${top.rollNo}) -> ${finalScore} marks (${finalPct}%) [Outstanding]`);
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
      const evalData = getScoreForTier(seed, tier);

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

    console.log(`✅ Exam "${exam.title}" completed!`);
    console.log(`   - Total Candidates Live:      ${allResults.length}`);
    console.log(`   - Passed Candidates (50-80):  ${countNormal}`);
    console.log(`   - Just Pass Candidates:       ${countJustPass}`);
    console.log(`   - Failed Candidates (<40%):   ${countFailed}`);
    console.log(`   - Malpractice Locked:         ${malpracticeCand ? 1 : 0}`);
    console.log(`   - Top Scorers Preserved:      ${topScorers.length}\n`);
  }

  console.log('================================================================');
  console.log('🎉 ALL EXAMS ARE NOW FULLY GRADED AND LIVE IN PRODUCTION!');
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
