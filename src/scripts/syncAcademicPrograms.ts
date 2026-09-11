import prisma from '../config/db';
import { ENGINEERING_COURSES, ARTS_AND_SCIENCE_COURSES } from '../data/academicPrograms';

export async function syncAcademicPrograms() {
  console.log('--- Starting Academic Programs Synchronization ---');
  console.log(`Engineering courses count: ${ENGINEERING_COURSES.length}`);
  console.log(`Arts & Science courses count: ${ARTS_AND_SCIENCE_COURSES.length}`);

  let engCreated = 0;
  let artsCreated = 0;

  // 1. Seed global Engineering templates (collegeId: null)
  for (const courseName of Array.from(new Set(ENGINEERING_COURSES))) {
    const existing = await prisma.department.findFirst({
      where: {
        departmentName: { equals: courseName, mode: 'insensitive' },
        collegeId: null
      }
    });

    if (!existing) {
      await prisma.department.create({
        data: {
          departmentName: courseName,
          category: 'Engineering',
          collegeId: null
        }
      });
      engCreated++;
    } else if (existing.category !== 'Engineering') {
      await prisma.department.update({
        where: { id: existing.id },
        data: { category: 'Engineering' }
      });
    }
  }

  // 2. Seed global Arts & Science templates (collegeId: null)
  for (const courseName of Array.from(new Set(ARTS_AND_SCIENCE_COURSES))) {
    const existing = await prisma.department.findFirst({
      where: {
        departmentName: { equals: courseName, mode: 'insensitive' },
        collegeId: null
      }
    });

    if (!existing) {
      await prisma.department.create({
        data: {
          departmentName: courseName,
          category: 'Arts & Science',
          collegeId: null
        }
      });
      artsCreated++;
    } else if (existing.category !== 'Arts & Science') {
      await prisma.department.update({
        where: { id: existing.id },
        data: { category: 'Arts & Science' }
      });
    }
  }

  const totalGlobalEng = await prisma.department.count({ where: { category: 'Engineering', collegeId: null } });
  const totalGlobalArts = await prisma.department.count({ where: { category: 'Arts & Science', collegeId: null } });

  console.log(`Created ${engCreated} new Engineering global departments (Total: ${totalGlobalEng})`);
  console.log(`Created ${artsCreated} new Arts & Science global departments (Total: ${totalGlobalArts})`);
  console.log('--- Synchronization Completed Successfully ---');
}

if (require.main === module) {
  syncAcademicPrograms()
    .catch((err) => {
      console.error('Sync failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
}
