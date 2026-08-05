import { Router } from 'express';
import multer from 'multer';
import { UploadController } from '../controllers/uploadController';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Apply auth middleware to all upload endpoints
router.use(authenticateToken);

// Admin bulk uploads
router.post('/students', requireRole(['admin']), upload.single('file'), UploadController.uploadStudents);
router.post('/faculty', requireRole(['admin']), upload.single('file'), UploadController.uploadFaculty);
router.post('/departments', requireRole(['admin']), upload.single('file'), UploadController.uploadDepartments);
router.post('/courses', requireRole(['admin']), upload.single('file'), UploadController.uploadCourses);
router.post('/subjects', requireRole(['admin']), upload.single('file'), UploadController.uploadSubjects);

// Faculty question uploads
router.post('/questions', requireRole(['faculty']), upload.single('file'), UploadController.uploadQuestions);

export default router;
