import { Router } from 'express';
import multer from 'multer';
import { AdminController } from '../controllers/adminController';
import { FacultyController } from '../controllers/facultyController';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { createFacultySchema } from '../validators';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

// Apply auth middleware to all admin endpoints
router.use(authenticateToken);

// Accessible by Admin and Faculty
router.get('/subjects', requireRole(['admin', 'faculty']), AdminController.getSubjects);
router.post('/subjects', requireRole(['admin', 'faculty']), AdminController.createSubject);
router.delete('/subjects/:id', requireRole(['admin', 'faculty']), AdminController.deleteSubject);

// College operations (accessible by admin and faculty)
router.get('/colleges', requireRole(['admin', 'faculty']), AdminController.getColleges);
router.post('/colleges', requireRole(['admin']), AdminController.createCollege);
router.delete('/colleges/:id', requireRole(['admin']), AdminController.deleteCollege);

// Department operations
router.get('/departments', requireRole(['admin', 'faculty']), AdminController.getDepartments);
router.post('/departments', requireRole(['admin', 'faculty']), AdminController.createDepartment);
router.delete('/departments/:id', requireRole(['admin', 'faculty']), AdminController.deleteDepartment);

// Course operations (accessible by admin and faculty)
router.get('/courses', requireRole(['admin', 'faculty']), AdminController.getCourses);
router.post('/courses', requireRole(['admin', 'faculty']), AdminController.createCourse);

// Locked Examinations Proctor Monitor operations (accessible by Admin and Faculty)
router.get('/locked-exams', requireRole(['admin', 'faculty']), AdminController.getLockedExams);
router.put('/unlock-exam/:id', requireRole(['admin', 'faculty']), AdminController.unlockExam);
router.put('/revoke-exam/:id', requireRole(['admin', 'faculty']), AdminController.revokeExam);

router.use(requireRole(['admin']));

router.get('/users', AdminController.getUsers);
router.post('/users/:id/approve', AdminController.approveStudent);
router.delete('/users/:id', AdminController.deleteUser);
router.post('/faculty', validateBody(createFacultySchema), AdminController.createFaculty);
router.post('/faculty/:id/resend-welcome', AdminController.resendFacultyWelcome);
router.post('/faculty/:id/reset-password', AdminController.resetUserPassword);
router.post('/reset-database', AdminController.resetDatabase);

// Global Search & User Management
router.get('/search-users', AdminController.searchUsers);
router.get('/user/:id', AdminController.getUserById);
router.get('/users/:id', AdminController.getUserById);
router.put('/user/:id/status', AdminController.updateUserStatus);
router.post('/user/:id/reset-password', AdminController.resetUserPassword);

// Question Bank Operations
router.post('/questions', AdminController.createQuestion);
router.post('/questions/bulk-delete', AdminController.bulkDeleteQuestions);
router.post('/questions/delete-by-subject', AdminController.deleteQuestionsBySubject);
router.put('/questions/:id', AdminController.updateQuestion);
router.delete('/questions/:id', AdminController.deleteQuestion);
// Question extraction and Q-Papers registry for Admin
router.post('/upload-qpaper', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'answerFile', maxCount: 1 }
]), FacultyController.uploadQPaper);
router.get('/uploaded-qpapers', FacultyController.getUploadedQPapers);
router.get('/uploaded-qpapers/:id/questions', FacultyController.getQPaperQuestions);
router.delete('/uploaded-qpapers/:id', FacultyController.deleteUploadedQPaper);
router.post('/questions/generate-ai', FacultyController.generateAIQuestions);

export default router;
