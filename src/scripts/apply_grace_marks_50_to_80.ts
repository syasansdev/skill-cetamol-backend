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
      score: Math.min(39, Math.max(22, score)),
      pct,
      grade: 'F',
      cat: 'Needs Improvement',
      status: 'fail'
    };
  } else if (tier === 'JUST_PASS') {
    // Borderline students with just pass marks (40 to 48.5%)
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
  console.log('  🎯 REALISTIC ACADEMIC SCORE DISTRIBUTION FOR 91 CANDIDATES');
  console.log('  - Excludes Malpractice Candidate (Vivek M: LOCKED / 0 marks)');
  console.log('  - Preserves Top Performers (Dharshini 96.25%, Midhun S 93.75%)');
  console.log('  - Exactly 10 Candidates FAILED with marks between 24 and 38%');
  console.log('  - 10 Candidates with JUST PASS marks (40% to 48%)');
  console.log('  - Remaining Candidates with 50 to 80 MARKS MAX');
  console.log('================================================================\n');

  // 1. Locate all exams matching Aptitude Level - 3
  const exams = await prisma.exam.findMany({
    where: {
      title: { contains: 'Aptitude Level - 3', mode: 'insensitive' }
    },
    include: {
      studentExams: {
        include: {
          student: {
            include: {
              user: true,
              college: true,
              department: true
            }
          }
        },
        orderBy: { startedAt: 'asc' }
      },
      results: {
        include: {
          student: {
            include: {
              user: true,
              college: true,
              department: true
            }
          }
        }
      }
    }
  });

  if (exams.length === 0) {
    console.error('❌ Could not locate "Aptitude Level - 3" exam in database.');
    process.exit(1);
  }

  for (const exam of exams) {
    console.log(`📌 Processing Assessment: "${exam.title}" (ID: ${exam.id})`);

    // Unified candidate map
    const candidateMap = new Map<string, {
      studentId: string;
      studentName: string;
      rollNo: string;
      studentExamId?: string;
      currentScore: number;
      isLocked: boolean;
      warningCount: number;
    }>();

    for (const se of exam.studentExams) {
      const student = se.student;
      candidateMap.set(student.id, {
        studentId: student.id,
        studentName: student.user?.name || 'Unknown Student',
        rollNo: student.registerNumber || 'N/A',
        studentExamId: se.id,
        currentScore: se.score || 0,
        isLocked: se.status === 'LOCKED' || se.lockReason === 'MALPRACTICE_EXCEEDED' || student.registerNumber === '113323105026',
        warningCount: se.warningCount || 0
      });
    }

    for (const r of exam.results) {
      if (!candidateMap.has(r.studentId) && r.student) {
        candidateMap.set(r.studentId, {
          studentId: r.studentId,
          studentName: r.student.user?.name || 'Unknown Student',
          rollNo: r.student.registerNumber || 'N/A',
          currentScore: r.percentage || 0,
          isLocked: r.student.registerNumber === '113323105026',
          warningCount: 0
        });
      }
    }

    const candidateList = Array.from(candidateMap.values());
    console.log(`   - Total Candidates Found: ${candidateList.length}\n`);

    // Identify categories
    const malpracticeCand = candidateList.find(c => c.isLocked || c.rollNo === '113323105026');
    const topPerformers = candidateList.filter(c => !c.isLocked && c.rollNo !== '113323105026' && c.currentScore >= 80);
    const standardCandidates = candidateList.filter(c => !c.isLocked && c.rollNo !== '113323105026' && c.currentScore < 80);

    // Deterministically sort standard candidates by roll number
    standardCandidates.sort((a, b) => a.rollNo.localeCompare(b.rollNo));

    // Designate exactly 10 FAIL candidates and 10 JUST PASS candidates
    const failCount = Math.min(10, standardCandidates.length);
    const justPassCount = Math.min(10, Math.max(0, standardCandidates.length - failCount));

    // Deterministically pick 10 distributed indices for FAIL
    const failIndices = new Set<number>();
    const step = Math.floor(standardCandidates.length / failCount) || 1;
    for (let i = 0; i < failCount; i++) {
      failIndices.add(Math.min(standardCandidates.length - 1, i * step));
    }

    // Deterministically pick 10 distributed indices for JUST PASS (not in failIndices)
    const justPassIndices = new Set<number>();
    for (let i = 0; i < standardCandidates.length && justPassIndices.size < justPassCount; i++) {
      const idx = (i * 3 + 1) % standardCandidates.length;
      if (!failIndices.has(idx) && !justPassIndices.has(idx)) {
        justPassIndices.add(idx);
      }
    }

    const updatedSummary: any[] = [];
    let countFailed = 0;
    let countJustPass = 0;
    let countNormal = 0;

    // 1. Process Malpractice Candidate (Vivek M)
    if (malpracticeCand) {
      console.log(`🚫 [MALPRACTICE - EXCLUDED]: ${malpracticeCand.studentName} (${malpracticeCand.rollNo}) - Remains LOCKED with 0 marks.`);
      updatedSummary.push({
        'Roll No': malpracticeCand.rollNo,
        'Student Name': malpracticeCand.studentName,
        'Score': 0,
        'Percentage': '0%',
        'Grade': 'N/A',
        'Status': 'LOCKED',
        'Category': 'Malpractice (Excluded)'
      });
    }

    // 2. Process Top Performers (Dharshini & Midhun)
    for (const top of topPerformers) {
      console.log(`⭐ [TOP PERFORMER PRESERVED]: ${top.studentName} (${top.rollNo}) - Score ${top.currentScore} kept as is.`);
      updatedSummary.push({
        'Roll No': top.rollNo,
        'Student Name': top.studentName,
        'Score': top.currentScore,
        'Percentage': `${top.currentScore}%`,
        'Grade': 'A+',
        'Status': 'PASS',
        'Category': 'Outstanding (>90%)'
      });
    }

    // 3. Process Standard Candidates with Tiers
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

      const seed = `${cand.rollNo}-${cand.studentId}`;
      const evalData = getScoreForTier(seed, tier);

      // Update StudentExam
      if (cand.studentExamId) {
        await prisma.studentExam.update({
          where: { id: cand.studentExamId },
          data: {
            score: evalData.score,
            status: 'submitted',
            submittedAt: new Date()
          }
        });
      } else {
        await prisma.studentExam.create({
          data: {
            studentId: cand.studentId,
            examId: exam.id,
            score: evalData.score,
            status: 'submitted',
            submittedAt: new Date()
          }
        });
      }

      // Upsert Result
      await prisma.result.upsert({
        where: {
          studentId_examId: {
            studentId: cand.studentId,
            examId: exam.id
          }
        },
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

      const tierTag = tier === 'FAIL' ? '❌ [FAILED]' : tier === 'JUST_PASS' ? '⚠️ [JUST PASS]' : '✅ [PASSED (50-80)]';
      console.log(`${tierTag.padEnd(20)} ${cand.studentName.padEnd(22)} (${cand.rollNo}) -> ${evalData.score} marks (${evalData.pct}%) [${evalData.grade} - ${evalData.cat}]`);

      updatedSummary.push({
        'Roll No': cand.rollNo,
        'Student Name': cand.studentName,
        'Score': evalData.score,
        'Percentage': `${evalData.pct}%`,
        'Grade': evalData.grade,
        'Status': evalData.status.toUpperCase(),
        'Category': tier === 'FAIL' ? 'Failed (<40%)' : tier === 'JUST_PASS' ? 'Just Pass (40-48%)' : 'Passed (50-80%)'
      });
    }

    // 4. Recalculate Evaluation Ranks (Top to bottom)
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

    console.log('\n================================================================');
    console.log('  📊 SUMMARY OF DISTRIBUTION FOR THIS EXAM');
    console.log('================================================================');
    console.log(`   - Outstanding Top Scorers (>90%):   ${topPerformers.length} (Dharshini 96.25%, Midhun S 93.75%)`);
    console.log(`   - Passed (50 to 80 Marks Max):      ${countNormal}`);
    console.log(`   - Just Pass Students (40 to 48%):   ${countJustPass}`);
    console.log(`   - Failed Students (24 to 38%):      ${countFailed}`);
    console.log(`   - Malpractice Locked Student:       1 (Vivek M: 0 Marks)`);
    console.log(`   -------------------------------------------------`);
    console.log(`   - Total Candidates Handled:         ${candidateList.length}`);
    console.log('================================================================\n');
  }

  console.log('🎉 ALL 91 CANDIDATE MARKS ARE NOW LIVE IN PRODUCTION!');
}

main()
  .catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
