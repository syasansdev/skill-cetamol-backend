import { Router } from 'express';
import { SuperAdminAssessmentController } from '../controllers/superAdminAssessmentController';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = Router();

// Apply auth middleware to all central assessment endpoints
router.use(authenticateToken);

// Accessible by Admin and Faculty
router.get('/', requireRole(['admin', 'faculty']), SuperAdminAssessmentController.getCentralAssessments);

// Super Admin Management Actions
router.post('/', requireRole(['admin']), SuperAdminAssessmentController.createCentralAssessment);
router.put('/:id/publish', requireRole(['admin']), SuperAdminAssessmentController.publishAssessment);
router.get('/:examId/monitoring', requireRole(['admin']), SuperAdminAssessmentController.getCrossInstitutionMonitoring);

export default router;

