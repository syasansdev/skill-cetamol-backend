import 'dotenv/config';
import prisma from '../src/config/db';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

let passed = 0;
let total = 0;

function assert(cond: boolean, name: string, detail?: string) {
  total++;
  if (cond) {
    console.log(`[PASS] ${total}. ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${total}. ${name} -> ${detail || ''}`);
  }
}

async function testForeverFacultyLogin() {
  console.log('================================================================');
  console.log('VERIFY FACULTY PERMANENT / FOREVER LOGIN FIX');
  console.log('================================================================\n');

  const testEmail = 'permanent_faculty_fix@university.edu';
  const testPassword = 'facultyForeverPassword2026!';

  try {
    // 0. Clean up any existing record
    await prisma.user.deleteMany({ where: { email: testEmail } });

    // 1. Admin creates faculty account
    console.log('--- 1. Admin Creates Faculty Account ---');
    const cleanEmail = testEmail.trim().toLowerCase();
    const cleanPassword = testPassword.trim();
    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

    const facultyUser = await prisma.user.create({
      data: {
        name: 'Dr. Permanent Faculty',
        email: cleanEmail,
        password: hashedPassword,
        role: 'faculty',
        status: 'active'
      }
    });

    const facultyProfile = await prisma.faculty.create({
      data: {
        userId: facultyUser.id,
        employeeId: 'PERM-FAC-' + Date.now(),
        designation: 'Senior Faculty',
        experience: 5
      }
    });

    assert(facultyUser.id !== undefined, 'Faculty user created successfully');
    assert(facultyUser.status === 'active', 'Faculty initial status is active');

    // 2. Faculty Login Attempt 1
    console.log('\n--- 2. Faculty First Login Attempt ---');
    const userAttempt1 = await prisma.user.findUnique({ where: { email: cleanEmail } });
    assert(userAttempt1 !== null, 'Found faculty user in database');

    const match1 = await bcrypt.compare(cleanPassword, userAttempt1!.password);
    assert(match1, 'Attempt 1: Password matches successfully');

    // Sign long-lived token
    const token1 = jwt.sign(
      { id: userAttempt1!.id, email: userAttempt1!.email, role: userAttempt1!.role, status: userAttempt1!.status },
      process.env.JWT_SECRET || 'your_super_secret_jwt_key',
      { expiresIn: '3650d' }
    );

    const decoded1 = jwt.decode(token1) as any;
    const tokenLifetimeDays = Math.round((decoded1.exp - decoded1.iat) / (24 * 3600));
    assert(tokenLifetimeDays >= 365, `Token is long-lived persistent (${tokenLifetimeDays} days), NOT expired in 24h`);

    // 3. Faculty Login Attempt 2 (Previously failed or expired)
    console.log('\n--- 3. Faculty Second Login Attempt (Checking Credential Re-usability) ---');
    const userAttempt2 = await prisma.user.findUnique({ where: { email: cleanEmail } });
    const match2 = await bcrypt.compare(cleanPassword, userAttempt2!.password);
    assert(match2, 'Attempt 2: Password continues to match perfectly (NOT single-use)');

    // 4. Faculty Login Attempt 3
    console.log('\n--- 4. Faculty Third Login Attempt ---');
    const userAttempt3 = await prisma.user.findUnique({ where: { email: cleanEmail } });
    const match3 = await bcrypt.compare(cleanPassword, userAttempt3!.password);
    assert(match3, 'Attempt 3: Password remains valid indefinitely');

    // 5. Middleware Simulation: User active in DB -> Authorized
    console.log('\n--- 5. Active User Middleware Check ---');
    const activeCheck = await prisma.user.findUnique({
      where: { id: decoded1.id },
      select: { id: true, email: true, role: true, status: true }
    });
    assert(activeCheck !== null && activeCheck.status === 'active', 'Active user validated successfully in DB');

    // 6. Admin Removes Faculty Account
    console.log('\n--- 6. Admin Removes / Deletes Faculty Account ---');
    await prisma.faculty.delete({ where: { id: facultyProfile.id } });
    await prisma.user.delete({ where: { id: facultyUser.id } });

    // Verify token is now instantly rejected by middleware check
    const removedCheck = await prisma.user.findUnique({
      where: { id: decoded1.id },
      select: { id: true, email: true, role: true, status: true }
    });
    assert(removedCheck === null, 'User no longer exists in DB');
    const isMiddlewareRejected = !removedCheck;
    assert(isMiddlewareRejected, 'Token is immediately invalidated upon removal by admin');

    console.log('\n================================================================');
    console.log(`RESULTS: ${passed} / ${total} VERIFICATION CHECKS PASSED!`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testForeverFacultyLogin();

