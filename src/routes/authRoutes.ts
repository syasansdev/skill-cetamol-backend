import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { validateBody } from '../middleware/validation';
import { loginSchema, registerSchema, updateProfileSchema } from '../validators';
import { authenticateToken } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Configure photo upload storage directory
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

router.post('/register', validateBody(registerSchema), AuthController.register);
router.post('/login', validateBody(loginSchema), AuthController.login);
router.post('/logout', AuthController.logout);
router.post('/forgot-password', AuthController.forgotPassword);
router.post('/reset-password', AuthController.resetPassword);
router.get('/me', authenticateToken, AuthController.me);
router.post('/magic-code', AuthController.requestMagicCode);
router.post('/login-magic', AuthController.loginWithMagicCode);
router.get('/academic-metadata', AuthController.getAcademicMetadata);

router.post('/upload-photo', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image file uploaded' });
  }
  try {
    const filePath = req.file.path;
    const fileBuffer = fs.readFileSync(filePath);
    const base64Str = fileBuffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64Str}`;
    
    // Delete the file from local storage to keep disk clean
    fs.unlinkSync(filePath);
    
    return res.status(200).json({ url: dataUri });
  } catch (err) {
    console.error('Error processing upload:', err);
    return res.status(500).json({ message: 'Error processing image' });
  }
});

// Authenticated: upload profile photo (returns URL) — used by Admin / Faculty
router.post('/upload-profile-photo', authenticateToken, upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No image file uploaded' });
  }
  try {
    const filePath = req.file.path;
    const fileBuffer = fs.readFileSync(filePath);
    const base64Str = fileBuffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64Str}`;
    
    // Delete the file from local storage to keep disk clean
    fs.unlinkSync(filePath);
    
    return res.status(200).json({ url: dataUri });
  } catch (err) {
    console.error('Error processing upload:', err);
    return res.status(500).json({ message: 'Error processing image' });
  }
});

// Authenticated: persist the photoUrl into the User record
router.put('/profile-photo', authenticateToken, AuthController.updateProfilePhoto);

// Authenticated: update name and/or password
router.put('/update-profile', authenticateToken, validateBody(updateProfileSchema), AuthController.updateProfile);

export default router;

