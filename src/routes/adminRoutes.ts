import { Router } from 'express';
import { AdminController } from '../controllers/adminController';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { createFacultySchema } from '../validators';

const router = Router();

// Apply auth middleware to all admin endpoints
router.use(authenticateToken);

// Accessible by Admin and Faculty
router.get('/subjects', requireRole(['admin', 'faculty']), AdminController.getSubjects);
router.post('/subjects', requireRole(['admin', 'faculty']), AdminController.createSubject);

// College operations (accessible by admin and faculty)
router.get('/colleges', requireRole(['admin', 'faculty']), AdminController.getColleges);
router.post('/colleges', requireRole(['admin']), AdminController.createCollege);
router.delete('/colleges/:id', requireRole(['admin']), AdminController.deleteCollege);

// Department operations
router.get('/departments', requireRole(['admin', 'faculty']), AdminController.getDepartments);
router.post('/departments', requireRole(['admin', 'faculty']), AdminController.createDepartment);
router.delete('/departments/:id', requireRole(['admin']), AdminController.deleteDepartment);

// Course operations (accessible by admin and faculty)
router.get('/courses', requireRole(['admin', 'faculty']), AdminController.getCourses);
router.post('/courses', requireRole(['admin', 'faculty']), AdminController.createCourse);

router.use(requireRole(['admin']));

router.get('/users', AdminController.getUsers);
router.post('/users/:id/approve', AdminController.approveStudent);
router.delete('/users/:id', AdminController.deleteUser);
router.post('/faculty', validateBody(createFacultySchema), AdminController.createFaculty);
router.post('/reset-database', AdminController.resetDatabase);

// Subject operations

// Locked Examinations Proctor Monitor operations
router.get('/locked-exams', AdminController.getLockedExams);
router.put('/unlock-exam/:id', AdminController.unlockExam);
router.put('/revoke-exam/:id', AdminController.revokeExam);

// Global Search & User Management
router.get('/search-users', AdminController.searchUsers);
router.get('/user/:id', AdminController.getUserById);
router.put('/user/:id/status', AdminController.updateUserStatus);
router.post('/user/:id/reset-password', AdminController.resetUserPassword);

// Question Bank Operations
router.post('/questions', AdminController.createQuestion);
router.put('/questions/:id', AdminController.updateQuestion);
router.delete('/questions/:id', AdminController.deleteQuestion);

export default router;
