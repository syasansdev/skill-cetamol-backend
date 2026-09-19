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
          student: { include: { college: true, department: true, course: true } },
          faculty: { include: { college: true, department: true } }
        },
        orderBy: { createdAt: 'desc' }
      });

      const currentYear = new Date().getFullYear();

      // Map users into unified front-end structure
      const formattedUsers = users.map(user => {
        let academicYear: number | undefined = undefined;
        let batchStr: string | undefined = undefined;
        let calculatedSemester: number | undefined = undefined;

        if (user.student) {
          const storedYear = user.student.year;
          batchStr = user.student.batch || undefined;

          if (storedYear) {
            if (storedYear <= 4) {
              academicYear = storedYear;
              if (!batchStr) {
                const estStart = currentYear - (academicYear - 1);
                batchStr = `${estStart}-${estStart + 4}`;
              }
            } else {
              // Legacy: stored year was graduating calendar year (e.g. 2026)
              academicYear = Math.min(4, Math.max(1, 4 - (storedYear - currentYear)));
              if (!batchStr) {
                batchStr = `${storedYear - 4}-${storedYear}`;
              }
            }
            calculatedSemester = academicYear * 2;
          }
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          // Enrichments
          collegeId: user.student?.collegeId || user.faculty?.collegeId || undefined,
          collegeName: user.student?.college?.collegeName || user.faculty?.college?.collegeName || undefined,
          category: user.student?.category || undefined,
          studentId: user.student?.registerNumber || undefined,
          courseId: user.student?.courseId || undefined,
          departmentId: user.student?.departmentId || user.faculty?.departmentId || undefined,
          departmentName: user.student?.department?.departmentName || user.faculty?.department?.departmentName || undefined,
          year: academicYear,
          academicYear,
          batch: batchStr,
          semester: calculatedSemester,
          facultyId: user.faculty?.employeeId || user.faculty?.id || undefined,
          subjects: user.faculty ? [] : undefined
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
      const { name, email: rawEmail, password, facultyId, collegeId, role, departmentId } = req.body;
      const email = rawEmail.toLowerCase();

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({
          message: `The email "${email}" is already registered to an existing account (${existingUser.name}). Please use a different email address.`,
          field: 'email'
        });
      }

      const targetRole = role || 'faculty';
      let resolvedCollegeId: string | null = null;
      let resolvedDeptId: string | null = null;

      if (targetRole === 'faculty') {
        if (!collegeId) {
          return res.status(400).json({
            message: 'College selection is required to create a faculty account.',
            field: 'collegeId'
          });
        }

        const college = await prisma.college.findFirst({
          where: {
            OR: [
              { id: collegeId },
              { collegeName: { equals: collegeId, mode: 'insensitive' } }
            ]
          }
        });

        if (!college) {
          return res.status(400).json({
            message: 'The selected college does not exist in the database.',
            field: 'collegeId'
          });
        }

        // Check if a faculty account already exists for this college (One Faculty Per College)
        const existingFaculty = await prisma.faculty.findUnique({
          where: { collegeId: college.id },
          include: { user: true }
        });

        if (existingFaculty) {
          return res.status(400).json({
            message: 'A faculty account already exists for this college.',
            field: 'collegeId',
            existingFacultyName: existingFaculty.user?.name
          });
        }

        resolvedCollegeId = college.id;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password || 'faculty123', 10);

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

        // Create Faculty Profile (College-level, not department-level)
        const faculty = await prisma.faculty.create({
          data: {
            userId: user.id,
            employeeId: finalEmployeeId,
            collegeId: resolvedCollegeId,
            departmentId: null,
            designation: 'Faculty Member',
            experience: 1
          }
        });
        facultyProfileId = faculty.employeeId || faculty.id;

        // Log details
        await prisma.activityLog.create({
          data: {
            userId: req.user!.id,
            action: `Provisioned Faculty profile: ${name} for college ${collegeId}`
          }
        });
      } else if (targetRole === 'student') {
        let resolvedDept = null;
        if (departmentId) {
          resolvedDept = await prisma.department.findUnique({ where: { id: departmentId } });
        }
        if (!resolvedDept) {
          resolvedDept = await prisma.department.findFirst();
        }
        resolvedDeptId = resolvedDept ? resolvedDept.id : null;

        let course = null;
        if (resolvedDept) {
          course = await prisma.course.findFirst({
            where: { departmentId: resolvedDept.id }
          });
        }

        const student = await prisma.student.create({
          data: {
            userId: user.id,
            registerNumber: facultyId || `STU-${Date.now()}`,
            departmentId: resolvedDept ? resolvedDept.id : '',
            courseId: course?.id || null,
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
      let emailSent = false;
      let emailError: string | null = null;
      try {
        await emailService.sendFacultyAccountCreated(
          email, 
          name, 
          facultyId || facultyProfileId || studentProfileId || 'N/A', 
          password || 'faculty123',
          targetRole
        );
        emailSent = true;
      } catch (mailErr: any) {
        console.error('Nodemailer welcome creation mail failed:', mailErr);
        emailError = mailErr?.message || 'Failed to deliver welcome email';
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
        collegeId: resolvedCollegeId,
        collegeName: (await prisma.college.findUnique({ where: { id: resolvedCollegeId || '' } }))?.collegeName,
        departmentId: resolvedDeptId,
        password: password || 'faculty123',
        subjects: [],
        emailSent,
        emailError,
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
      const { collegeId, category } = req.query as { collegeId?: string; category?: string };
      const whereClause: any = {};
      if (collegeId) whereClause.collegeId = collegeId;
      if (category) whereClause.category = category;

      const list = await prisma.department.findMany({
        where: whereClause,
        include: { college: true, _count: { select: { faculty: true, students: true } } },
        orderBy: { departmentName: 'asc' }
      });
      const mapped = list.map(d => ({
        id: d.id,
        name: d.departmentName,
        departmentName: d.departmentName,
        category: d.category,
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
      const { name, departmentName, collegeId, category } = req.body;
      const dName = (departmentName || name || '').trim();
      if (!dName) return res.status(400).json({ message: 'Department name is required' });

      const dept = await prisma.department.create({
        data: {
          departmentName: dName,
          category: category || 'Engineering',
          collegeId: collegeId || null
        },
        include: { college: true }
      });
      return res.status(201).json({
        id: dept.id,
        name: dept.departmentName,
        departmentName: dept.departmentName,
        category: dept.category,
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
      const list = await prisma.subject.findMany({
        where: {
          NOT: {
            subjectName: { startsWith: 'Core Fundamentals -' }
          }
        },
        orderBy: { subjectName: 'asc' }
      });
      // Deduplicate subjects by subjectName
      const uniqueList = list.filter((s, idx, arr) =>
        arr.findIndex(item => item.subjectName.toLowerCase() === s.subjectName.toLowerCase()) === idx
      );
      const mapped = uniqueList.map(s => {
        // Clean acronym code (e.g. "Quantitative & Reasoning Aptitude" -> "QRA")
        const code = s.subjectName
          .replace(/&/g, '')
          .split(/\s+/)
          .filter(Boolean)
          .map(x => x[0])
          .join('')
          .toUpperCase();
        return {
          id: s.id,
          name: s.subjectName,
          code,
          courseId: s.courseId
        };
      });
      return res.status(200).json(mapped);
    } catch (error) {
      next(error);
    }
  },

  createSubject: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { name, course, courseId, semester } = req.body;
      const trimmedName = (name || '').trim();

      if (!trimmedName) {
        return res.status(400).json({ message: 'Topic / Subject name is required' });
      }

      // Check if subject already exists case-insensitively
      const existing = await prisma.subject.findFirst({
        where: {
          subjectName: {
            equals: trimmedName,
            mode: 'insensitive'
          }
        }
      });

      if (existing) {
        const code = existing.subjectName
          .replace(/&/g, '')
          .split(/\s+/)
          .filter(Boolean)
          .map(x => x[0])
          .join('')
          .toUpperCase();
        return res.status(200).json({
          id: existing.id,
          name: existing.subjectName,
          code,
          courseId: existing.courseId,
          alreadyExisted: true
        });
      }

      let resolvedCourseId = courseId;
      if (!resolvedCourseId) {
        if (course) {
          // Find or create Course case-insensitively
          let crs = await prisma.course.findFirst({
            where: { courseName: { equals: course, mode: 'insensitive' } }
          });
          if (!crs) {
            let deptId;
            if (req.user) {
              const userWithProfile = await prisma.user.findUnique({
                where: { id: req.user.id },
                include: { faculty: true, student: true }
              });
              deptId = userWithProfile?.faculty?.departmentId || userWithProfile?.student?.departmentId;
            }
            if (!deptId) {
              const firstDept = await prisma.department.findFirst();
              deptId = firstDept?.id;
            }
            if (!deptId) {
              const d = await prisma.department.create({
                data: { departmentName: 'Placement Training', collegeId: null }
              });
              deptId = d.id;
            }
            crs = await prisma.course.create({
              data: {
                courseName: course,
                departmentId: deptId
              }
            });
          }
          resolvedCourseId = crs.id;
        } else {
          // Prefer Aptitude & Practice for Question Bank topics
          let defaultCourse = await prisma.course.findFirst({
            where: { courseName: 'Aptitude & Practice' }
          });
          if (!defaultCourse) {
            defaultCourse = await prisma.course.findFirst({
              where: { courseName: 'General Course' }
            });
          }
          if (!defaultCourse) {
            let dept = await prisma.department.findFirst({
              where: { departmentName: { in: ['Placement Training', 'AML', 'General'] } }
            }) || await prisma.department.findFirst();
            if (!dept) {
              dept = await prisma.department.create({
                data: { departmentName: 'Placement Training', collegeId: null }
              });
            }
            defaultCourse = await prisma.course.create({
              data: {
                courseName: 'Aptitude & Practice',
                departmentId: dept.id
              }
            });
          }
          resolvedCourseId = defaultCourse.id;
        }
      }

      const finalSemester = semester ? Number(semester) : 1;

      const subject = await prisma.subject.create({
        data: {
          subjectName: trimmedName,
          courseId: resolvedCourseId,
          semester: finalSemester
        }
      });

      const code = subject.subjectName
        .replace(/&/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map(x => x[0])
        .join('')
        .toUpperCase();

      return res.status(201).json({
        id: subject.id,
        name: subject.subjectName,
        code,
        courseId: subject.courseId
      });
    } catch (error) {
      next(error);
    }
  },

  // Locked Examinations Proctor Monitor operations
  getLockedExams: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      let whereClause: any = { status: 'LOCKED' };
      if (req.user && req.user.role === 'faculty') {
        const faculty = await prisma.faculty.findUnique({
          where: { userId: req.user.id }
        });
        if (faculty) {
          whereClause = {
            status: 'LOCKED',
            OR: [
              { exam: { facultyId: faculty.id } },
              { exam: { collegeId: null } },
              ...(faculty.collegeId ? [{ exam: { collegeId: faculty.collegeId } }] : []),
              ...(faculty.departmentId ? [{ student: { departmentId: faculty.departmentId } }] : [])
            ]
          };
        }
      }

      const lockedList = await prisma.studentExam.findMany({
        where: whereClause,
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
        },
        orderBy: { lockedAt: 'desc' }
      });

      const formatted = lockedList.map(item => ({
        id: item.id,
        studentName: item.student.user.name,
        registerNumber: item.student.registerNumber,
        examName: item.exam.title,
        course: item.student.course?.courseName || 'N/A',
        department: item.student.department?.departmentName || 'N/A',
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

      // Keep previous student answers so they can resume their exam with answers intact as expected
      const actorRole = req.user?.role === 'faculty' ? 'Faculty Proctor' : 'Administrator';

      // Create Activity Log
      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `${actorRole} Allowed Re-entry for Student ${studentExam.student.user.name} in Exam: ${studentExam.exam.title}`
        }
      });

      // Send Notification
      await prisma.notification.create({
        data: {
          userId: studentExam.student.userId,
          title: 'Exam Re-entry Approved',
          message: `Your re-entry to the examination "${studentExam.exam.title}" has been authorized by your instructor/proctor. You can resume now.`
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
              <p>The ${actorRole.toLowerCase()} has approved your re-entry request for the locked examination: <strong>${studentExam.exam.title}</strong>.</p>
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
          score: 0,
          submittedAt: new Date()
        }
      });

      const totalPoints = studentExam.exam.totalMarks || 10;
      const percentage = 0;

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

      const actorRole = req.user?.role === 'faculty' ? 'Faculty Proctor' : 'Administrator';

      // Create Activity Log
      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `${actorRole} Revoked Exam Access for Student ${studentExam.student.user.name} in Exam: ${studentExam.exam.title}`
        }
      });

      await prisma.notification.create({
        data: {
          userId: studentExam.student.userId,
          title: 'Exam Terminated',
          message: `Your examination "${studentExam.exam.title}" was revoked due to repeated proctoring violations.`
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
            student: { include: { department: true, course: true, college: true } },
            faculty: { include: { department: true, college: true } }
          },
          orderBy,
          skip,
          take: parseInt(limit)
        }),
        prisma.user.count({ where })
      ]);

      const currentYear = new Date().getFullYear();

      const formatted = users.map(u => {
        let academicYear: number | undefined = undefined;
        let batchStr: string | undefined = undefined;
        let calculatedSemester: number | undefined = undefined;

        if (u.student) {
          const storedYear = u.student.year;
          batchStr = u.student.batch || undefined;

          if (storedYear) {
            if (storedYear <= 4) {
              academicYear = storedYear;
              if (!batchStr) {
                const estStart = currentYear - (academicYear - 1);
                batchStr = `${estStart}-${estStart + 4}`;
              }
            } else {
              academicYear = Math.min(4, Math.max(1, 4 - (storedYear - currentYear)));
              if (!batchStr) {
                batchStr = `${storedYear - 4}-${storedYear}`;
              }
            }
            calculatedSemester = academicYear * 2;
          }
        }

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          status: u.status,
          photoUrl: u.photoUrl,
          createdAt: u.createdAt,
          collegeName: u.student?.college?.collegeName || u.faculty?.college?.collegeName || 'N/A',
          category: u.student?.category || 'N/A',
          departmentName:
            u.student?.department?.departmentName ||
            u.faculty?.department?.departmentName ||
            'N/A',
          courseName: u.student?.course?.courseName || 'N/A',
          year: academicYear,
          academicYear,
          batch: batchStr,
          semester: calculatedSemester,
          registerNumber: u.student?.registerNumber || u.faculty?.employeeId || u.faculty?.id || 'N/A'
        };
      });

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
          student: { include: { department: true, course: true, college: true } },
          faculty: { include: { department: true, college: true } },
          activityLogs: {
            orderBy: { timestamp: 'desc' },
            take: 10
          }
        }
      });

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const currentYear = new Date().getFullYear();
      let academicYear: number | undefined = undefined;
      let batchStr: string | undefined = undefined;
      let calculatedSemester: number | undefined = undefined;

      if (user.student) {
        const storedYear = user.student.year;
        batchStr = user.student.batch || undefined;

        if (storedYear) {
          if (storedYear <= 4) {
            academicYear = storedYear;
            if (!batchStr) {
              const estStart = currentYear - (academicYear - 1);
              batchStr = `${estStart}-${estStart + 4}`;
            }
          } else {
            academicYear = Math.min(4, Math.max(1, 4 - (storedYear - currentYear)));
            if (!batchStr) {
              batchStr = `${storedYear - 4}-${storedYear}`;
            }
          }
          calculatedSemester = academicYear * 2;
        }
      }

      return res.status(200).json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        photoUrl: user.photoUrl,
        createdAt: user.createdAt,
        collegeName: user.student?.college?.collegeName || user.faculty?.college?.collegeName || 'N/A',
        category: user.student?.category || 'N/A',
        departmentName:
          user.student?.department?.departmentName ||
          user.faculty?.department?.departmentName ||
          'N/A',
        courseName: user.student?.course?.courseName || 'N/A',
        year: academicYear,
        academicYear,
        batch: batchStr,
        semester: calculatedSemester,
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
  },  // Reset user password — supports custom password, role-specific emails
  resetUserPassword: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { newPassword: customPassword, password: fallbackPassword } = req.body || {};

      const user = await prisma.user.findUnique({ 
        where: { id },
        include: { faculty: true, student: true }
      });
      if (!user) return res.status(404).json({ message: 'User not found' });

      // Generate or use custom password
      const chosenPassword = customPassword || fallbackPassword;
      const newPassword = chosenPassword && chosenPassword.trim() 
        ? chosenPassword.trim() 
        : (user.role === 'faculty' ? 'faculty123' : Math.random().toString(36).slice(-8) + 'A1!');
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
      let emailSent = false;
      let emailError: string | null = null;
      try {
        if (user.role === 'faculty') {
          await emailService.sendFacultyAccountCreated(
            user.email,
            user.name,
            user.faculty?.employeeId || user.faculty?.id || 'N/A',
            newPassword,
            user.role
          );
        } else {
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
        }
        emailSent = true;
      } catch (mailErr: any) {
        console.error('Failed sending password reset email:', mailErr);
        emailError = mailErr?.message || 'Email delivery failed';
      }

      return res.status(200).json({ 
        message: emailSent ? 'Password reset and emailed successfully' : 'Password updated, but email could not be delivered',
        newPassword,
        emailSent,
        emailError
      });
    } catch (error) {
      next(error);
    }
  },

  // Resend welcome email with credentials for faculty
  resendFacultyWelcome: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { password } = req.body || {};

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          faculty: { include: { college: true } }
        }
      });

      if (!user) return res.status(404).json({ message: 'User not found' });

      const finalPassword = password && password.trim() ? password.trim() : 'faculty123';
      const hashed = await bcrypt.hash(finalPassword, 10);

      await prisma.user.update({
        where: { id },
        data: { password: hashed }
      });

      let emailSent = false;
      let emailError: string | null = null;

      try {
        await emailService.sendFacultyAccountCreated(
          user.email,
          user.name,
          user.faculty?.employeeId || user.faculty?.id || 'N/A',
          finalPassword,
          user.role
        );
        emailSent = true;
      } catch (err: any) {
        console.error('Resend welcome email error:', err);
        emailError = err?.message || 'Failed to deliver welcome email';
      }

      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Resent welcome email for faculty: ${user.name} (${user.email})`
        }
      });

      return res.status(200).json({
        message: emailSent 
          ? `Welcome email sent successfully to ${user.email}.` 
          : `Credentials updated, but email delivery failed: ${emailError}. You can share the password manually.`,
        emailSent,
        emailError,
        password: finalPassword
      });
    } catch (error) {
      next(error);
    }
  },

  // 10. Question Bank Management
  createQuestion: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { subjectId, text, type, options, correctAnswer, points, difficulty, paperName } = req.body;

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

      // Resolve subject and default paperName
      const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
      const resolvedPaperName = paperName || subject?.subjectName || 'Question Bank Pool';

      const q = await prisma.question.create({
        data: {
          question: text,
          type: type || 'mcq',
          difficulty: difficulty || 'medium',
          marks: points || 5,
          facultyId: faculty.id,
          subjectId,
          paperName: resolvedPaperName
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
        include: { options: true, subject: true }
      });

      return res.status(201).json({
        id: enrichedQ!.id,
        subjectId: enrichedQ!.subjectId,
        subjectName: enrichedQ!.subject?.subjectName,
        paperName: enrichedQ!.paperName,
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
      const { subjectId, text, type, options, correctAnswer, points, difficulty, paperName } = req.body;

      const subject = subjectId ? await prisma.subject.findUnique({ where: { id: subjectId } }) : null;

      await prisma.question.update({
        where: { id },
        data: {
          question: text,
          type,
          difficulty,
          marks: points,
          subjectId: subjectId || undefined,
          paperName: paperName || (subject ? subject.subjectName : undefined)
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
        include: { options: true, subject: true }
      });

      return res.status(200).json({
        id: enrichedQ!.id,
        subjectId: enrichedQ!.subjectId,
        subjectName: enrichedQ!.subject?.subjectName,
        paperName: enrichedQ!.paperName,
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
        where: {
          NOT: [
            { collegeName: { contains: 'Demo Clg', mode: 'insensitive' } },
            { collegeName: { startsWith: 'Jeya Univ', mode: 'insensitive' } },
            { collegeName: { startsWith: 'Test', mode: 'insensitive' } }
          ]
        },
        include: {
          faculty: { include: { user: true } },
          departments: true,
          _count: { select: { students: true, departments: true } }
        },
        orderBy: { collegeName: 'asc' }
      });

      const formatted = colleges.map(c => ({
        id: c.id,
        collegeName: c.collegeName,
        code: c.code,
        createdAt: c.createdAt,
        faculty: c.faculty,
        facultyAssigned: c.faculty ? c.faculty.user.name : null,
        facultyEmail: c.faculty ? c.faculty.user.email : null,
        studentCount: c._count.students,
        departmentCount: c._count.departments,
        departments: c.departments
      }));

      return res.status(200).json(formatted);
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

      const studentCount = await prisma.student.count({ where: { collegeId: id } });
      const facultyCount = await prisma.faculty.count({ where: { collegeId: id } });
      const departmentCount = await prisma.department.count({ where: { collegeId: id } });

      if (studentCount > 0 || facultyCount > 0 || departmentCount > 0) {
        let relations = [];
        if (studentCount > 0) relations.push(`${studentCount} student(s)`);
        if (facultyCount > 0) relations.push(`${facultyCount} faculty member(s)`);
        if (departmentCount > 0) relations.push(`${departmentCount} department(s)`);
        return res.status(400).json({ 
          message: `Cannot delete college: it has linked ${relations.join(', ')}. Please remove or re-assign them first.` 
        });
      }

      await prisma.college.delete({ where: { id } });
      return res.status(200).json({ message: 'College deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  deleteDepartment: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const studentCount = await prisma.student.count({ where: { departmentId: id } });
      const facultyCount = await prisma.faculty.count({ where: { departmentId: id } });
      const courseCount = await prisma.course.count({ where: { departmentId: id } });

      if (studentCount > 0 || facultyCount > 0 || courseCount > 0) {
        let relations = [];
        if (studentCount > 0) relations.push(`${studentCount} student(s)`);
        if (facultyCount > 0) relations.push(`${facultyCount} faculty member(s)`);
        if (courseCount > 0) relations.push(`${courseCount} course(s)`);
        return res.status(400).json({ 
          message: `Cannot delete department: it has linked ${relations.join(', ')}. Please remove or re-assign them first.` 
        });
      }

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
