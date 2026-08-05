import { Router } from 'express';
import { AdminController } from '../controllers/adminController';

const router = Router();

// Publicly accessible endpoints for student registration dropdowns
router.get('/departments', AdminController.getDepartments);
router.get('/courses', AdminController.getCourses);

export default router;
