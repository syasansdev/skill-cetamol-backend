import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/db';
import { emailService } from '../services/emailService';
import { AuthRequest } from '../middleware/auth';

const formatPhotoUrl = (req: Request, url?: string | null) => {
  if (!url) return undefined;
  const uploadsIndex = url.indexOf('/uploads/');
  if (uploadsIndex !== -1) {
    const filename = url.substring(uploadsIndex + '/uploads/'.length);
    return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
  }
  return url;
};

export const AuthController = {
  // 1. User/Student Register
  register: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email: rawEmail, password, role, registerNumber, departmentId, collegeId, courseId, yearOfPassing } = req.body;
      const email = rawEmail.toLowerCase();

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ message: 'Email address already registered' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role,
          status: 'active', // Students are active on registration by default
          photoUrl: undefined
        }
      });

      // If student, create student profile
      if (role === 'student') {
        if (!departmentId) {
          return res.status(400).json({ message: 'Department is required for students' });
        }
        if (!registerNumber || !registerNumber.trim()) {
          return res.status(400).json({ message: 'Registration number is required for students' });
        }

        // Verify registration number uniqueness
        const existingStudent = await prisma.student.findUnique({
          where: { registerNumber }
        });
        if (existingStudent) {
          return res.status(400).json({ message: 'Registration number is already registered' });
        }

        // Verify department exists
        let dept = await prisma.department.findFirst({
          where: {
            OR: [
              { id: departmentId },
              { departmentName: { equals: departmentId } }
            ]
          }
        });
        if (!dept) {
          dept = await prisma.department.create({
            data: {
              departmentName: departmentId,
              collegeId: collegeId || null
            }
          });
        }

        let targetCourseId = courseId;
        if (!targetCourseId) {
          let crs = await prisma.course.findFirst({ where: { departmentId: dept.id } });
          if (!crs) {
            crs = await prisma.course.create({
              data: {
                courseName: `B.Tech - ${dept.departmentName}`,
                departmentId: dept.id
              }
            });
          }
          targetCourseId = crs.id;
        }

        await prisma.student.create({
          data: {
            userId: user.id,
            registerNumber,
            departmentId: dept.id,
            collegeId: collegeId || dept.collegeId || null,
            courseId: targetCourseId,
            year: Number(yearOfPassing || 1),
            phone: '',
            address: '',
            photoUrl: null
          }
        });

        // Trigger Notification to Admin
        const admins = await prisma.user.findMany({ where: { role: 'admin' } });
        for (const admin of admins) {
          await prisma.notification.create({
            data: {
              userId: admin.id,
              title: 'New Student Registration',
              message: `New student registration: ${name} (${registerNumber}) is now active.`
            }
          });
        }

        // Send Registration Welcome Email
        try {
          await emailService.sendStudentRegistration(email, name);
        } catch (emailErr) {
          console.error('Nodemailer failed:', emailErr);
        }
      }

      // Audit Log
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: `Account created - Role: ${role}, Status: ${user.status}`
        }
      });

      // Filter password from response
      const { password: _, ...userWithoutPassword } = user;

      return res.status(201).json({
        user: userWithoutPassword,
        message: role === 'student' 
          ? 'Successfully registered. You can now log in.'
          : 'Successfully registered.'
      });
    } catch (error) {
      next(error);
    }
  },

  // 2. Login
  login: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email: rawEmail, password } = req.body;
      const email = rawEmail.toLowerCase();

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          student: {
            include: {
              department: true,
              course: true
            }
          },
          faculty: {
            include: {
              department: true
            }
          }
        }
      });

      if (!user) {
        return res.status(401).json({ message: 'Email not registered. Please register first.' });
      }

      // Check account approval status
      if (user.status === 'pending') {
        return res.status(403).json({ message: 'Waiting for approval. Your account is pending administrator approval.' });
      }

      // Validate password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }

      // Generate token
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, status: user.status },
        process.env.JWT_SECRET || 'your_super_secret_jwt_key',
        { expiresIn: '24h' }
      );

      // Audit Log
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: `User logged in successfully`
        }
      });

      // Format user details matching frontend expectation
      const responseUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        photoUrl: formatPhotoUrl(req, user.photoUrl || user.student?.photoUrl),
        // Enrichments
        studentId: user.student?.registerNumber || undefined,
        courseId: user.student?.courseId || undefined,
        departmentId: user.student?.departmentId || user.faculty?.departmentId || undefined,
        department: user.student?.department?.departmentName || user.faculty?.department?.departmentName || undefined,
        course: user.student?.course?.courseName || undefined,
        semester: user.student ? 4 : undefined, // Seed standard semester index or calculate
        subjects: user.faculty ? (await prisma.question.findMany({
          where: { facultyId: user.faculty.id },
          select: { subjectId: true },
          distinct: ['subjectId']
        })).map(q => q.subjectId) : undefined
      };

      return res.status(200).json({ user: responseUser, token });
    } catch (error) {
      next(error);
    }
  },

  // 3. Logout
  logout: async (req: Request, res: Response, next: NextFunction) => {
    // Stateless JWT logout is handled in frontend, return success
    return res.status(200).json({ message: 'Logged out successfully' });
  },

  // 4. Forgot Password
  forgotPassword: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email: rawEmail } = req.body;
      const email = rawEmail.toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        // Return 200 to prevent user enumeration
        return res.status(200).json({ message: 'If the email exists, a password reset link has been dispatched.' });
      }

      if (user.role === 'student') {
        // Generate a 6-digit magic code for student password reset
        const magicCode = Math.floor(100000 + Math.random() * 900000).toString();
        const magicCodeExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        await prisma.user.update({
          where: { id: user.id },
          data: {
            magicCode,
            magicCodeExpires
          }
        });

        // Send Reset Password Code Email
        try {
          await emailService.sendStudentResetCodeEmail(email, user.name, magicCode);
        } catch (err) {
          console.error('Nodemailer error sending reset code:', err);
        }

        return res.status(200).json({
          message: 'A 6-digit password reset code has been sent to your email.',
          isStudent: true
        });
      }

      const resetToken = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET || 'your_super_secret_jwt_key',
        { expiresIn: '1h' }
      );

      // Send Reset Link Email
      try {
        await emailService.sendPasswordReset(email, user.name, resetToken);
      } catch (err) {
        console.error('Nodemailer error:', err);
      }

      return res.status(200).json({ message: 'If the email exists, a password reset link has been dispatched.' });
    } catch (error) {
      next(error);
    }
  },

  // 5. Reset Password
  resetPassword: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, password, email, code } = req.body;

      if (!password) {
        return res.status(400).json({ message: 'New password is required' });
      }

      let userId: string;

      if (token) {
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'your_super_secret_jwt_key') as { id: string };
        userId = payload.id;
      } else if (email && code) {
        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() }
        });

        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }

        if (!user.magicCode || !user.magicCodeExpires) {
          return res.status(400).json({ message: 'No reset code requested. Please request a new code.' });
        }

        if (user.magicCodeExpires.getTime() < Date.now()) {
          return res.status(400).json({ message: 'Reset code has expired. Please request a new code.' });
        }

        if (user.magicCode !== code) {
          return res.status(401).json({ message: 'Invalid reset code' });
        }

        userId = user.id;

        // Clear the magic code
        await prisma.user.update({
          where: { id: userId },
          data: {
            magicCode: null,
            magicCodeExpires: null
          }
        });
      } else {
        return res.status(400).json({ message: 'Token or Email + Code is required' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      });

      // Audit Log
      await prisma.activityLog.create({
        data: {
          userId,
          action: token ? 'Password reset successful using link' : 'Password reset successful using magic code'
        }
      });

      return res.status(200).json({ message: 'Password has been reset successfully' });
    } catch (error) {
      return res.status(400).json({ message: 'Password reset request is invalid or has expired' });
    }
  },

  // 6. Current User Me
  me: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          student: {
            include: {
              department: true,
              course: true
            }
          },
          faculty: {
            include: {
              department: true
            }
          }
        }
      });

      if (!user) {
        return res.status(404).json({ message: 'User profile not found' });
      }

      // Format response user details matching frontend expectation
      const responseUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        photoUrl: formatPhotoUrl(req, user.photoUrl || user.student?.photoUrl),
        // Enrichments
        studentId: user.student?.registerNumber || undefined,
        courseId: user.student?.courseId || undefined,
        departmentId: user.student?.departmentId || user.faculty?.departmentId || undefined,
        semester: user.student ? 4 : undefined,
        subjects: user.faculty ? (await prisma.question.findMany({
          where: { facultyId: user.faculty.id },
          select: { subjectId: true },
          distinct: ['subjectId']
        })).map(q => q.subjectId) : undefined
      };

      return res.status(200).json({ user: responseUser });
    } catch (error) {
      next(error);
    }
  },

  // 5. Request Magic Code
  requestMagicCode: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email: rawEmail } = req.body;
      const email = rawEmail.toLowerCase();

      const user = await prisma.user.findUnique({
        where: { email }
      });

      if (!user) {
        return res.status(404).json({ message: 'Email not registered. Please register first.' });
      }

      if (user.status === 'pending') {
        return res.status(403).json({ message: 'Waiting for approval. Your account is pending administrator approval.' });
      }

      // Generate a 6-digit magic code
      const magicCode = Math.floor(100000 + Math.random() * 900000).toString();
      const magicCodeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await prisma.user.update({
        where: { id: user.id },
        data: {
          magicCode,
          magicCodeExpires
        }
      });

      // Send Magic Code Email
      try {
        await emailService.sendMagicCodeEmail(user.email, user.name, magicCode);
      } catch (mailErr) {
        console.error('Failed to send magic code email:', mailErr);
      }

      // Log activity
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: `Requested magic code login`
        }
      });

      return res.status(200).json({ message: 'Magic code sent to your email address.' });
    } catch (error) {
      next(error);
    }
  },

  // 6. Login with Magic Code
  loginWithMagicCode: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email: rawEmail, magicCode } = req.body;
      const email = rawEmail.toLowerCase();

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          student: {
            include: {
              department: true,
              course: true
            }
          },
          faculty: {
            include: {
              department: true
            }
          }
        }
      });

      if (!user) {
        return res.status(401).json({ message: 'Email not registered. Please register first.' });
      }

      if (user.status === 'pending') {
        return res.status(403).json({ message: 'Waiting for approval. Your account is pending administrator approval.' });
      }

      if (!user.magicCode || !user.magicCodeExpires) {
        return res.status(400).json({ message: 'No magic code requested. Please request a new code.' });
      }

      if (user.magicCodeExpires.getTime() < Date.now()) {
        return res.status(400).json({ message: 'Magic code has expired. Please request a new code.' });
      }

      if (user.magicCode !== magicCode) {
        return res.status(401).json({ message: 'Invalid magic code' });
      }

      // Clear the magic code
      await prisma.user.update({
        where: { id: user.id },
        data: {
          magicCode: null,
          magicCodeExpires: null
        }
      });

      // Generate token
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, status: user.status },
        process.env.JWT_SECRET || 'your_super_secret_jwt_key',
        { expiresIn: '24h' }
      );

      // Audit Log
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: `User logged in successfully via magic code`
        }
      });

      // Format response user details matching frontend expectation
      const responseUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        photoUrl: formatPhotoUrl(req, user.photoUrl || user.student?.photoUrl),
        // Enrichments
        studentId: user.student?.registerNumber || undefined,
        courseId: user.student?.courseId || undefined,
        departmentId: user.student?.departmentId || user.faculty?.departmentId || undefined,
        department: user.student?.department?.departmentName || user.faculty?.department?.departmentName || undefined,
        course: user.student?.course?.courseName || undefined,
        semester: user.student ? 4 : undefined,
        subjects: user.faculty ? (await prisma.question.findMany({
          where: { facultyId: user.faculty.id },
          select: { subjectId: true },
          distinct: ['subjectId']
        })).map(q => q.subjectId) : undefined
      };

      return res.status(200).json({ token, user: responseUser });
    } catch (error) {
      next(error);
    }
  },

  // 8. Update Profile Photo (Admin / Faculty / Student)
  updateProfilePhoto: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }
      const { photoUrl } = req.body;
      if (!photoUrl) {
        return res.status(400).json({ message: 'photoUrl is required' });
      }

      await prisma.user.update({
        where: { id: req.user.id },
        data: { photoUrl }
      });

      if (req.user.role === 'student') {
        await prisma.student.update({
          where: { userId: req.user.id },
          data: { photoUrl }
        });
      }

      await prisma.activityLog.create({
        data: {
          userId: req.user.id,
          action: 'Profile photo updated'
        }
      });

      return res.status(200).json({ message: 'Profile photo updated successfully', photoUrl });
    } catch (error) {
      next(error);
    }
  },

  // 9. Update Profile Name and/or Password
  updateProfile: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }
      const { name, password } = req.body;
      
      const updateData: any = {};
      if (name) {
        updateData.name = name;
      }
      
      if (password && password.trim() !== '') {
        updateData.password = await bcrypt.hash(password, 10);
      }

      const updatedUser = await prisma.user.update({
        where: { id: req.user.id },
        data: updateData,
        include: {
          student: {
            include: {
              department: true,
              course: true
            }
          },
          faculty: {
            include: {
              department: true
            }
          }
        }
      });

      // Audit Log
      await prisma.activityLog.create({
        data: {
          userId: req.user.id,
          action: 'Profile details updated (name/password)'
        }
      });

      // Format response user details matching frontend expectation
      const responseUser = {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        status: updatedUser.status,
        createdAt: updatedUser.createdAt,
        photoUrl: formatPhotoUrl(req, updatedUser.photoUrl || updatedUser.student?.photoUrl),
        // Enrichments
        studentId: updatedUser.student?.registerNumber || undefined,
        courseId: updatedUser.student?.courseId || undefined,
        departmentId: updatedUser.student?.departmentId || updatedUser.faculty?.departmentId || undefined,
        department: updatedUser.student?.department?.departmentName || updatedUser.faculty?.department?.departmentName || undefined,
        course: updatedUser.student?.course?.courseName || undefined,
        semester: updatedUser.student ? 4 : undefined,
        subjects: updatedUser.faculty ? (await prisma.question.findMany({
          where: { facultyId: updatedUser.faculty.id },
          select: { subjectId: true },
          distinct: ['subjectId']
        })).map(q => q.subjectId) : undefined
      };

      return res.status(200).json({
        message: 'Profile updated successfully',
        user: responseUser
      });
    } catch (error) {
      next(error);
    }
  },

  // 10. Public Academic Metadata for Dropdowns (Colleges & Departments)
  getAcademicMetadata: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const colleges = await prisma.college.findMany({
        include: { departments: true },
        orderBy: { collegeName: 'asc' }
      });
      const departments = await prisma.department.findMany({
        include: { college: true },
        orderBy: { departmentName: 'asc' }
      });
      const courses = await prisma.course.findMany({
        orderBy: { courseName: 'asc' }
      });

      return res.status(200).json({ colleges, departments, courses });
    } catch (error) {
      next(error);
    }
  }
};
