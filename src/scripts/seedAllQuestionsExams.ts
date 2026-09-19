import prisma from '../config/db';

export async function seedExamsForAllQuestions() {
  try {
    console.log('🔄 Checking exams for all 2,800+ questions...');

    // 1. Get faculty to associate exams with
    let faculty = await prisma.faculty.findFirst({
      include: { user: true }
    });

    if (!faculty) {
      const user = await prisma.user.create({
        data: {
          name: 'Academic Coordinator',
          email: 'academic.coordinator@exam.com',
          password: '$2b$10$R/9qfO6G77x9p.gC.sO32eYQG925x3m1gT26Ue75uG92K5x3m1gT2',
          role: 'faculty',
          status: 'active'
        }
      });
      faculty = await prisma.faculty.create({
        data: {
          userId: user.id,
          designation: 'Chief Examiner',
          experience: 8
        },
        include: { user: true }
      });
    }

    // 2. Get canonical subject
    const subject = await prisma.subject.findFirst({
      where: { subjectName: 'Company Specific Aptitude Assessment' }
    }) || await prisma.subject.findFirst({
      where: { subjectName: 'Quantitative & Reasoning Aptitude' }
    });

    if (!subject) {
      console.warn('Canonical subject not found. Skipping exam creation.');
      return;
    }

    // 3. Check if Master Exam with all 2,886 questions already exists
    const masterExamTitle = 'Master Aptitude & Placement Examination (Full Pool)';
    const existingMaster = await prisma.exam.findFirst({
      where: { title: masterExamTitle }
    });

    const allQuestions = await prisma.question.findMany({
      where: { subjectId: subject.id },
      select: { id: true, paperName: true }
    });

    console.log(`Found ${allQuestions.length} total questions under subject "${subject.subjectName}".`);

    const now = new Date();
    const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // yesterday
    const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year from now

    if (!existingMaster && allQuestions.length > 0) {
      console.log(`Creating Master Exam containing all ${allQuestions.length} questions...`);
      const masterExam = await prisma.exam.create({
        data: {
          title: masterExamTitle,
          description: 'Comprehensive campus placement & aptitude assessment covering the entire question bank. Questions are deterministically randomized per student attempt.\n<!-- TARGET_DEPTS:all -->\n<!-- TARGET_YEARS:all -->',
          subjectId: subject.id,
          facultyId: faculty.id,
          collegeId: null, // open to all colleges
          departmentId: null, // open to all departments
          category: 'All',
          targetYears: 'all',
          duration: 60,
          totalMarks: 30,
          questionCount: 30, // 30 questions randomly drawn from the full 2,886 pool
          marksPerQuestion: 1,
          negativeMarking: false,
          negativeMarks: 0,
          startDate,
          endDate,
          status: 'active'
        }
      });

      // Link all questions in chunks of 500
      const chunkSize = 500;
      for (let i = 0; i < allQuestions.length; i += chunkSize) {
        const chunk = allQuestions.slice(i, i + chunkSize);
        await prisma.examQuestion.createMany({
          data: chunk.map(q => ({
            examId: masterExam.id,
            questionId: q.id
          })),
          skipDuplicates: true
        });
      }
      console.log(`✅ Master Exam created with all ${allQuestions.length} questions linked!`);
    }

    // 4. Group questions by paperName and create assessments for major papers
    const papersMap = new Map<string, string[]>();
    for (const q of allQuestions) {
      const pName = q.paperName || 'General Aptitude Practice';
      if (!papersMap.has(pName)) {
        papersMap.set(pName, []);
      }
      papersMap.get(pName)!.push(q.id);
    }

    console.log(`Creating / verifying exams for ${papersMap.size} distinct test papers...`);

    for (const [paperName, qIds] of papersMap.entries()) {
      if (qIds.length < 5) continue; // skip trivial pools

      const examTitle = `${paperName} - Official Assessment`;
      const existing = await prisma.exam.findFirst({
        where: { title: examTitle }
      });

      if (!existing) {
        const qCount = Math.min(20, qIds.length);
        const duration = Math.min(60, Math.max(15, qCount * 2));

        const createdExam = await prisma.exam.create({
          data: {
            title: examTitle,
            description: `Official practice and evaluation paper for ${paperName}. Randomly pulls ${qCount} questions from the pool of ${qIds.length}.\n<!-- TARGET_DEPTS:all -->\n<!-- TARGET_YEARS:all -->`,
            subjectId: subject.id,
            facultyId: faculty.id,
            collegeId: null,
            departmentId: null,
            category: 'All',
            paperName: paperName,
            targetYears: 'all',
            duration,
            totalMarks: qCount,
            questionCount: qCount,
            marksPerQuestion: 1,
            negativeMarking: false,
            negativeMarks: 0,
            startDate,
            endDate,
            status: 'active'
          }
        });

        await prisma.examQuestion.createMany({
          data: qIds.map(qId => ({
            examId: createdExam.id,
            questionId: qId
          })),
          skipDuplicates: true
        });
      }
    }

    const totalActiveExams = await prisma.exam.count({ where: { status: 'active' } });
    console.log(`🎉 Total active examinations in application now: ${totalActiveExams}`);
  } catch (err) {
    console.error('❌ Error seeding exams for all questions:', err);
  }
}
