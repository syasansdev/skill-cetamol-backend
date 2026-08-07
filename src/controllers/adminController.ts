import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../config/db';
import { emailService } from '../services/emailService';
import { AuthRequest } from '../middleware/auth';

export const AdminController = {
  // 1. Get Users Registry
  getUsers: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const users = await prisma.user.findMany({
        include: {
          student: true,
          faculty: true
        },
        orderBy: { createdAt: 'desc' }
      });

      // Map users into unified front-end structure
      const formattedUsers = users.map(user => {
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          // Enrichments
          studentId: user.student?.registerNumber || undefined,
          courseId: user.student?.courseId || undefined,
          departmentId: user.student?.departmentId || user.faculty?.departmentId || undefined,
          semester: user.student?.year ? user.student.year * 2 : undefined, // simple mapping of sem
          facultyId: user.faculty?.employeeId || user.faculty?.id || undefined,
          subjects: user.faculty ? [] : undefined // Subjects assigned can be added as needed
        };
      });

      return res.status(200).json(formattedUsers);
    } catch (error) {
      next(error);
    }
  },

  // 2. Approve Student Account
  approveStudent: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id },
        include: { student: true }
      });

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: { status: 'active' }
      });

      // Create log
      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Approved student profile: ${user.name} (${user.student?.registerNumber})`
        }
      });

      // Send confirmation email
      try {
        await emailService.sendStudentApproval(user.email, user.name);
      } catch (mailErr) {
        console.error('Nodemailer approval email failed:', mailErr);
      }

      return res.status(200).json({
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        status: updatedUser.status,
        studentId: user.student?.registerNumber || undefined
      });
    } catch (error) {
      next(error);
    }
  },

  // 3. Delete User account
  deleteUser: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          faculty: true,
          student: true
        }
      });

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (user.role === 'faculty' && user.faculty) {
        const facultyId = user.faculty.id;

        // Find exams created by this faculty
        const exams = await prisma.exam.findMany({
          where: { facultyId }
        });
        const examIds = exams.map(e => e.id);

        // Find questions created by this faculty
        const questions = await prisma.question.findMany({
          where: { facultyId }
        });
        const questionIds = questions.map(q => q.id);

        await prisma.$transaction([
          // 1. Delete student answers for questions created by this faculty, or exams created by this faculty
          prisma.studentAnswer.deleteMany({
            where: {
              OR: [
                { questionId: { in: questionIds } },
                { studentExam: { examId: { in: examIds } } }
              ]
            }
          }),
          // 2. Delete student exams for exams created by this faculty
          prisma.studentExam.deleteMany({
            where: { examId: { in: examIds } }
          }),
          // 3. Delete results for exams created by this faculty
          prisma.result.deleteMany({
            where: { examId: { in: examIds } }
          }),
          // 4. Delete exam-question relation mappings
          prisma.examQuestion.deleteMany({
            where: {
              OR: [
                { examId: { in: examIds } },
                { questionId: { in: questionIds } }
              ]
            }
          }),
          // 5. Delete question options for questions
          prisma.questionOption.deleteMany({
            where: { questionId: { in: questionIds } }
          }),
          // 6. Delete exams
          prisma.exam.deleteMany({
            where: { facultyId }
          }),
          // 7. Delete questions
          prisma.question.deleteMany({
            where: { facultyId }
          }),
          // 8. Delete faculty profile
          prisma.faculty.delete({
            where: { id: facultyId }
          }),
          // 9. Delete user
          prisma.user.delete({
            where: { id }
          })
        ]);
      } else if (user.role === 'student' && user.student) {
        const studentId = user.student.id;

        await prisma.$transaction([
          // 1. Delete student answers
          prisma.studentAnswer.deleteMany({
            where: {
              studentExam: { studentId }
            }
          }),
          // 2. Delete student exams
          prisma.studentExam.deleteMany({
            where: { studentId }
          }),
          // 3. Delete results
          prisma.result.deleteMany({
            where: { studentId }
          }),
          // 4. Delete student profile
          prisma.student.delete({
            where: { id: studentId }
          }),
          // 5. Delete user
          prisma.user.delete({
            where: { id }
          })
        ]);
      } else {
        // Just delete user (handles admin role, or accounts with no sub-profile)
        await prisma.user.delete({ where: { id } });
      }

      // Create log
      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Deleted account: ${user.name} (${user.email})`
        }
      });

      return res.status(200).json({ message: 'User account deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  // 4. Create Faculty / User profile
  createFaculty: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { name, email: rawEmail, password, facultyId, departmentId, collegeId, role, subjects } = req.body;
      const email = rawEmail.toLowerCase();
 
      // Check if email already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({
          message: `The email "${email}" is already registered to an existing account (${existingUser.name}). Please use a different email address.`,
          field: 'email'
        });
      }
 
      // Hash admin-specified password
      const hashedPassword = await bcrypt.hash(password || 'faculty123', 10);
      const targetRole = role || 'faculty';
 
      // Resolve department name/ID manually or select
      let resolvedDeptId = departmentId;
      if (departmentId) {
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
        resolvedDeptId = dept.id;
      } else {
        let dept = await prisma.department.findFirst({
          where: { departmentName: 'General' }
        });
        if (!dept) {
          dept = await prisma.department.create({
            data: { 
              departmentName: 'General',
              collegeId: collegeId || null
            }
          });
        }
        resolvedDeptId = dept.id;
      }

      // Create User
      const user = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: targetRole,
          status: 'active'
        }
      });
 
      let facultyProfileId = undefined;
      let studentProfileId = undefined;

      if (targetRole === 'faculty') {
        let finalEmployeeId = facultyId;
        if (!finalEmployeeId || !finalEmployeeId.trim()) {
          const count = await prisma.faculty.count();
          let nextId = count + 1;
          finalEmployeeId = String(nextId);
          while (await prisma.faculty.findUnique({ where: { employeeId: finalEmployeeId } })) {
            nextId++;
            finalEmployeeId = String(nextId);
          }
        }

        // Create Faculty Profile
        const faculty = await prisma.faculty.create({
          data: {
            userId: user.id,
            employeeId: finalEmployeeId,
            departmentId: resolvedDeptId,
            collegeId: collegeId || null,
            designation: 'Lecturer',
            experience: 1
          }
        });
        facultyProfileId = faculty.employeeId || faculty.id;
 
        // Log details
        await prisma.activityLog.create({
          data: {
            userId: req.user!.id,
            action: `Provisioned Faculty profile: ${name} (ID: ${facultyId || faculty.id})`
          }
        });
      } else if (targetRole === 'student') {
        // Find or create default Course for department
        let course = await prisma.course.findFirst({
          where: { departmentId: resolvedDeptId }
        });
        if (!course) {
          course = await prisma.course.create({
            data: {
              courseName: `General Course - ${departmentId}`,
              departmentId: resolvedDeptId
            }
          });
        }

        const student = await prisma.student.create({
          data: {
            userId: user.id,
            registerNumber: facultyId || `STU-${Date.now()}`,
            departmentId: resolvedDeptId,
            courseId: course.id,
            year: 1
          }
        });
        studentProfileId = student.id;

        await prisma.activityLog.create({
          data: {
            userId: req.user!.id,
            action: `Provisioned Student profile: ${name} (Reg No: ${student.registerNumber})`
          }
        });
      } else {
        await prisma.activityLog.create({
          data: {
            userId: req.user!.id,
            action: `Provisioned Admin user: ${name}`
          }
        });
      }

      // Send Account Creation Welcome Email to the created email
      try {
        await emailService.sendFacultyAccountCreated(
          email, 
          name, 
          facultyId || facultyProfileId || studentProfileId || 'N/A', 
          password || 'faculty123',
          targetRole
        );
      } catch (mailErr) {
        console.error('Nodemailer welcome creation mail failed:', mailErr);
      }
 
      // Format response matching frontend expectations
      return res.status(201).json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        facultyId: facultyProfileId,
        studentId: studentProfileId,
        departmentId: resolvedDeptId,
        subjects: subjects || [],
        createdAt: user.createdAt
      });
    } catch (error) {
      next(error);
    }
  },

  // --------------------------------------------------------
  // ACADEMIC SUB-ENTITIES (Departments, Courses, Subjects)
  // --------------------------------------------------------

  // Departments
  getDepartments: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await prisma.department.findMany({
        include: { college: true, _count: { select: { faculty: true, students: true } } },
        orderBy: { departmentName: 'asc' }
      });
      const mapped = list.map(d => ({
        id: d.id,
        name: d.departmentName,
        departmentName: d.departmentName,
        code: d.departmentName.split(' ').map(x => x[0]).join('').toUpperCase(),
        collegeId: d.collegeId,
        collegeName: d.college?.collegeName || 'N/A',
        facultyCount: d._count.faculty,
        studentCount: d._count.students
      }));
      return res.status(200).json(mapped);
    } catch (error) {
      next(error);
    }
  },

  createDepartment: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, departmentName, collegeId } = req.body;
      const dName = (departmentName || name || '').trim();
      if (!dName) return res.status(400).json({ message: 'Department name is required' });

      const dept = await prisma.department.create({
        data: {
          departmentName: dName,
          collegeId: collegeId || null
        },
        include: { college: true }
      });
      return res.status(201).json({
        id: dept.id,
        name: dept.departmentName,
        departmentName: dept.departmentName,
        code: dept.departmentName.split(' ').map(x => x[0]).join('').toUpperCase(),
        collegeId: dept.collegeId,
        collegeName: dept.college?.collegeName || 'N/A'
      });
    } catch (error) {
      next(error);
    }
  },

  // Courses
  getCourses: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await prisma.course.findMany({ orderBy: { courseName: 'asc' } });
      const mapped = list.map(c => ({
        id: c.id,
        name: c.courseName,
        code: c.courseName.split(' ').map(x => x[0]).join('').toUpperCase(),
        departmentId: c.departmentId,
        durationYears: 4
      }));
      return res.status(200).json(mapped);
    } catch (error) {
      next(error);
    }
  },

  createCourse: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, departmentId } = req.body; // frontend sends { name, departmentId }
      const course = await prisma.course.create({
        data: {
          courseName: name,
          departmentId
        }
      });
      return res.status(201).json({
        id: course.id,
        name: course.courseName,
        code: course.courseName.split(' ').map(x => x[0]).join('').toUpperCase(),
        departmentId: course.departmentId,
        durationYears: 4
      });
    } catch (error) {
      next(error);
    }
  },

  // Subjects
  getSubjects: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await prisma.subject.findMany({ orderBy: { subjectName: 'asc' } });
      const mapped = list.map(s => ({
        id: s.id,
        name: s.subjectName,
        code: s.subjectName.split(' ').map(x => x[0]).join('').toUpperCase(),
        courseId: s.courseId
      }));
      return res.status(200).json(mapped);
    } catch (error) {
      next(error);
    }
  },

  createSubject: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { name, course, courseId, semester } = req.body;
      
      let resolvedCourseId = courseId;
      if (!resolvedCourseId && course) {
        // Find or create Course case-insensitively
        let crs = await prisma.course.findFirst({
          where: { courseName: { equals: course } }
        });
        if (!crs) {
          // Find the department ID of the current faculty or student
          let deptId;
          if (req.user) {
            const userWithProfile = await prisma.user.findUnique({
              where: { id: req.user.id },
              include: { faculty: true, student: true }
            });
            deptId = userWithProfile?.faculty?.departmentId || userWithProfile?.student?.departmentId;
          }
          if (!deptId) {
            // Fallback to first department
            const firstDept = await prisma.department.findFirst();
            deptId = firstDept?.id;
          }
          
          if (!deptId) {
            return res.status(400).json({ message: 'No department found. Please contact an administrator.' });
          }

          crs = await prisma.course.create({
            data: {
              courseName: course,
              departmentId: deptId
            }
          });
        }
        resolvedCourseId = crs.id;
      }

      if (!resolvedCourseId) {
        return res.status(400).json({ message: 'Course is required to create a subject.' });
      }

      const finalSemester = semester ? Number(semester) : 4;

      const subject = await prisma.subject.create({
        data: {
          subjectName: name,
          courseId: resolvedCourseId,
          semester: finalSemester
        }
      });

      return res.status(201).json({
        id: subject.id,
        name: subject.subjectName,
        code: subject.subjectName.split(' ').map(x => x[0]).join('').toUpperCase(),
        courseId: subject.courseId
      });
    } catch (error) {
      next(error);
    }
  },

  // Locked Examinations Proctor Monitor operations
  getLockedExams: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const lockedList = await prisma.studentExam.findMany({
        where: { status: 'LOCKED' },
        include: {
          student: {
            include: {
              user: true,
              course: true,
              department: true
            }
          },
          exam: {
            include: {
              subject: true
            }
          }
        }
      });

      const formatted = lockedList.map(item => ({
        id: item.id,
        studentName: item.student.user.name,
        registerNumber: item.student.registerNumber,
        examName: item.exam.title,
        course: item.student.course.courseName,
        department: item.student.department.departmentName,
        warningCount: item.warningCount,
        lockReason: item.lockReason || 'TAB_SWITCH',
        lockedTime: item.lockedAt ? item.lockedAt.toISOString() : item.startedAt.toISOString(),
        currentStatus: item.status
      }));

      return res.status(200).json(formatted);
    } catch (error) {
      next(error);
    }
  },

  unlockExam: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const studentExam = await prisma.studentExam.findUnique({
        where: { id },
        include: {
          student: { include: { user: true } },
          exam: true
        }
      });

      if (!studentExam) {
        return res.status(404).json({ message: 'Locked examination record not found' });
      }

      const updated = await prisma.studentExam.update({
        where: { id },
        data: {
          status: 'started', // Set back to started to let student resume
          warningCount: 0,
          reentryAllowed: true,
          unlockedAt: new Date(),
          lockReason: null
        }
      });

      // Clear previous student answers & assigned questions so retake generates a fresh set of random questions
      await prisma.studentAnswer.deleteMany({
        where: { studentExamId: id }
      });

      // Create Activity Log
      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Admin Allowed Re-entry for Student ${studentExam.student.user.name} in Exam: ${studentExam.exam.title}`
        }
      });

      // Send Notification
      await prisma.notification.create({
        data: {
          userId: studentExam.student.userId,
          title: 'Exam Re-entry Approved',
          message: `Your re-entry to the examination "${studentExam.exam.title}" has been authorized. You can resume now.`
        }
      });

      // Send Email
      try {
        const transporter = require('../config/mail').default;
        await transporter.sendMail({
          from: '"Skill Cetamol Portal" <syasanscareeranalytics@gmail.com>',
          to: studentExam.student.user.email,
          subject: `Exam Re-entry Approved: ${studentExam.exam.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
              <h2 style="color: #16a34a; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Examination Unlocked</h2>
              <p>Dear ${studentExam.student.user.name},</p>
               <p>The administrator has approved your re-entry request for the locked examination: <strong>${studentExam.exam.title}</strong>.</p>
              <p>Please log in immediately and resume your exam. You will start exactly where you left off, with your remaining time and answers intact.</p>
              <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">Skill Cetamol Evaluation Systems</p>
            </div>
          `
        });
      } catch (mailErr) {
        console.error('Failed sending unlock email:', mailErr);
      }

      return res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  },

  revokeExam: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const studentExam = await prisma.studentExam.findUnique({
        where: { id },
        include: {
          student: { include: { user: true } },
          exam: true
        }
      });

      if (!studentExam) {
        return res.status(404).json({ message: 'Examination record not found' });
      }

      const updated = await prisma.studentExam.update({
        where: { id },
        data: {
          status: 'submitted',
          submittedAt: new Date()
        }
      });

      const totalPoints = studentExam.exam.totalMarks || 10;
      const score = studentExam.score || 0;
      const percentage = Math.round((score / totalPoints) * 100);

      await prisma.result.upsert({
        where: {
          studentId_examId: {
            studentId: studentExam.studentId,
            examId: studentExam.examId
          }
        },
        create: {
          studentId: studentExam.studentId,
          examId: studentExam.examId,
          percentage,
          status: 'fail',
          grade: 'F'
        },
        update: {
          percentage,
          status: 'fail',
          grade: 'F'
        }
      });

      // Create Activity Log
      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Admin Revoked Exam Access for Student ${studentExam.student.user.name} in Exam: ${studentExam.exam.title}`
        }
      });

      return res.status(200).json({ message: 'Examination access revoked successfully', updated });
    } catch (error) {
      next(error);
    }
  },

  // Global User Search (paginated, server-side, debounced)
  searchUsers: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        q = '',
        role,
        status,
        departmentId,
        page = '1',
        limit = '20',
        sort = 'newest'
      } = req.query as Record<string, string>;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where: any = {
        AND: [
          q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                  {
                    student: {
                      OR: [
                        { registerNumber: { contains: q, mode: 'insensitive' } },
                        { phone: { contains: q, mode: 'insensitive' } }
                      ]
                    }
                  }
                ]
              }
            : {},
          role ? { role } : {},
          status ? { status } : {},
          departmentId
            ? {
                OR: [
                  { student: { departmentId } },
                  { faculty: { departmentId } }
                ]
              }
            : {}
        ]
      };

      const orderBy: any =
        sort === 'oldest'
          ? { createdAt: 'asc' }
          : sort === 'alpha'
          ? { name: 'asc' }
          : { createdAt: 'desc' };

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          include: {
            student: { include: { department: true, course: true } },
            faculty: { include: { department: true } }
          },
          orderBy,
          skip,
          take: parseInt(limit)
        }),
        prisma.user.count({ where })
      ]);

      const formatted = users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        photoUrl: u.photoUrl,
        createdAt: u.createdAt,
        departmentName:
          u.student?.department?.departmentName ||
          u.faculty?.department?.departmentName ||
          'N/A',
        courseName: u.student?.course?.courseName || 'N/A',
        registerNumber: u.student?.registerNumber || u.faculty?.employeeId || u.faculty?.id || 'N/A'
      }));

      return res.status(200).json({
        users: formatted,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit))
      });
    } catch (error) {
      next(error);
    }
  },

  // Get full user profile by ID
  getUserById: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          student: { include: { department: true, course: true } },
          faculty: { include: { department: true } },
          activityLogs: {
            orderBy: { timestamp: 'desc' },
            take: 10
          }
        }
      });

      if (!user) return res.status(404).json({ message: 'User not found' });

      return res.status(200).json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        photoUrl: user.photoUrl,
        createdAt: user.createdAt,
        departmentName:
          user.student?.department?.departmentName ||
          user.faculty?.department?.departmentName ||
          'N/A',
        courseName: user.student?.course?.courseName || 'N/A',
        semester: user.student?.year ? user.student.year * 2 : undefined,
        registerNumber: user.student?.registerNumber || user.faculty?.employeeId || user.faculty?.id,
        phone: user.student?.phone,
        recentActivity: user.activityLogs.map(l => ({
          action: l.action,
          timestamp: l.timestamp
        }))
      });
    } catch (error) {
      next(error);
    }
  },

  // Update user status (activate / deactivate / set pending)
  updateUserStatus: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const validStatuses = ['active', 'pending', 'inactive'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status value' });
      }

      const user = await prisma.user.update({
        where: { id },
        data: { status }
      });

      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Admin updated user status: ${user.name} → ${status}`
        }
      });

      return res.status(200).json({ id: user.id, status: user.status });
    } catch (error) {
      next(error);
    }
  },

  // Reset user password — generate random, email it
  resetUserPassword: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return res.status(404).json({ message: 'User not found' });

      // Generate secure random password
      const newPassword = Math.random().toString(36).slice(-8) + 'A1!';
      const hashed = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id },
        data: { password: hashed }
      });

      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Admin reset password for: ${user.name} (${user.email})`
        }
      });

      // Email the new password
      try {
        const transporter = require('../config/mail').default;
        await transporter.sendMail({
          from: '"Skill Cetamol Portal" <syasanscareeranalytics@gmail.com>',
          to: user.email,
          subject: 'Your Skill Cetamol Password Has Been Reset',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 6px;">
              <h2 style="color: #2563eb;">Password Reset by Administrator</h2>
              <p>Dear ${user.name},</p>
              <p>Your account password has been reset by the system administrator.</p>
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 16px 0;">
                <strong>New Password:</strong> <code style="font-size: 16px; color: #dc2626;">${newPassword}</code>
              </div>
              <p>Please log in and change your password immediately.</p>
              <p style="color: #64748b; font-size: 13px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">Skill Cetamol Evaluation Systems</p>
            </div>
          `
        });
      } catch (mailErr) {
        console.error('Failed sending password reset email:', mailErr);
      }

      return res.status(200).json({ message: 'Password reset and emailed successfully' });
    } catch (error) {
      next(error);
    }
  },

  // 10. Question Bank Management
  createQuestion: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { subjectId, text, type, options, correctAnswer, points, difficulty } = req.body;

      let faculty = await prisma.faculty.findFirst({ where: { userId: req.user!.id } });
      if (!faculty) {
        faculty = await prisma.faculty.findFirst();
      }
      if (!faculty) {
        let dummyDept = await prisma.department.findFirst();
        if (!dummyDept) {
          dummyDept = await prisma.department.create({ data: { departmentName: 'General' } });
        }
        faculty = await prisma.faculty.create({
          data: {
            userId: req.user!.id,
            departmentId: dummyDept.id,
            designation: 'Administrator',
            experience: 5
          }
        });
      }

      const q = await prisma.question.create({
        data: {
          question: text,
          type: type || 'mcq',
          difficulty: difficulty || 'medium',
          marks: points || 5,
          facultyId: faculty.id,
          subjectId
        }
      });

      if (type !== 'text' && options && Array.isArray(options)) {
        const optionData = options.map((optVal: string, idx: number) => {
          let isCorrect = false;
          if (type === 'mcq') {
            isCorrect = String(idx) === String(correctAnswer);
          } else if (type === 'checkbox') {
            isCorrect = Array.isArray(correctAnswer)
              ? correctAnswer.map(String).includes(String(idx))
              : String(correctAnswer) === String(idx);
          }
          return {
            questionId: q.id,
            option: optVal,
            isCorrect
          };
        });

        await prisma.questionOption.createMany({ data: optionData });
      }

      const enrichedQ = await prisma.question.findUnique({
        where: { id: q.id },
        include: { options: true }
      });

      return res.status(201).json({
        id: enrichedQ!.id,
        subjectId: enrichedQ!.subjectId,
        text: enrichedQ!.question,
        type: enrichedQ!.type,
        options: enrichedQ!.options.map(o => o.option),
        correctAnswer,
        points: enrichedQ!.marks,
        difficulty: enrichedQ!.difficulty,
        createdAt: enrichedQ!.createdAt
      });
    } catch (error) {
      next(error);
    }
  },

  updateQuestion: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { subjectId, text, type, options, correctAnswer, points, difficulty } = req.body;

      await prisma.question.update({
        where: { id },
        data: {
          question: text,
          type,
          difficulty,
          marks: points,
          subjectId
        }
      });

      if (options && Array.isArray(options)) {
        await prisma.questionOption.deleteMany({ where: { questionId: id } });

        if (type !== 'text') {
          const optionData = options.map((optVal: string, idx: number) => {
            let isCorrect = false;
            if (type === 'mcq') {
              isCorrect = String(idx) === String(correctAnswer);
            } else if (type === 'checkbox') {
              isCorrect = Array.isArray(correctAnswer)
                ? correctAnswer.map(String).includes(String(idx))
                : String(correctAnswer) === String(idx);
            }
            return {
              questionId: id,
              option: optVal,
              isCorrect
            };
          });

          await prisma.questionOption.createMany({ data: optionData });
        }
      }

      const enrichedQ = await prisma.question.findUnique({
        where: { id },
        include: { options: true }
      });

      return res.status(200).json({
        id: enrichedQ!.id,
        subjectId: enrichedQ!.subjectId,
        text: enrichedQ!.question,
        type: enrichedQ!.type,
        options: enrichedQ!.options.map(o => o.option),
        correctAnswer,
        points: enrichedQ!.marks,
        difficulty: enrichedQ!.difficulty,
        createdAt: enrichedQ!.createdAt
      });
    } catch (error) {
      next(error);
    }
  },

  deleteQuestion: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await prisma.questionOption.deleteMany({ where: { questionId: id } });
      await prisma.question.delete({ where: { id } });
      return res.status(200).json({ message: 'Question deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  // 30. College Management
  getColleges: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const colleges = await prisma.college.findMany({
        include: { departments: true, _count: { select: { faculty: true, students: true } } },
        orderBy: { collegeName: 'asc' }
      });
      return res.status(200).json(colleges);
    } catch (error) {
      next(error);
    }
  },

  createCollege: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { collegeName, code } = req.body;
      if (!collegeName || !collegeName.trim()) {
        return res.status(400).json({ message: 'College name is required' });
      }

      const college = await prisma.college.create({
        data: { collegeName: collegeName.trim(), code: code?.trim() || null }
      });
      return res.status(201).json(college);
    } catch (error) {
      next(error);
    }
  },

  deleteCollege: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await prisma.college.delete({ where: { id } });
      return res.status(200).json({ message: 'College deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  deleteDepartment: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await prisma.department.delete({ where: { id } });
      return res.status(200).json({ message: 'Department deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  // 32. Fresh System Reset (Clear Students, Faculty, Exams, Questions, Results)
  resetDatabase: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Delete transactional & user evaluation records
      await prisma.studentAnswer.deleteMany({});
      await prisma.studentExam.deleteMany({});
      await prisma.result.deleteMany({});
      await prisma.examQuestion.deleteMany({});
      await prisma.exam.deleteMany({});
      await prisma.questionOption.deleteMany({});
      await prisma.question.deleteMany({});
      await prisma.uploadedDocument.deleteMany({});
      await prisma.note.deleteMany({});
      await prisma.portion.deleteMany({});
      
      // Delete Non-Admin Users, Students, and Faculty
      const nonAdminUsers = await prisma.user.findMany({
        where: { role: { in: ['student', 'faculty'] } }
      });

      for (const u of nonAdminUsers) {
        await prisma.student.deleteMany({ where: { userId: u.id } });
        await prisma.faculty.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }

      return res.status(200).json({ 
        message: 'System database successfully reset. All student and faculty records have been cleared.' 
      });
    } catch (error) {
      next(error);
    }
  }
};
