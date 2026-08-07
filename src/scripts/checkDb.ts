import prisma from '../config/db';

async function main() {
  const users = await prisma.user.findMany({
    include: { faculty: true }
  });
  console.log('--- USERS & FACULTIES ---');
  console.log(JSON.stringify(users, null, 2));

  const departments = await prisma.department.findMany({
    include: { courses: { include: { subjects: true } } }
  });
  console.log('--- ACADEMIC STRUCTURE ---');
  console.log(JSON.stringify(departments, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
