import { Router } from 'express';
import multer from 'multer';
import { FacultyController } from '../controllers/facultyController';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { createExamSchema, createQuestionSchema } from '../validators';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

// Apply auth middleware to all faculty endpoints
router.use(authenticateToken);
router.use(requireRole(['faculty', 'admin']));

router.get('/questions', FacultyController.getQuestions);
router.post('/questions', validateBody(createQuestionSchema), FacultyController.createQuestion);
router.post('/questions/import', FacultyController.importQuestions);

router.get('/exams', FacultyController.getExams);
router.post('/exams', validateBody(createExamSchema), FacultyController.createExam);

router.get('/results', FacultyController.getResults);
router.get('/pending-students', FacultyController.getPendingStudents);
router.post('/students/:id/approve', FacultyController.approveStudent);

// New enterprise endpoints
router.get('/upcoming-exams', FacultyController.getUpcomingExams);
router.get('/pending-grading', FacultyController.getPendingGrading);
router.post('/grade-answer', FacultyController.gradeAnswer);
router.get('/question-stats', FacultyController.getQuestionStats);

// Portions syllabus management
router.get('/portions', FacultyController.getPortions);
router.post('/portions', FacultyController.createPortion);
router.put('/portions/:id', FacultyController.updatePortion);
router.delete('/portions/:id', FacultyController.deletePortion);

// Student notes view
router.get('/student-notes', FacultyController.getStudentNotes);

// Question extraction and Custom Exam setup from documents
router.post('/upload-qpaper', upload.single('file'), FacultyController.uploadQPaper);
router.get('/uploaded-qpapers', FacultyController.getUploadedQPapers);
router.get('/uploaded-qpapers/:id/questions', FacultyController.getQPaperQuestions);
router.delete('/uploaded-qpapers/:id', FacultyController.deleteUploadedQPaper);
router.post('/questions/generate-ai', FacultyController.generateAIQuestions);

export default router;

