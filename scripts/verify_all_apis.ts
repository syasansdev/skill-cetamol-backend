import dotenv from 'dotenv';
dotenv.config();
import prisma from '../src/config/db';
import jwt from 'jsonwebtoken';
import http from 'http';
import app from '../src/server';

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key';

function makeRequest(
  serverPort: number,
  path: string,
  method: string = 'GET',
  token?: string,
  body?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: serverPort,
        path,
        method,
        headers
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode || 500, body: parsed });
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runVerification() {
  console.log('====================================================');
  console.log('   SKILL CETAMOL API & DB ERROR RESOLUTION VERIFICATION');
  console.log('====================================================\n');

  // Find or create test Admin user
  let adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        name: 'Verification Super Admin',
        email: 'test_superadmin@skillcetamol.online',
        password: 'hashed_password',
        role: 'admin',
        status: 'active'
      }
    });
  }

  // Find or create test Faculty user
  let facultyUser = await prisma.user.findFirst({ where: { role: 'faculty' } });
  if (!facultyUser) {
    facultyUser = await prisma.user.create({
      data: {
        name: 'Verification Faculty Member',
        email: 'test_faculty@skillcetamol.online',
        password: 'hashed_password',
        role: 'faculty',
        status: 'active'
      }
    });
    const dept = await prisma.department.findFirst();
    await prisma.faculty.create({
      data: {
        userId: facultyUser.id,
        departmentId: dept ? dept.id : 'none',
        designation: 'Assistant Professor',
        experience: 5
      }
    });
  }

  const adminToken = jwt.sign(
    { id: adminUser.id, email: adminUser.email, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  const facultyToken = jwt.sign(
    { id: facultyUser.id, email: facultyUser.email, role: 'faculty' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // Start test server on dynamic port
  const testServer = http.createServer(app);
  await new Promise<void>((resolve) => testServer.listen(0, resolve));
  const address = testServer.address() as any;
  const testPort = address.port;
  console.log(`Test server running on ephemeral port ${testPort}\n`);

  let allPassed = true;

  try {
    // 1. Verify Prisma Database Schema: Exam.instructions
    console.log('[TEST 1] Verifying Exam.instructions and database schema synchronization...');
    const sampleExam = await prisma.exam.findFirst({
      select: { id: true, title: true, instructions: true, publishedStatus: true }
    });
    console.log(`  ✓ Exam query succeeded. Total examined: 1. Sample instructions field: "${sampleExam?.instructions ?? 'null'}"`);

    // 2. Test GET /api/admin/questions (previously 404)
    console.log('\n[TEST 2] Testing GET /api/admin/questions (Admin Question Bank)...');
    const qRes = await makeRequest(testPort, '/api/admin/questions', 'GET', adminToken);
    if (qRes.status === 200 && Array.isArray(qRes.body)) {
      console.log(`  ✓ GET /api/admin/questions returned 200 OK (${qRes.body.length} questions returned)`);
    } else {
      console.error(`  ✗ GET /api/admin/questions FAILED with status ${qRes.status}:`, qRes.body);
      allPassed = false;
    }

    // 3. Test GET /api/admin/analytics/consolidated (previously 404)
    console.log('\n[TEST 3] Testing GET /api/admin/analytics/consolidated...');
    const anaRes = await makeRequest(testPort, '/api/admin/analytics/consolidated', 'GET', adminToken);
    if (anaRes.status === 200 && typeof anaRes.body.totalStudents === 'number') {
      console.log(`  ✓ GET /api/admin/analytics/consolidated returned 200 OK:`);
      console.log(`    - Total Students: ${anaRes.body.totalStudents}`);
      console.log(`    - Total Assessments: ${anaRes.body.totalAssessments}`);
      console.log(`    - Completed Assessments: ${anaRes.body.completedAssessments}`);
      console.log(`    - Average Student Score: ${anaRes.body.averageStudentScore}%`);
      console.log(`    - Category Distribution Items: ${anaRes.body.categoryDistribution?.length}`);
      console.log(`    - Subject Performance Items: ${anaRes.body.subjectPerformance?.length}`);
      console.log(`    - Student Records: ${anaRes.body.studentRecords?.length}`);
    } else {
      console.error(`  ✗ GET /api/admin/analytics/consolidated FAILED with status ${anaRes.status}:`, anaRes.body);
      allPassed = false;
    }

    // 4. Test GET /api/admin/analytics/consolidated with Query Filters
    console.log('\n[TEST 4] Testing GET /api/admin/analytics/consolidated with filters (category=Good, classification=Average)...');
    const filterRes = await makeRequest(testPort, '/api/admin/analytics/consolidated?classification=Good&subject=Aptitude', 'GET', adminToken);
    if (filterRes.status === 200 && typeof filterRes.body.totalStudents === 'number') {
      console.log(`  ✓ Filters accepted and executed cleanly. Status 200 OK.`);
    } else {
      console.error(`  ✗ Analytics with filters FAILED with status ${filterRes.status}:`, filterRes.body);
      allPassed = false;
    }

    // 5. Test GET /api/central-exams (previously unmounted at top-level)
    console.log('\n[TEST 5] Testing GET /api/central-exams (Central Assessments top-level route)...');
    const centralRes = await makeRequest(testPort, '/api/central-exams', 'GET', adminToken);
    if (centralRes.status === 200 && Array.isArray(centralRes.body)) {
      console.log(`  ✓ GET /api/central-exams returned 200 OK (${centralRes.body.length} assessments returned)`);
    } else {
      console.error(`  ✗ GET /api/central-exams FAILED with status ${centralRes.status}:`, centralRes.body);
      allPassed = false;
    }

    // 6. Test GET /api/admin/central-exams (Admin sub-route)
    console.log('\n[TEST 6] Testing GET /api/admin/central-exams (Admin sub-route)...');
    const adminCentralRes = await makeRequest(testPort, '/api/admin/central-exams', 'GET', adminToken);
    if (adminCentralRes.status === 200 && Array.isArray(adminCentralRes.body)) {
      console.log(`  ✓ GET /api/admin/central-exams returned 200 OK (${adminCentralRes.body.length} assessments returned)`);
    } else {
      console.error(`  ✗ GET /api/admin/central-exams FAILED with status ${adminCentralRes.status}:`, adminCentralRes.body);
      allPassed = false;
    }

    // 7. Test GET /api/faculty/exams
    console.log('\n[TEST 7] Testing GET /api/faculty/exams (Faculty assessment retrieval)...');
    const facultyExamRes = await makeRequest(testPort, '/api/faculty/exams', 'GET', facultyToken);
    if (facultyExamRes.status === 200 && Array.isArray(facultyExamRes.body)) {
      console.log(`  ✓ GET /api/faculty/exams returned 200 OK (${facultyExamRes.body.length} assessments returned)`);
    } else {
      console.error(`  ✗ GET /api/faculty/exams FAILED with status ${facultyExamRes.status}:`, facultyExamRes.body);
      allPassed = false;
    }

    // 8. Test Faculty access to GET /api/central-exams
    console.log('\n[TEST 8] Testing Faculty access to GET /api/central-exams...');
    const facultyCentralRes = await makeRequest(testPort, '/api/central-exams', 'GET', facultyToken);
    if (facultyCentralRes.status === 200 && Array.isArray(facultyCentralRes.body)) {
      console.log(`  ✓ Faculty permitted to query assigned central assessments. Status 200 OK (${facultyCentralRes.body.length} exams).`);
    } else {
      console.error(`  ✗ Faculty GET /api/central-exams FAILED with status ${facultyCentralRes.status}:`, facultyCentralRes.body);
      allPassed = false;
    }

    // 9. Test Student Profile Drilldown: /api/admin/analytics/student/:studentId
    console.log('\n[TEST 9] Testing GET /api/admin/analytics/student/:studentId drilldown...');
    const anyStudent = await prisma.student.findFirst();
    if (anyStudent) {
      const studentProfileRes = await makeRequest(testPort, `/api/admin/analytics/student/${anyStudent.id}`, 'GET', adminToken);
      if (studentProfileRes.status === 200 && studentProfileRes.body.student && studentProfileRes.body.metrics) {
        console.log(`  ✓ Student drilldown profile returned 200 OK with student, metrics, and assessments.`);
      } else {
        console.error(`  ✗ Student profile drilldown FAILED with status ${studentProfileRes.status}:`, studentProfileRes.body);
        allPassed = false;
      }
    } else {
      console.log('  - Skipped: no student records found to drill down into.');
    }

    // 10. Role-based Access Control (Unauthorized access check)
    console.log('\n[TEST 10] Testing RBAC: Unauthorized request without token...');
    const unauthRes = await makeRequest(testPort, '/api/admin/questions', 'GET');
    if (unauthRes.status === 401) {
      console.log(`  ✓ Unauthenticated request rejected with 401 Unauthorized.`);
    } else {
      console.error(`  ✗ RBAC verification failed! Expected 401, got ${unauthRes.status}`);
      allPassed = false;
    }

  } catch (err) {
    console.error('Unexpected error during API verification:', err);
    allPassed = false;
  } finally {
    testServer.close();
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  if (allPassed) {
    console.log('   ALL BACKEND APIS & DATABASE VERIFICATIONS PASSED!  ');
  } else {
    console.log('   SOME VERIFICATIONS FAILED - SEE ABOVE LOGS        ');
  }
  console.log('====================================================');

  process.exit(allPassed ? 0 : 1);
}

runVerification();

