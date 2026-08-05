import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database — clean slate (admin + academic structure only)...');

  // Wipe all transactional data first (safe deletion order)
  await prisma.activityLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.result.deleteMany({});
  await prisma.studentAnswer.deleteMany({});
  await prisma.studentExam.deleteMany({});
  await prisma.examQuestion.deleteMany({});
  await prisma.exam.deleteMany({});
  await prisma.questionOption.deleteMany({});
  await prisma.question.deleteMany({});

  // Delete profiles before users
  await prisma.student.deleteMany({});
  await prisma.faculty.deleteMany({});
  await prisma.user.deleteMany({});

  // Delete academic structure
  await prisma.subject.deleteMany({});
  await prisma.course.deleteMany({});
  await prisma.department.deleteMany({});

  // ── 1. Admin User ────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('syasans123;!', 10);
  await prisma.user.create({
    data: {
      name: 'Administrator',
      email: 'syasanscareeranalytics@gmail.com',
      password: adminHash,
      role: 'admin',
      status: 'active'
    }
  });

  console.log('✅ Seed complete. Database contains only: Admin user.');
  console.log('   Admin login: syasanscareeranalytics@gmail.com  /  syasans123;!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
