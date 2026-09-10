import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function cleanQuestionPrefix(text: string): string {
  if (!text) return '';
  return text.replace(/^(?:q(?:uestion)?\s*\d+[\s.:)\-–—]+|\d+\s*[\.\)]\s+)/i, '').trim();
}

async function main() {
  console.log('=== Step 1: Setting up unified Question Bank subject ===');

  let dept = await prisma.department.findFirst({
    where: { departmentName: 'Placement Training' }
  });
  if (!dept) {
    dept = await prisma.department.create({
      data: { departmentName: 'Placement Training' }
    });
  }

  const course = await prisma.course.upsert({
    where: { courseName: 'Aptitude & Practice' },
    update: {},
    create: {
      courseName: 'Aptitude & Practice',
      departmentId: dept.id
    }
  });

  let unifiedSubject = await prisma.subject.findFirst({
    where: {
      subjectName: 'Aptitude',
      courseId: course.id
    }
  });
  if (!unifiedSubject) {
    unifiedSubject = await prisma.subject.create({
      data: {
        subjectName: 'Aptitude',
        courseId: course.id,
        semester: 1
      }
    });
  }
  console.log('Unified Subject ID:', unifiedSubject.id, unifiedSubject.subjectName);


  console.log('\n=== Step 2: Finding dummy subjects to unify ===');
  // Find all subjects created under Aptitude & Practice, or matching the 74 test categories
  const allSubjects = await prisma.subject.findMany({
    where: {
      id: { not: unifiedSubject.id }
    },
    select: { id: true, subjectName: true, courseId: true, _count: { select: { questions: true } } }
  });

  const dummySubjects = allSubjects.filter(s => 
    s.courseId === course.id ||
    s.subjectName.startsWith('Practice Test') ||
    s.subjectName.startsWith('Practice test') ||
    s.subjectName.startsWith('AMCAT') ||
    s.subjectName.startsWith('BITS') ||
    s.subjectName.startsWith('Infosys Pattern') ||
    s.subjectName.startsWith('Tech Mahindra') ||
    s.subjectName.startsWith('Surprise Test') ||
    s.subjectName.startsWith('Diagnostic Test') ||
    s.subjectName.startsWith('Post Training Test') ||
    s.subjectName.startsWith('PESITM') ||
    s.subjectName.startsWith('SANMAR') ||
    s.subjectName.startsWith('Bioinformatic') ||
    s.subjectName.startsWith('Bio Medical') ||
    s.subjectName.startsWith('Bio Tech') ||
    s.subjectName.startsWith('Civil -') ||
    s.subjectName.startsWith('ECE & ETC') ||
    s.subjectName.startsWith('Quantitative Ability-Pattern')
  );

  console.log(`Found ${dummySubjects.length} dummy subjects holding questions.`);

  let totalReassigned = 0;
  for (const ds of dummySubjects) {
    if (ds._count.questions > 0) {
      const updateResult = await prisma.question.updateMany({
        where: { subjectId: ds.id },
        data: {
          subjectId: unifiedSubject.id,
          paperName: ds.subjectName
        }
      });
      totalReassigned += updateResult.count;
    }
  }
  console.log(`Successfully reassigned ${totalReassigned} questions to "${unifiedSubject.subjectName}".`);

  console.log('\n=== Step 3: Deleting empty dummy subjects ===');
  let deletedCount = 0;
  for (const ds of dummySubjects) {
    try {
      await prisma.subject.delete({
        where: { id: ds.id }
      });
      deletedCount++;
    } catch (err: any) {
      console.warn(`Could not delete subject ${ds.subjectName}:`, err.message);
    }
  }
  console.log(`Deleted ${deletedCount} dummy subjects.`);

  console.log('\n=== Step 4: Sanitizing question prefixes across entire DB ===');
  const allQuestions = await prisma.question.findMany({
    select: { id: true, question: true }
  });

  const regex = /^(?:q(?:uestion)?\s*\d+[\s.:)\-–—]+|\d+\s*[\.\)]\s+)/i;
  let cleanedCount = 0;

  for (const q of allQuestions) {
    if (regex.test(q.question.trim())) {
      const cleaned = cleanQuestionPrefix(q.question.trim());
      if (cleaned && cleaned !== q.question) {
        await prisma.question.update({
          where: { id: q.id },
          data: { question: cleaned }
        });
        cleanedCount++;
      }
    }
  }
  console.log(`Cleaned ${cleanedCount} questions that had hardcoded question bank prefixes.`);

  console.log('\n=== Step 5: Verification of Unified DB State ===');
  const totalQuestionsInDB = await prisma.question.count();
  const unifiedQCount = await prisma.question.count({
    where: { subjectId: unifiedSubject.id }
  });
  const remainingDummyCount = await prisma.subject.count({
    where: {
      OR: [
        { subjectName: { startsWith: 'Practice Test' } },
        { subjectName: { startsWith: 'AMCAT' } }
      ]
    }
  });

  console.log('Total Questions in DB:', totalQuestionsInDB);
  console.log(`Questions in Unified "${unifiedSubject.subjectName}":`, unifiedQCount);
  console.log('Remaining dummy Practice Test / AMCAT subjects:', remainingDummyCount);
}

main().catch(console.error).finally(() => prisma.$disconnect());
