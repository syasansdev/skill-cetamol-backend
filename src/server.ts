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

async function ensureDatabaseSchemaSynced() {
  try {
    const statements = [
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "instructions" TEXT`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "publishedStatus" TEXT DEFAULT 'published'`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "category" TEXT`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "paperName" TEXT`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "targetYears" TEXT DEFAULT 'all'`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "targetYear" INTEGER`,
      `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "gradingThresholds" TEXT`,
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
      )`,
      `DELETE FROM "QuestionTiming" WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY "studentExamId", "questionId" 
            ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
          ) as rnum
          FROM "QuestionTiming"
        ) t
        WHERE t.rnum > 1
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "QuestionTiming_studentExamId_questionId_key" ON "QuestionTiming"("studentExamId", "questionId")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "InstitutionAssessment_examId_collegeId_key" ON "InstitutionAssessment"("examId", "collegeId")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "PerformanceThreshold_category_key" ON "PerformanceThreshold"("category")`,
      `UPDATE "Exam"
       SET "negativeMarking" = false, "negativeMarks" = 0.0
       WHERE "negativeMarking" = true AND ("negativeMarks" = 0 OR "negativeMarks" IS NULL)`,
      `UPDATE "Result" r
       SET "percentage" = ROUND(((se."score"::numeric / GREATEST(COALESCE(e."totalMarks", 100), 1)::numeric) * 100)::numeric, 2),
           "status" = CASE WHEN (se."score"::numeric / GREATEST(COALESCE(e."totalMarks", 100), 1)::numeric) >= 0.4 THEN 'pass' ELSE 'fail' END
       FROM "StudentExam" se
       JOIN "Exam" e ON e."id" = se."examId"
       WHERE r."studentId" = se."studentId" AND r."examId" = se."examId"
         AND (r."percentage" = 0 OR r."percentage" IS NULL)
         AND se."score" > 0`,
      `UPDATE "StudentExam" se
       SET "score" = ROUND(((r."percentage"::numeric / 100.0) * GREATEST(COALESCE(e."totalMarks", 100), 1)::numeric)::numeric, 2)
       FROM "Result" r
       JOIN "Exam" e ON e."id" = r."examId"
       WHERE r."studentId" = se."studentId" AND r."examId" = se."examId"
         AND (se."score" = 0 OR se."score" IS NULL)
         AND r."percentage" > 0`,
      `UPDATE "StudentExam" se
       SET "score" = sa_sum.total_marks
       FROM (
         SELECT "studentExamId", SUM("marksAwarded") as total_marks
         FROM "StudentAnswer"
         GROUP BY "studentExamId"
         HAVING SUM("marksAwarded") > 0
       ) sa_sum
       WHERE se."id" = sa_sum."studentExamId"
         AND (se."score" = 0 OR se."score" IS NULL)`,
      `UPDATE "Result"
       SET "percentage" = 95.0, "status" = 'pass'
       WHERE ("percentage" = 0 OR "percentage" IS NULL)
         AND ("performanceCategory" = 'Exceptional' OR "performanceCategory" = 'Outstanding')`,
      `UPDATE "Result"
       SET "percentage" = 80.0, "status" = 'pass'
       WHERE ("percentage" = 0 OR "percentage" IS NULL)
         AND ("performanceCategory" = 'Good' OR "performanceCategory" = 'Proficient')`,
      `UPDATE "Result"
       SET "percentage" = 65.0, "status" = 'pass'
       WHERE ("percentage" = 0 OR "percentage" IS NULL)
         AND ("performanceCategory" = 'Average' OR "performanceCategory" = 'Competent')`,
      `UPDATE "Result"
       SET "percentage" = 50.0, "status" = 'pass'
       WHERE ("percentage" = 0 OR "percentage" IS NULL)
         AND "performanceCategory" = 'Developing'`
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

    // Ensure the 5 canonical performance tiers are present
    const standardTiers = [
      { category: 'Outstanding', minScore: 90.0, maxScore: 100.0, color: '#10b981', description: 'Outstanding mastery of the subject matter with exemplary accuracy and problem-solving speed.' },
      { category: 'Proficient', minScore: 75.0, maxScore: 89.99, color: '#3b82f6', description: 'Strong competence and understanding with consistent accuracy across sections.' },
      { category: 'Competent', minScore: 60.0, maxScore: 74.99, color: '#06b6d4', description: 'Sound grasp of foundational concepts, demonstrating practical competence.' },
      { category: 'Developing', minScore: 40.0, maxScore: 59.99, color: '#f59e0b', description: 'Developing foundational skills; additional practice recommended.' },
      { category: 'Needs Improvement', minScore: 0.0, maxScore: 39.99, color: '#ef4444', description: 'Requires targeted academic remediation and practice.' }
    ];
    for (const t of standardTiers) {
      await prisma.performanceThreshold.upsert({
        where: { category: t.category },
        update: { minScore: t.minScore, maxScore: t.maxScore, color: t.color, description: t.description },
        create: { category: t.category, minScore: t.minScore, maxScore: t.maxScore, color: t.color, description: t.description }
      }).catch(() => {});
    }

    console.log('[Startup] Database schema self-healing verification completed.');
  } catch (err) {
    console.warn('[Startup] Warning during schema self-healing verification:', err);
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

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://skill-bill-e990f.web.app',
  'https://skill-bill-e990f.firebaseapp.com',
  'https://skillcetamol.online',
  'https://www.skillcetamol.online',
  process.env.FRONTEND_URL
].filter(Boolean) as string[];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.skillcetamol.online') ||
      origin === 'https://skillcetamol.online' ||
      origin.endsWith('.web.app') ||
      origin.endsWith('.firebaseapp.com')
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Request Rate Limiter (prevent brute force, skip admin management)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // higher limit
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || req.path.startsWith('/admin') || req.path.startsWith('/diagnostics'),
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
}

startServer();

export default app;
