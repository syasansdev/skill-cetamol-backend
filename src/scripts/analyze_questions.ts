import prisma from '../config/db';

async function analyzeAllQuestions() {
  const questions = await prisma.question.findMany({
    select: {
      id: true,
      question: true,
      paperName: true,
      difficulty: true,
      marks: true,
      options: { select: { option: true, isCorrect: true } }
    }
  });

  console.log(`Total questions analyzed: ${questions.length}`);

  // Count by paperName
  const paperCounts = new Map<string, number>();
  for (const q of questions) {
    const p = q.paperName || 'No Paper';
    paperCounts.set(p, (paperCounts.get(p) || 0) + 1);
  }

  console.log('--- ALL PAPERS AND COUNTS ---');
  for (const [p, c] of Array.from(paperCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`${p}: ${c}`);
  }
}

analyzeAllQuestions().catch(console.error).finally(() => prisma.$disconnect());
