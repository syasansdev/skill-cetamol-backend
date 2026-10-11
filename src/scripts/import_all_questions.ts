import { importGoogleDriveQuestions } from '../utils/importQuestions';
import { seedQuantitativeAptitudeQuestions } from '../utils/seedQuestions';
import prisma from '../config/db';

async function main() {
  console.log('=== FORCE RE-IMPORTING AND VERIFYING ALL 2,800+ QUESTIONS ===');
  await importGoogleDriveQuestions();
  await seedQuantitativeAptitudeQuestions();

  const total = await prisma.question.count();
  console.log(`✅ Current total questions in DB: ${total}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
