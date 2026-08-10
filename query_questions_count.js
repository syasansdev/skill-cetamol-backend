const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function query() {
  try {
    const qCount = await prisma.question.count();
    const subCount = await prisma.subject.count();
    const fCount = await prisma.faculty.count();
    const dCount = await prisma.department.count();
    const uCount = await prisma.user.count();
    const docCount = await prisma.uploadedDocument.count();

    console.log("=== DATABASE STATISTICS ===");
    console.log(`Questions: ${qCount}`);
    console.log(`Subjects: ${subCount}`);
    console.log(`Faculty: ${fCount}`);
    console.log(`Departments: ${dCount}`);
    console.log(`Users: ${uCount}`);
    console.log(`Uploaded Documents: ${docCount}`);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

query();
