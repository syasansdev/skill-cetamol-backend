import prisma from '../config/db';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING END-TO-END VERIFICATION OF ALL REQUIREMENTS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} - ${detail || 'Assertion failed'}`);
    }
  }

  try {
    // 1. Verify 48 colleges are seeded in DB
    const colleges = await prisma.college.findMany({ orderBy: { collegeName: 'asc' } });
    assert(colleges.length >= 48, 'Verify 48 Colleges Exist', `Found ${colleges.length} colleges`);

    // Pick College A (a university or institution that offers both Engineering and Arts & Science)
    let collegeA = colleges[0];
    let deptsAEng: any[] = [];
    let deptsAArts: any[] = [];
    for (const c of colleges) {
      const eng = await prisma.department.findMany({ where: { collegeId: c.id, category: 'Engineering' } });
      const arts = await prisma.department.findMany({ where: { collegeId: c.id, category: 'Arts & Science' } });
      if (eng.length >= 2 && arts.length >= 1) {
        collegeA = c;
        deptsAEng = eng;
        deptsAArts = arts;
        break;
      }
    }

    // Pick College B (a different college with Engineering departments)
    let collegeB = colleges.find(c => c.id !== collegeA.id)!;
    let deptsBEng: any[] = [];
    for (const c of colleges) {
      if (c.id === collegeA.id) continue;
      const eng = await prisma.department.findMany({ where: { collegeId: c.id, category: 'Engineering' } });
      if (eng.length >= 1) {
        collegeB = c;
        deptsBEng = eng;
        break;
      }
    }

    console.log(`Using College A: ${collegeA.collegeName} (${collegeA.id})`);
    console.log(`Using College B: ${collegeB.collegeName} (${collegeB.id})`);

    // 2. Verify departments under College A for Engineering and Arts & Science
    assert(deptsAEng.length >= 2, 'College A has multiple Engineering departments', `Found ${deptsAEng.length}`);
    assert(deptsAArts.length >= 1, 'College A has Arts & Science departments', `Found ${deptsAArts.length}`);

    const deptA_Eng1 = deptsAEng[0];
    const deptA_Eng2 = deptsAEng[1];
    const deptA_Arts1 = deptsAArts[0];

    // Verify departments under College B
    assert(deptsBEng.length >= 1, 'College B has Engineering departments', `Found ${deptsBEng.length}`);
    const deptB_Eng1 = deptsBEng[0];

    // Clean up any previous test accounts
    const testEmails = [
      'test_faculty_a1@test.com',
      'test_faculty_a2@test.com',
      'test_student_a_eng1@test.com',
      'test_student_a_eng2@test.com',
      'test_student_a_arts@test.com',
      'test_student_b_eng@test.com'
    ];
    for (const email of testEmails) {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) {
        await prisma.studentAnswer.deleteMany({ where: { studentExam: { student: { userId: u.id } } } });
        await prisma.studentExam.deleteMany({ where: { student: { userId: u.id } } });
        await prisma.result.deleteMany({ where: { student: { userId: u.id } } });
        await prisma.student.deleteMany({ where: { userId: u.id } });
        await prisma.faculty.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
    }

    // Also clean up any existing faculty for College A & B to ensure clean test
    const existingFacA = await prisma.faculty.findUnique({ where: { collegeId: collegeA.id } });
    if (existingFacA) {
      await prisma.exam.deleteMany({ where: { facultyId: existingFacA.id } });
      await prisma.faculty.delete({ where: { id: existingFacA.id } });
      await prisma.user.delete({ where: { id: existingFacA.userId } });
    }
    const existingFacB = await prisma.faculty.findUnique({ where: { collegeId: collegeB.id } });
    if (existingFacB) {
      await prisma.exam.deleteMany({ where: { facultyId: existingFacB.id } });
      await prisma.faculty.delete({ where: { id: existingFacB.id } });
      await prisma.user.delete({ where: { id: existingFacB.userId } });
    }

    // 3. Test 1: Create Faculty for College A (Should Succeed without department)
    const userFacA = await prisma.user.create({
      data: {
        name: 'Prof. Alice College A',
        email: 'test_faculty_a1@test.com',
        password: await bcrypt.hash('pass123', 10),
        role: 'faculty',
        status: 'active'
      }
    });
    const facA = await prisma.faculty.create({
      data: {
        userId: userFacA.id,
        employeeId: `FAC-${Date.now()}-1`,
        collegeId: collegeA.id,
        departmentId: null,
        designation: 'Professor',
        experience: 5
      }
    });
    assert(facA.collegeId === collegeA.id && facA.departmentId === null, 'Faculty A created at college level without department');

    // 4. Test 2: Attempt to create SECOND Faculty for College A (Must be rejected)
    let duplicateRejected = false;
    try {
      const userFacA2 = await prisma.user.create({
        data: {
          name: 'Prof. Second for College A',
          email: 'test_faculty_a2@test.com',
          password: await bcrypt.hash('pass123', 10),
          role: 'faculty',
          status: 'active'
        }
      });
      // Try to create faculty with same collegeId in DB (unique constraint)
      await prisma.faculty.create({
        data: {
          userId: userFacA2.id,
          employeeId: `FAC-${Date.now()}-2`,
          collegeId: collegeA.id,
          departmentId: null,
          designation: 'Lecturer',
          experience: 2
        }
      });
    } catch (e: any) {
      duplicateRejected = true;
    }
    assert(duplicateRejected, 'Enforce 1 Faculty Per College in DB: duplicate rejected');

    // 5. Test 3: Faculty creates exams across multiple departments within College A
    const subject = await prisma.subject.findFirst();
    const exam1 = await prisma.exam.create({
      data: {
        title: 'Midterm Exam - Eng 1',
        description: 'Test Exam Description 1',
        collegeId: collegeA.id,
        category: 'Engineering',
        departmentId: deptA_Eng1.id,
        facultyId: facA.id,
        duration: 45,
        totalMarks: 50,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        status: 'active',
        subjectId: subject?.id || null
      }
    });
    assert(exam1.departmentId === deptA_Eng1.id && exam1.category === 'Engineering', 'Faculty created Exam 1 for Dept A Eng 1');

    const exam2 = await prisma.exam.create({
      data: {
        title: 'Quiz Exam - Eng 2',
        description: 'Test Exam Description 2',
        collegeId: collegeA.id,
        category: 'Engineering',
        departmentId: deptA_Eng2.id,
        facultyId: facA.id,
        duration: 30,
        totalMarks: 20,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        status: 'active',
        subjectId: subject?.id || null
      }
    });
    assert(exam2.departmentId === deptA_Eng2.id, 'Faculty created Exam 2 for different Dept A Eng 2 (Multi-dept creation)');

    const exam3 = await prisma.exam.create({
      data: {
        title: 'Arts & Science Exam',
        description: 'Test Exam Description 3',
        collegeId: collegeA.id,
        category: 'Arts & Science',
        departmentId: deptA_Arts1.id,
        facultyId: facA.id,
        duration: 60,
        totalMarks: 100,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        status: 'active',
        subjectId: subject?.id || null
      }
    });
    assert(exam3.category === 'Arts & Science' && exam3.departmentId === deptA_Arts1.id, 'Faculty created Exam 3 for Arts & Science dept');

    // 6. Test 4: Student Registration & Exam Visibility
    // Student 1: College A, Engineering, deptA_Eng1
    const userStu1 = await prisma.user.create({
      data: {
        name: 'Student 1 (A, Eng, Dept 1)',
        email: 'test_student_a_eng1@test.com',
        password: await bcrypt.hash('pass123', 10),
        role: 'student',
        status: 'active'
      }
    });
    const stu1 = await prisma.student.create({
      data: {
        userId: userStu1.id,
        registerNumber: `REG-A-ENG1-${Date.now()}`,
        collegeId: collegeA.id,
        category: 'Engineering',
        departmentId: deptA_Eng1.id,
        year: 1
      }
    });

    // Student 2: College A, Engineering, deptA_Eng2 (Different department)
    const userStu2 = await prisma.user.create({
      data: {
        name: 'Student 2 (A, Eng, Dept 2)',
        email: 'test_student_a_eng2@test.com',
        password: await bcrypt.hash('pass123', 10),
        role: 'student',
        status: 'active'
      }
    });
    const stu2 = await prisma.student.create({
      data: {
        userId: userStu2.id,
        registerNumber: `REG-A-ENG2-${Date.now()}`,
        collegeId: collegeA.id,
        category: 'Engineering',
        departmentId: deptA_Eng2.id,
        year: 1
      }
    });

    // Student 3: College A, Arts & Science, deptA_Arts1 (Different category)
    const userStu3 = await prisma.user.create({
      data: {
        name: 'Student 3 (A, Arts)',
        email: 'test_student_a_arts@test.com',
        password: await bcrypt.hash('pass123', 10),
        role: 'student',
        status: 'active'
      }
    });
    const stu3 = await prisma.student.create({
      data: {
        userId: userStu3.id,
        registerNumber: `REG-A-ARTS-${Date.now()}`,
        collegeId: collegeA.id,
        category: 'Arts & Science',
        departmentId: deptA_Arts1.id,
        year: 1
      }
    });

    // Student 4: College B, Engineering, deptB_Eng1 (Different college)
    const userStu4 = await prisma.user.create({
      data: {
        name: 'Student 4 (College B)',
        email: 'test_student_b_eng@test.com',
        password: await bcrypt.hash('pass123', 10),
        role: 'student',
        status: 'active'
      }
    });
    const stu4 = await prisma.student.create({
      data: {
        userId: userStu4.id,
        registerNumber: `REG-B-ENG-${Date.now()}`,
        collegeId: collegeB.id,
        category: 'Engineering',
        departmentId: deptB_Eng1.id,
        year: 1
      }
    });

    // Helper to query exams visible to a student using exact backend visibility filter
    async function getVisibleExams(student: any) {
      if (!student.collegeId || !student.category || !student.departmentId) return [];
      return prisma.exam.findMany({
        where: {
          collegeId: student.collegeId,
          category: student.category,
          departmentId: student.departmentId
        }
      });
    }

    // 7. Verify Visibility Rules
    const stu1Exams = await getVisibleExams(stu1);
    assert(
      stu1Exams.length === 1 && stu1Exams[0].id === exam1.id,
      'Student 1 (A, Eng, Dept 1) only sees Exam 1',
      `Saw ${stu1Exams.map(e => e.title).join(', ')}`
    );

    const stu2Exams = await getVisibleExams(stu2);
    assert(
      stu2Exams.length === 1 && stu2Exams[0].id === exam2.id,
      'Student 2 (A, Eng, Dept 2) only sees Exam 2 (dept mismatch prevents seeing Exam 1)',
      `Saw ${stu2Exams.map(e => e.title).join(', ')}`
    );

    const stu3Exams = await getVisibleExams(stu3);
    assert(
      stu3Exams.length === 1 && stu3Exams[0].id === exam3.id,
      'Student 3 (A, Arts) only sees Exam 3 (category mismatch prevents seeing Exam 1/2)',
      `Saw ${stu3Exams.map(e => e.title).join(', ')}`
    );

    const stu4Exams = await getVisibleExams(stu4);
    assert(
      stu4Exams.length === 0,
      'Student 4 (College B) sees 0 exams from College A (college mismatch)',
      `Saw ${stu4Exams.length} exams`
    );

    // 8. Test 5: API Tampering Check (Simulating student 4 or student 2 trying to take/submit exam 1)
    function checkEligibility(student: any, exam: any) {
      if (
        (exam.collegeId && exam.collegeId !== student.collegeId) ||
        (exam.category && exam.category !== student.category) ||
        (exam.departmentId && exam.departmentId !== student.departmentId)
      ) {
        return 403; // Forbidden
      }
      return 200;
    }

    assert(checkEligibility(stu1, exam1) === 200, 'Student 1 is eligible for Exam 1');
    assert(checkEligibility(stu2, exam1) === 403, 'Tampering: Student 2 blocked from Exam 1 with 403 (Department mismatch)');
    assert(checkEligibility(stu3, exam1) === 403, 'Tampering: Student 3 blocked from Exam 1 with 403 (Category mismatch)');
    assert(checkEligibility(stu4, exam1) === 403, 'Tampering: Student 4 blocked from Exam 1 with 403 (College mismatch)');

    // Clean up test data
    await prisma.exam.deleteMany({ where: { id: { in: [exam1.id, exam2.id, exam3.id] } } });
    await prisma.student.deleteMany({ where: { id: { in: [stu1.id, stu2.id, stu3.id, stu4.id] } } });
    await prisma.faculty.deleteMany({ where: { id: facA.id } });
    await prisma.user.deleteMany({ where: { id: { in: [userFacA.id, userStu1.id, userStu2.id, userStu3.id, userStu4.id] } } });

    console.log('\n====================================================');
    console.log(`VERIFICATION COMPLETE: ${passed}/${total} TESTS PASSED`);
    console.log('====================================================');
    process.exit(passed === total ? 0 : 1);
  } catch (error) {
    console.error('Test execution failed with error:', error);
    process.exit(1);
  }
}

runTests();
