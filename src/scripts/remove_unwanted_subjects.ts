import prisma from '../config/db';

async function removeUnwantedSubjects() {
  console.log('--- CLEANING UNWANTED DEPARTMENT/SUBJECT NAMES ---');

  // 1. Locate Aptitude subject
  let aptitude = await prisma.subject.findFirst({
    where: { subjectName: 'Aptitude' }
  });

  if (!aptitude) {
    // If not found by exact name, look for case insensitive or create
    aptitude = await prisma.subject.findFirst({
      where: { subjectName: { equals: 'aptitude', mode: 'insensitive' } }
    });
  }

  if (!aptitude) {
    console.error('Aptitude subject not found!');
    process.exit(1);
  }

  console.log(`Found Aptitude subject: ${aptitude.id} ("${aptitude.subjectName}")`);

  // 2. Re-assign any questions in other subjects to Aptitude
  const movedQuestions = await prisma.question.updateMany({
    where: {
      subjectId: { not: aptitude.id }
    },
    data: {
      subjectId: aptitude.id
    }
  });
  console.log(`Moved ${movedQuestions.count} questions to Aptitude.`);

  // 3. Re-assign any exams pointing to Quantitative Ability-Pattern 1 to Aptitude
  const updatedExams = await prisma.exam.updateMany({
    where: {
      subject: { subjectName: 'Quantitative Ability-Pattern 1' }
    },
    data: {
      subjectId: aptitude.id
    }
  });
  console.log(`Updated ${updatedExams.count} exams to Aptitude.`);

  // 4. Delete Quantitative Ability-Pattern 1 if empty
  await prisma.subject.deleteMany({
    where: {
      subjectName: 'Quantitative Ability-Pattern 1'
    }
  });
  console.log('Deleted Quantitative Ability-Pattern 1 subject.');

  // 5. Delete all "Core Fundamentals - *" department subjects
  const deletedCF = await prisma.subject.deleteMany({
    where: {
      subjectName: { startsWith: 'Core Fundamentals -' }
    }
  });
  console.log(`Deleted ${deletedCF.count} "Core Fundamentals - *" department subjects.`);

  // 6. Summary check
  const remainingSubjects = await prisma.subject.findMany();
  console.log(`Remaining subjects in database (${remainingSubjects.length}):`);
  remainingSubjects.forEach(s => console.log(` - [${s.id}] ${s.subjectName}`));

  const totalQuestions = await prisma.question.count();
  console.log(`Total questions in database: ${totalQuestions}`);
}

removeUnwantedSubjects()
  .then(async () => {
    await prisma.$disconnect();
    console.log('Cleanup complete.');
  })
  .catch(async (e) => {
    console.error('Error during cleanup:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
