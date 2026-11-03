import { Router } from 'express';
import { StudentController } from '../controllers/studentController';
import { StudentAnalyticsController } from '../controllers/studentAnalyticsController';
import { authenticateToken, requireRole } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Configure notes upload storage directory
const uploadDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Apply auth middleware to all student endpoints
router.use(authenticateToken);

// Individual result details & report card viewable by student, faculty, and admin
router.get('/results/:id', requireRole(['student', 'faculty', 'admin']), StudentController.getResultDetails);
router.get('/reports/:id', requireRole(['student', 'faculty', 'admin']), StudentAnalyticsController.getIndividualReport);

// All subsequent candidate examination operations require student role
router.use(requireRole(['student']));

router.get('/exams', StudentController.getExams);
router.get('/exams/:id', StudentController.getExamById);
router.post('/exams/:id/submit', StudentController.submitExam);
router.post('/exams/:id/auto-save', StudentController.autoSaveExam);
router.post('/exams/:id/proctor-event', StudentController.logProctorEvent);
router.get('/results', StudentController.getResults);

// Master Analytics
router.get('/analytics/master-summary', StudentAnalyticsController.getMasterAnalytics);

// Academic and Portions
router.get('/subjects', StudentController.getSubjects);
router.get('/portions', StudentController.getPortions);

// Notes Upload
router.get('/notes', StudentController.getNotes);
router.post('/notes', upload.single('file'), StudentController.createNote);
router.delete('/notes/:id', StudentController.deleteNote);

export default router;

