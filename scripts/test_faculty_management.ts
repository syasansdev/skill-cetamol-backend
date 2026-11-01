import dotenv from 'dotenv';
dotenv.config();
import prisma from '../src/config/db';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import http from 'http';
import app from '../src/server';

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

async function runTest() {
  console.log('=== TESTING FACULTY MANAGEMENT WORKFLOW ===');

  const testServer = http.createServer(app);
  await new Promise<void>((resolve) => {
    testServer.listen(0, () => resolve());
  });
  const port = (testServer.address() as any).port;
  console.log(`Test server running on port ${port}`);

  try {
    // 1. Create or get Admin user
    let admin = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (!admin) {
      const hashed = await bcrypt.hash('admin123', 10);
      admin = await prisma.user.create({
        data: {
          name: 'Super Admin',
          email: `admin_${Date.now()}@skillcetamol.online`,
          password: hashed,
          role: 'admin',
          status: 'active'
        }
      });
    }

    const adminToken = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role, status: admin.status },
      process.env.JWT_SECRET || 'your_super_secret_jwt_key',
      { expiresIn: '1d' }
    );

    // 2. Ensure test college exists
    let college = await prisma.college.findFirst({ where: { collegeName: 'Test Automation University' } });
    if (!college) {
      college = await prisma.college.create({
        data: {
          collegeName: 'Test Automation University',
          code: 'TAU'
        }
      });
    }

    const testEmail = `testfac_${Date.now()}@example.com`;
    const initialPassword = 'InitialFacultyPass123';

    // 3. Admin creates Faculty
    console.log('\n[Test 1] POST /api/admin/faculty - Create Faculty');
    const createRes = await makeRequest(port, '/api/admin/faculty', 'POST', adminToken, {
      name: 'Professor Test',
      email: testEmail,
      password: initialPassword,
      facultyId: `EMP-${Date.now()}`,
      collegeId: college.id,
      role: 'faculty'
    });

    console.log('Create Faculty Response Status:', createRes.status);
    console.log('Created User ID:', createRes.body?.id);
    if (createRes.status !== 201) {
      throw new Error(`Create failed: ${JSON.stringify(createRes.body)}`);
    }
    const createdUserId = createRes.body.id;

    // 4. Admin edits Faculty
    console.log('\n[Test 2] PUT /api/admin/faculty/:id - Edit Faculty');
    const updatedName = 'Professor Test Updated';
    const updatedEmail = `testfac_updated_${Date.now()}@example.com`;
    const updatedEmpId = `EMP-UPDATED-${Date.now()}`;

    const editRes = await makeRequest(port, `/api/admin/faculty/${createdUserId}`, 'PUT', adminToken, {
      name: updatedName,
      email: updatedEmail,
      facultyId: updatedEmpId,
      collegeId: college.id,
      status: 'active'
    });

    console.log('Edit Faculty Response Status:', editRes.status);
    console.log('Updated Name:', editRes.body?.name);
    console.log('Updated Email:', editRes.body?.email);
    console.log('Updated EmployeeId:', editRes.body?.facultyId);
    if (editRes.status !== 200 || editRes.body?.name !== updatedName) {
      throw new Error(`Edit failed: ${JSON.stringify(editRes.body)}`);
    }

    // 5. Admin resets Password to custom password
    console.log('\n[Test 3] POST /api/admin/faculty/:id/reset-password - Custom Password');
    const newPassword = 'CustomResetPass999!';
    const resetRes = await makeRequest(port, `/api/admin/faculty/${createdUserId}/reset-password`, 'POST', adminToken, {
      newPassword
    });

    console.log('Reset Password Response Status:', resetRes.status);
    console.log('Returned New Password:', resetRes.body?.newPassword);
    if (resetRes.status !== 200 || resetRes.body?.newPassword !== newPassword) {
      throw new Error(`Reset failed: ${JSON.stringify(resetRes.body)}`);
    }

    // 6. Faculty logs in with the new reset password
    console.log('\n[Test 4] POST /api/auth/login - Login with new password');
    const loginRes = await makeRequest(port, '/api/auth/login', 'POST', undefined, {
      email: updatedEmail,
      password: newPassword
    });

    console.log('Login Response Status:', loginRes.status);
    console.log('Login Token present:', !!loginRes.body?.token);
    if (loginRes.status !== 200 || !loginRes.body?.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
    }

    // 7. Simulate faculty having created exams, questions, time extensions
    console.log('\n[Test 5] Simulating faculty exam, questions & cascade relations');
    const facProfile = await prisma.faculty.findFirst({ where: { userId: createdUserId } });
    if (facProfile) {
      let dummySubject = await prisma.subject.findFirst();
      if (!dummySubject) {
        const dept = await prisma.department.create({ data: { departmentName: 'Test Dept' } });
        const crs = await prisma.course.create({ data: { courseName: `Test Course ${Date.now()}`, departmentId: dept.id } });
        dummySubject = await prisma.subject.create({ data: { subjectName: 'Test Subj', courseId: crs.id, semester: 1 } });
      }

      const testExam = await prisma.exam.create({
        data: {
          title: 'Cascade Test Exam',
          description: 'Test description',
          instructions: 'Test instructions',
          duration: 30,
          totalMarks: 50,
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
          status: 'active',
          facultyId: facProfile.id,
          subjectId: dummySubject.id,
          collegeId: college.id
        }
      });

      await prisma.institutionAssessment.create({
        data: {
          examId: testExam.id,
          collegeId: college.id,
          status: 'published'
        }
      });

      const testQ = await prisma.question.create({
        data: {
          question: 'Cascade Test Question?',
          type: 'mcq',
          difficulty: 'easy',
          marks: 5,
          facultyId: facProfile.id,
          subjectId: dummySubject.id
        }
      });

      await prisma.questionOption.create({
        data: {
          questionId: testQ.id,
          option: 'Option A',
          isCorrect: true
        }
      });

      await prisma.examQuestion.create({
        data: {
          examId: testExam.id,
          questionId: testQ.id
        }
      });

      console.log('Successfully created dummy Exam, Question, Option, InstitutionAssessment attached to faculty.');
    }

    // 8. Admin deletes Faculty (verifying full cascade with NO foreign key error)
    console.log('\n[Test 6] DELETE /api/admin/faculty/:id - Cascade Delete Faculty');
    const deleteRes = await makeRequest(port, `/api/admin/faculty/${createdUserId}`, 'DELETE', adminToken);

    console.log('Delete Response Status:', deleteRes.status);
    console.log('Delete Response Message:', deleteRes.body?.message);
    if (deleteRes.status !== 200) {
      throw new Error(`Delete failed: ${JSON.stringify(deleteRes.body)}`);
    }

    // Verify deletion from DB
    const checkUser = await prisma.user.findUnique({ where: { id: createdUserId } });
    console.log('DB Check after delete (should be null):', checkUser);
    if (checkUser !== null) {
      throw new Error('User was not deleted from DB!');
    }

    console.log('\n✅ ALL 6 FACULTY MANAGEMENT TESTS PASSED PERFECTLY!\n');
  } finally {
    testServer.close();
  }
}

runTest().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
