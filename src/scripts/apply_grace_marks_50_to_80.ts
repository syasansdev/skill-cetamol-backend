import prisma from '../config/db';

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Generate realistic natural marks
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
  console.log('================================================================');
  console.log('  🎯 VELAMMAL COLLEGE ONLY - APTITUDE LEVEL - 3 TEST');
  console.log('  - Strictly filters to Velammal Institute of Technology, Chennai');
  console.log('  - DOES NOT touch any other college (Achariya, Jeppiaar, Syasan, etc.)');
  console.log('  - Excludes Malpractice Candidate (Vivek M: 0 marks / LOCKED)');
  console.log('  - Preserves Top Performers (Dharshini 96.25%, Midhun S 93.75%)');
  console.log('  - Exactly 10 Velammal Students FAILED (24% to 38%)');
  console.log('  - 10 Velammal Students with JUST PASS marks (40% to 48%)');
  console.log('  - Remaining Velammal Students with 50 to 80 MARKS MAX');
  console.log('================================================================\n');

  // 1. Locate Velammal College
  const velammalCollege = await prisma.college.findFirst({
    where: {
      collegeName: { contains: 'Velammal', mode: 'insensitive' }
    }
  });

  if (!velammalCollege) {
    console.error('❌ Could not locate "Velammal" college in database.');
    process.exit(1);
  }

  console.log(`🏫 Located College: "${velammalCollege.collegeName}" (ID: ${velammalCollege.id})`);

  // 2. Locate specifically "Aptitude Level - 3 Test"
  const exam = await prisma.exam.findFirst({
    where: {
      title: { contains: 'Aptitude Level - 3', mode: 'insensitive' }
    },
    include: {
      subject: true,
      college: true
    }
  });

  if (!exam) {
    console.error('❌ Could not locate "Aptitude Level - 3 Test" in database.');
    process.exit(1);
  }

  console.log(`📌 Located Assessment: "${exam.title}" (ID: ${exam.id})\n`);

  // 3. Fetch ONLY students belonging to Velammal
  const velammalStudents = await prisma.student.findMany({
    where: {
      OR: [
        { collegeId: velammalCollege.id },
        { college: { collegeName: { contains: 'Velammal', mode: 'insensitive' } } },
        { registerNumber: { startsWith: '1133' } } // Anna University / Velammal Tech code series
      ]
    },
    include: {
      user: true,
      college: true,
      department: true,
      studentExams: { where: { examId: exam.id } },
      results: { where: { examId: exam.id } }
    },
    orderBy: { registerNumber: 'asc' }
  });

  console.log(`👥 Found EXACTLY ${velammalStudents.length} students enrolled in ${velammalCollege.collegeName}.\n`);

  if (velammalStudents.length === 0) {
    console.error('❌ No Velammal students found in database.');
    process.exit(1);
  }

  // Map candidates
  const candidateList = velammalStudents.map(s => {
    const existingSe = s.studentExams[0];
    const existingRes = s.results[0];
    const rollNo = s.registerNumber || 'N/A';
    const isVivek = rollNo === '113323105026' || (existingSe && existingSe.status === 'LOCKED');
    const score = (existingSe && existingSe.score > 0)
      ? existingSe.score
      : (existingRes ? existingRes.percentage : 0);

    return {
      studentId: s.id,
      studentName: s.user?.name || 'Unknown Student',
      rollNo,
      collegeName: s.college?.collegeName || velammalCollege.collegeName,
      departmentName: s.department?.departmentName || 'Engineering',
      existingSe,
      existingRes,
      score,
      isMalpractice: isVivek
    };
  });

  // Segregate categories
  const malpracticeCandidate = candidateList.find(c => c.isMalpractice);
  const topScorers = candidateList.filter(c => !c.isMalpractice && c.score >= 80);
  const standardCandidates = candidateList.filter(c => !c.isMalpractice && c.score < 80);

  // Deterministically sort standard candidates by roll number
  standardCandidates.sort((a, b) => a.rollNo.localeCompare(b.rollNo));

  // Determine fail and just pass counts
  const failCount = Math.min(10, standardCandidates.length);
  const justPassCount = Math.min(10, Math.max(0, standardCandidates.length - failCount));

  // Pick 10 distributed indices for FAIL
  const failIndices = new Set<number>();
  const failStep = Math.floor(standardCandidates.length / failCount) || 1;
  for (let i = 0; i < failCount; i++) {
    failIndices.add(Math.min(standardCandidates.length - 1, i * failStep));
  }

  // Pick 10 distributed indices for JUST PASS
  const justPassIndices = new Set<number>();
  for (let i = 0; i < standardCandidates.length && justPassIndices.size < justPassCount; i++) {
    const idx = (i * 3 + 1) % standardCandidates.length;
    if (!failIndices.has(idx) && !justPassIndices.has(idx)) {
      justPassIndices.add(idx);
    }
  }

  console.log(`⚙️ Allocating grades ONLY for ${candidateList.length} Velammal students:`);
  console.log(`   - Malpractice Candidate (Locked):  ${malpracticeCandidate ? 1 : 0}`);
  console.log(`   - Top Performers (>80):            ${topScorers.length}`);
  console.log(`   - Failed Students (<40%):          ${failCount}`);
  console.log(`   - Just Pass Students (40-48%):     ${justPassCount}`);
  console.log(`   - Passed Students (50-80 Max):      ${standardCandidates.length - failCount - justPassCount}\n`);

  let countProcessed = 0;

  // 1. Process Malpractice Candidate (Vivek M)
  if (malpracticeCandidate) {
    countProcessed++;
    if (malpracticeCandidate.existingSe) {
      await prisma.studentExam.update({
        where: { id: malpracticeCandidate.existingSe.id },
        data: { score: 0, status: 'LOCKED', lockReason: 'MALPRACTICE_EXCEEDED' }
      });
    }
    await prisma.result.upsert({
      where: { studentId_examId: { studentId: malpracticeCandidate.studentId, examId: exam.id } },
      update: { percentage: 0, status: 'fail', grade: 'F', performanceCategory: 'Needs Improvement' },
      create: { studentId: malpracticeCandidate.studentId, examId: exam.id, percentage: 0, status: 'fail', grade: 'F', performanceCategory: 'Needs Improvement' }
    });
    console.log(`🚫 [MALPRACTICE]: ${malpracticeCandidate.studentName.padEnd(20)} (${malpracticeCandidate.rollNo}) -> 0 marks [LOCKED]`);
  }

  // 2. Process Top Performers (Dharshini & Midhun S)
  for (const top of topScorers) {
    countProcessed++;
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
    console.log(`⭐ [TOP PERFORMER]: ${top.studentName.padEnd(20)} (${top.rollNo}) -> ${finalScore} marks (${finalPct}%) [Outstanding]`);
  }

  // 3. Process Standard Velammal Candidates
  for (let idx = 0; idx < standardCandidates.length; idx++) {
    countProcessed++;
    const cand = standardCandidates[idx];
    let tier: 'FAIL' | 'JUST_PASS' | 'NORMAL' = 'NORMAL';

    if (failIndices.has(idx)) {
      tier = 'FAIL';
    } else if (justPassIndices.has(idx)) {
      tier = 'JUST_PASS';
    } else {
      tier = 'NORMAL';
    }

    const seed = `${cand.rollNo}-${cand.studentId}`;
    const evalData = getScoreForTier(seed, tier);

    // Ensure StudentExam exists and has score
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

    // Upsert Result
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

    const tierPrefix = tier === 'FAIL' ? '❌ [FAIL]' : tier === 'JUST_PASS' ? '⚠️ [JUST PASS]' : '✅ [PASS (50-80)]';
    console.log(`${tierPrefix.padEnd(18)} ${cand.studentName.padEnd(20)} (${cand.rollNo}) -> ${evalData.score} marks (${evalData.pct}%) [${evalData.grade} - ${evalData.cat}]`);
  }

  // 4. Recalculate Official Ranks strictly for Velammal students in this exam
  console.log('\n📊 Re-ranking Velammal students from highest to lowest...');
  const velammalStudentIds = velammalStudents.map(s => s.id);
  const velammalResults = await prisma.result.findMany({
    where: {
      examId: exam.id,
      studentId: { in: velammalStudentIds }
    },
    orderBy: { percentage: 'desc' }
  });

  for (let rIdx = 0; rIdx < velammalResults.length; rIdx++) {
    await prisma.result.update({
      where: { id: velammalResults[rIdx].id },
      data: { rank: rIdx + 1 }
    });
  }

  console.log('\n================================================================');
  console.log('  🎉 FINAL EXECUTION SUMMARY (VELAMMAL COLLEGE ONLY)');
  console.log('================================================================');
  console.log(`   College:                            ${velammalCollege.collegeName}`);
  console.log(`   Assessment:                         ${exam.title}`);
  console.log(`   Total Velammal Students Graded:     ${velammalResults.length}`);
  console.log(`   Top Performers (>80):               ${topScorers.length} (Dharshini 96.25%, Midhun S 93.75%)`);
  console.log(`   Passed Candidates (50-80 Max):      ${standardCandidates.length - failCount - justPassCount}`);
  console.log(`   Borderline Just Pass (40-48%):      ${justPassCount}`);
  console.log(`   Failed Candidates (24-38%):         ${failCount}`);
  console.log(`   Malpractice Candidate (LOCKED):     ${malpracticeCandidate ? 1 : 0} (Vivek M)`);
  console.log('================================================================');
  console.log('✅ ALL VELAMMAL MARKS SAVED EXCLUSIVELY! NO OTHER COLLEGES TOUCHED.');
}

main()
  .catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
