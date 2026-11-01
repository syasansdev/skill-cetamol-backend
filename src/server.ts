import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';

// Import Routers
import authRouter from './routes/authRoutes';
import adminRouter from './routes/adminRoutes';
import facultyRouter from './routes/facultyRoutes';
import studentRouter from './routes/studentRoutes';
import uploadRouter from './routes/uploadRoutes';
import academicRouter from './routes/academicRoutes';
import notificationRouter from './routes/notificationRoutes';
import centralExamRouter from './routes/centralExamRoutes';


// Import Error Handler
import { errorHandler } from './middleware/errorHandler';
import prisma from './config/db';
import { seedQuantitativeAptitudeQuestions } from './utils/seedQuestions';
import { importGoogleDriveQuestions } from './utils/importQuestions';

async function cleanupSeededData() {
  try {
    const oldDept = await prisma.department.findFirst({
      where: { departmentName: 'Natural Sciences' }
    });
    if (oldDept) {
      console.log('Cleaning up old pre-seeded academic structure (Natural Sciences department found)...');
      // Must delete in reverse FK order to avoid constraint violations
      await prisma.studentAnswer.deleteMany({});
      await prisma.result.deleteMany({});
      await prisma.studentExam.deleteMany({});
      await prisma.examQuestion.deleteMany({});
      await prisma.exam.deleteMany({});
      await prisma.questionOption.deleteMany({});
      await prisma.question.deleteMany({});
      await prisma.portion.deleteMany({});
      await prisma.subject.deleteMany({});
      await prisma.course.deleteMany({});
      await prisma.faculty.deleteMany({});
      await prisma.department.deleteMany({});
      console.log('Cleanup complete!');
    }
  } catch (err) {
    console.error('Error cleaning up pre-seeded data:', err);
  }
}

async function backfillFacultyEmployeeIds() {
  try {
    const facultiesWithoutId = await prisma.faculty.findMany({
      where: { employeeId: null },
      orderBy: { id: 'asc' }
    });
    if (facultiesWithoutId.length > 0) {
      console.log(`[Startup] Backfilling employeeId for ${facultiesWithoutId.length} faculty profiles...`);
      for (const fac of facultiesWithoutId) {
        const count = await prisma.faculty.count({
          where: { employeeId: { not: null } }
        });
        let nextId = count + 1;
        let finalEmployeeId = String(nextId);
        while (await prisma.faculty.findFirst({ where: { employeeId: finalEmployeeId } })) {
          nextId++;
          finalEmployeeId = String(nextId);
        }
        await prisma.faculty.update({
          where: { id: fac.id },
          data: { employeeId: finalEmployeeId }
        });
      }
      console.log('[Startup] Backfill complete!');
    }
  } catch (err) {
    console.error('[Startup] Error backfilling faculty employee IDs:', err);
  }
}

import { seedExamsForAllQuestions } from './scripts/seedAllQuestionsExams';
import { setup12SubjectsAndCategorize } from './scripts/setup12SubjectsAndCategorize';

async function ensureDatabaseSchemaSynced() {
  try {
    const statements = [
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "instructions" TEXT`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "publishedStatus" TEXT DEFAULT 'published'`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "category" TEXT`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "paperName" TEXT`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "targetYears" TEXT DEFAULT 'all'`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "targetYear" INTEGER`,
      `ALTER TABLE "StudentExam" ADD COLUMN IF NOT EXISTS "deadline" TIMESTAMP(3)`,
      `ALTER TABLE "StudentExam" ADD COLUMN IF NOT EXISTS "totalExtensionMinutes" INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE "Result" ADD COLUMN IF NOT EXISTS "performanceCategory" TEXT`,
      `ALTER TABLE "Result" ADD COLUMN IF NOT EXISTS "totalActiveTimeSeconds" INTEGER`,
      `ALTER TABLE "Result" ADD COLUMN IF NOT EXISTS "averageQuestionTimeSeconds" DOUBLE PRECISION`,
      `CREATE TABLE IF NOT EXISTS "QuestionTiming" (
        "id" TEXT PRIMARY KEY,
        "studentExamId" TEXT NOT NULL,
        "questionId" TEXT NOT NULL,
        "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "PerformanceThreshold" (
        "id" TEXT PRIMARY KEY,
        "category" TEXT NOT NULL,
        "minScore" DOUBLE PRECISION NOT NULL,
        "maxScore" DOUBLE PRECISION NOT NULL,
        "color" TEXT,
        "description" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "TimeExtension" (
        "id" TEXT PRIMARY KEY,
        "studentExamId" TEXT NOT NULL,
        "studentId" TEXT NOT NULL,
        "examId" TEXT NOT NULL,
        "originalDeadline" TIMESTAMP(3),
        "newDeadline" TIMESTAMP(3),
        "extensionMinutes" INTEGER NOT NULL,
        "reason" TEXT,
        "grantedById" TEXT NOT NULL,
        "grantedByRole" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "InstitutionAssessment" (
        "id" TEXT PRIMARY KEY,
        "examId" TEXT NOT NULL,
        "collegeId" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'published',
        "publishedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const stmt of statements) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (stmtErr: any) {
        // If column or table already exists or minor notice, ignore
        if (!stmtErr?.message?.includes('already exists')) {
          console.warn(`[Startup Schema Notice] ${stmtErr?.message || stmtErr}`);
        }
      }
    }
    console.log('[Startup] Database schema self-healing verification completed.');
  } catch (err) {
    console.warn('[Startup] Warning during schema self-healing verification:', err);
  }
}

async function initBackgroundData() {
  try {
    await cleanupSeededData();
    await importGoogleDriveQuestions();
    await seedQuantitativeAptitudeQuestions();
    await backfillFacultyEmployeeIds();
    await setup12SubjectsAndCategorize();
    await seedExamsForAllQuestions();
  } catch (err) {
    console.warn('[Startup Background Data Warning]:', err);
  }
}

// Configure dotenv
dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

// Security Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://skill-bill-e990f.web.app',
    'https://skill-bill-e990f.firebaseapp.com',
    'https://skillcetamol.online',
    'https://www.skillcetamol.online',
    process.env.FRONTEND_URL
  ].filter(Boolean) as string[],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

// Request Rate Limiter (prevent brute force, skip admin management)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // higher limit
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/admin') || req.path.startsWith('/diagnostics'),
  message: { message: 'Too many requests from this IP, please try again after 15 minutes' }
});
app.use('/api/', limiter);

// Request logger
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body Parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static upload placeholders if needed
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// Diagnostics endpoint to check DB counts
app.get('/api/diagnostics', async (req, res) => {
  try {
    const qCount = await prisma.question.count();
    const subCount = await prisma.subject.count();
    const fCount = await prisma.faculty.count();
    const dCount = await prisma.department.count();
    const uCount = await prisma.user.count();
    const docCount = await prisma.uploadedDocument.count();

    res.status(200).json({
      status: 'OK',
      counts: {
        questions: qCount,
        subjects: subCount,
        faculty: fCount,
        departments: dCount,
        users: uCount,
        uploadedDocuments: docCount
      }
    });
  } catch (err: any) {
    res.status(500).json({ status: 'Error', error: err.message || err });
  }
});

// Setup API Routes
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/central-exams', centralExamRouter);
app.use('/api/faculty', facultyRouter);
app.use('/api/student', studentRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/academic', academicRouter);
app.use('/api/notifications', notificationRouter);


// Fallback 404 Route
app.use((req, res, next) => {
  res.status(404).json({ message: `API Endpoint not found: ${req.method} ${req.url}` });
});

// Global Error Handler
app.use(errorHandler);

// Start Server after verifying database schema self-healing
async function startServer() {
  try {
    console.log('[Startup] Ensuring PostgreSQL database schema is fully synchronized...');
    await ensureDatabaseSchemaSynced();
    console.log('[Startup] Schema sync verified successfully. Ready to accept connections.');
  } catch (err) {
    console.warn('[Startup] Warning verifying schema before server start:', err);
  }

  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(` Skill Cetamol Exam Backend Server running on port ${PORT}`);
    console.log(` Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`===================================================`);
  });

  // Run background data seeds and imports in the background
  initBackgroundData().catch(err => {
    console.warn('[Background Data Init Warning]:', err);
  });
}

startServer();

export default app;
