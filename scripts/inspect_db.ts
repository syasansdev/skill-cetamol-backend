import dotenv from 'dotenv';
dotenv.config();
import prisma from '../src/config/db';

async function main() {
  console.log('--- Inspecting PostgreSQL Database ---');
  
  const tables: any = await prisma.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('Tables in public schema:', tables.map((t: any) => t.table_name));

  const examCols: any = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'Exam' ORDER BY ordinal_position"
  );
  console.log('\nExam table columns:');
  console.table(examCols);

  const studentExamCols: any = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'StudentExam' ORDER BY ordinal_position"
  );
  console.log('\nStudentExam table columns:');
  console.table(studentExamCols);

  const resultCols: any = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'Result' ORDER BY ordinal_position"
  );
  console.log('\nResult table columns:');
  console.table(resultCols);

  const ptCols: any = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'PerformanceThreshold' ORDER BY ordinal_position"
  );
  console.log('\nPerformanceThreshold table columns:');
  console.table(ptCols);

  const teCols: any = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'TimeExtension' ORDER BY ordinal_position"
  );
  console.log('\nTimeExtension table columns:');
  console.table(teCols);

  const iaCols: any = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'InstitutionAssessment' ORDER BY ordinal_position"
  );
  console.log('\nInstitutionAssessment table columns:');
  console.table(iaCols);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Error inspecting db:', e);
  await prisma.$disconnect();
  process.exit(1);
});
