import { Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { emailService } from '../services/emailService';

// Helper to parse CSV buffer safely, handling double-quotes
const parseCSV = (csvText: string): string[][] => {
  const result: string[][] = [];
  const lines = csvText.split(/\r?\n/);
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const row: string[] = [];
    let insideQuote = false;
    let entry = '';
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        row.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    row.push(entry.trim());
    result.push(row);
  }
  return result;
};

// Helper to check for email formats
const isValidEmail = (email: string) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const UploadController = {
  // 1. Bulk Student Upload
  uploadStudents: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'CSV File upload is required' });
      }

      const csvContent = req.file.buffer.toString('utf-8');
      const rows = parseCSV(csvContent);
      if (rows.length < 2) {
        return res.status(400).json({ message: 'Uploaded CSV is empty or has no data rows' });
      }

      const headers = rows[0].map(h => h.toLowerCase());
      const dataRows = rows.slice(1);

      const validationErrors: { row: number; errors: string[] }[] = [];
      const preview: any[] = [];
      let successfulImports = 0;
      let failedImports = 0;
      let duplicateRecords = 0;

      // Extract headers mapping indices
      const idxName = headers.indexOf('name');
      const idxEmail = headers.indexOf('email');
      const idxPassword = headers.indexOf('password');
      const idxRegisterNo = headers.indexOf('registernumber');
      const idxDeptId = headers.indexOf('departmentid');
      const idxCourseId = headers.indexOf('courseid');
      const idxYear = headers.indexOf('year');
      const idxPhone = headers.indexOf('phone');
      const idxAddress = headers.indexOf('address');

      const seenEmails = new Set<string>();
      const seenRegNos = new Set<string>();

      for (let i = 0; i < dataRows.length; i++) {
        const rowData = dataRows[i];
        const rowNum = i + 2; // 1-indexed plus header row
        const errors: string[] = [];

        // Check required indices
        if (idxName === -1 || idxEmail === -1 || idxPassword === -1 || idxRegisterNo === -1 || idxDeptId === -1 || idxCourseId === -1) {
          return res.status(400).json({ message: 'Missing required headers: name, email, password, registerNumber, departmentId, courseId' });
        }

        const name = rowData[idxName];
        const email = rowData[idxEmail];
        const password = rowData[idxPassword];
        const regNo = rowData[idxRegisterNo];
        const deptId = rowData[idxDeptId];
        const courseId = rowData[idxCourseId];
        const year = idxYear !== -1 ? parseInt(rowData[idxYear]) : 1;
        const phone = idxPhone !== -1 ? rowData[idxPhone] : '';
        const address = idxAddress !== -1 ? rowData[idxAddress] : '';

        // Validation checks
        if (!name) errors.push('Name is required');
        if (!email) {
          errors.push('Email is required');
        } else if (!isValidEmail(email)) {
          errors.push(`Invalid email format: ${email}`);
        }
        if (!password || password.length < 6) errors.push('Password must be at least 6 characters');
        if (!regNo) errors.push('Register number is required');
        if (!deptId) errors.push('Department ID is required');
        if (!courseId) errors.push('Course ID is required');

        // Check local duplicates in CSV
        if (email && seenEmails.has(email.toLowerCase())) {
          errors.push(`Duplicate email in CSV: ${email}`);
          duplicateRecords++;
        } else if (email) {
          seenEmails.add(email.toLowerCase());
        }

        if (regNo && seenRegNos.has(regNo.toLowerCase())) {
          errors.push(`Duplicate register number in CSV: ${regNo}`);
          duplicateRecords++;
        } else if (regNo) {
          seenRegNos.add(regNo.toLowerCase());
        }

        const previewItem = { name, email, regNo, deptId, courseId, year, phone, address };
        preview.push(previewItem);

        // Check DB duplicates
        if (errors.length === 0) {
          const dbUser = await prisma.user.findUnique({ where: { email } });
          if (dbUser) {
            errors.push(`Email already registered in system: ${email}`);
            duplicateRecords++;
          }
          const dbStudent = await prisma.student.findUnique({ where: { registerNumber: regNo } });
          if (dbStudent) {
            errors.push(`Register number already exists in system: ${regNo}`);
            duplicateRecords++;
          }

          // Check DB Foreign Keys
          const dbDept = await prisma.department.findUnique({ where: { id: deptId } });
          if (!dbDept) errors.push(`Invalid Department ID: ${deptId}`);
          
          const dbCourse = await prisma.course.findUnique({ where: { id: courseId } });
          if (!dbCourse) errors.push(`Invalid Course ID: ${courseId}`);
        }

        if (errors.length > 0) {
          validationErrors.push({ row: rowNum, errors });
          failedImports++;
        } else {
          // Import record to PostgreSQL
          const hashPassword = await bcrypt.hash(password, 10);
          const user = await prisma.user.create({
            data: {
              name,
              email,
              password: hashPassword,
              role: 'student',
              status: 'active' // bulk uploaded by admin are active
            }
          });

          await prisma.student.create({
            data: {
              userId: user.id,
              registerNumber: regNo,
              departmentId: deptId,
              courseId,
              year: year || 1,
              phone,
              address
            }
          });

          successfulImports++;
        }
      }

      // Log import activity
      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Bulk Imported Students from CSV. Succeeded: ${successfulImports}, Failed: ${failedImports}`
        }
      });

      return res.status(200).json({
        totalRecords: dataRows.length,
        successfulImports,
        failedImports,
        duplicateRecords,
        validationErrors,
        preview
      });
    } catch (error) {
      next(error);
    }
  },

  // 2. Bulk Faculty Upload
  uploadFaculty: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'CSV File upload is required' });
      }

      const csvContent = req.file.buffer.toString('utf-8');
      const rows = parseCSV(csvContent);
      if (rows.length < 2) {
        return res.status(400).json({ message: 'Uploaded CSV is empty or has no data rows' });
      }

      const headers = rows[0].map(h => h.toLowerCase());
      const dataRows = rows.slice(1);

      const validationErrors: { row: number; errors: string[] }[] = [];
      const preview: any[] = [];
      let successfulImports = 0;
      let failedImports = 0;
      let duplicateRecords = 0;

      const idxName = headers.indexOf('name');
      const idxEmail = headers.indexOf('email');
      const idxPassword = headers.indexOf('password');
      const idxDeptId = headers.indexOf('departmentid');
      const idxDesignation = headers.indexOf('designation');
      const idxExperience = headers.indexOf('experience');

      const seenEmails = new Set<string>();

      for (let i = 0; i < dataRows.length; i++) {
        const rowData = dataRows[i];
        const rowNum = i + 2;
        const errors: string[] = [];

        if (idxName === -1 || idxEmail === -1 || idxPassword === -1 || idxDeptId === -1) {
          return res.status(400).json({ message: 'Missing required headers: name, email, password, departmentId' });
        }

        const name = rowData[idxName];
        const email = rowData[idxEmail];
        const password = rowData[idxPassword];
        const deptId = rowData[idxDeptId];
        const designation = idxDesignation !== -1 ? rowData[idxDesignation] : 'Lecturer';
        const expYears = idxExperience !== -1 ? parseInt(rowData[idxExperience]) : 1;

        if (!name) errors.push('Name is required');
        if (!email) {
          errors.push('Email is required');
        } else if (!isValidEmail(email)) {
          errors.push(`Invalid email format: ${email}`);
        }
        if (!password || password.length < 6) errors.push('Password must be at least 6 characters');
        if (!deptId) errors.push('Department ID is required');

        if (email && seenEmails.has(email.toLowerCase())) {
          errors.push(`Duplicate email in CSV: ${email}`);
          duplicateRecords++;
        } else if (email) {
          seenEmails.add(email.toLowerCase());
        }

        preview.push({ name, email, deptId, designation, expYears });

        if (errors.length === 0) {
          const dbUser = await prisma.user.findUnique({ where: { email } });
          if (dbUser) {
            errors.push(`Email already registered: ${email}`);
            duplicateRecords++;
          }
          const dbDept = await prisma.department.findUnique({ where: { id: deptId } });
          if (!dbDept) errors.push(`Invalid Department ID: ${deptId}`);
        }

        if (errors.length > 0) {
          validationErrors.push({ row: rowNum, errors });
          failedImports++;
        } else {
          const hashPassword = await bcrypt.hash(password, 10);
          const user = await prisma.user.create({
            data: {
              name,
              email,
              password: hashPassword,
              role: 'faculty',
              status: 'active'
            }
          });

          const count = await prisma.faculty.count();
          let nextId = count + 1;
          let finalEmployeeId = String(nextId);
          while (await prisma.faculty.findUnique({ where: { employeeId: finalEmployeeId } })) {
            nextId++;
            finalEmployeeId = String(nextId);
          }

          const faculty = await prisma.faculty.create({
            data: {
              userId: user.id,
              employeeId: finalEmployeeId,
              departmentId: deptId,
              designation,
              experience: expYears || 1
            }
          });

          // Send welcome email to faculty
          try {
            await emailService.sendFacultyAccountCreated(email, name, faculty.employeeId || faculty.id, password, 'faculty');
          } catch (mailErr) {
            console.error(`[UploadController] Failed sending welcome email to ${email}:`, mailErr);
          }

          successfulImports++;
        }
      }

      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Bulk Imported Faculty from CSV. Succeeded: ${successfulImports}, Failed: ${failedImports}`
        }
      });

      return res.status(200).json({
        totalRecords: dataRows.length,
        successfulImports,
        failedImports,
        duplicateRecords,
        validationErrors,
        preview
      });
    } catch (error) {
      next(error);
    }
  },

  // 3. Bulk Questions Upload (Faculty)
  uploadQuestions: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'CSV/JSON File upload is required' });
      }

      const fileContent = req.file.buffer.toString('utf-8');
      let dataRows: any[] = [];
      let format = 'csv';

      if (req.file.originalname.endsWith('.json')) {
        format = 'json';
        try {
          dataRows = JSON.parse(fileContent);
        } catch (e) {
          return res.status(400).json({ message: 'Invalid JSON file content syntax' });
        }
      } else {
        // CSV Parsing
        const parsed = parseCSV(fileContent);
        if (parsed.length < 2) {
          return res.status(400).json({ message: 'Uploaded CSV is empty or has no data rows' });
        }
        const headers = parsed[0].map(h => h.toLowerCase().trim());
        const rawRows = parsed.slice(1);

        const idxQuest = headers.indexOf('question');
        const idxType = headers.indexOf('type');
        const idxDiff = headers.indexOf('difficulty');
        const idxMarks = headers.indexOf('marks');
        const idxSubId = headers.indexOf('subjectid');
        const idxOptions = headers.indexOf('options');
        const idxCorrect = headers.indexOf('correctanswer');

        if (idxQuest === -1 || idxType === -1 || idxSubId === -1 || idxCorrect === -1) {
          return res.status(400).json({ message: 'Missing required headers: question, type, subjectId, correctAnswer' });
        }

        dataRows = rawRows.map(row => ({
          question: row[idxQuest],
          type: row[idxType],
          difficulty: idxDiff !== -1 ? row[idxDiff] : 'medium',
          marks: idxMarks !== -1 ? parseInt(row[idxMarks]) : 5,
          subjectId: row[idxSubId],
          options: idxOptions !== -1 ? row[idxOptions].split('|') : [],
          correctAnswer: idxCorrect !== -1 ? row[idxCorrect] : ''
        }));
      }

      const faculty = await prisma.faculty.findUnique({
        where: { userId: req.user!.id }
      });

      if (!faculty) {
        return res.status(403).json({ message: 'Faculty profile not found' });
      }

      const validationErrors: { row: number; errors: string[] }[] = [];
      const preview: any[] = [];
      let successfulImports = 0;
      let failedImports = 0;
      let duplicateRecords = 0;

      for (let i = 0; i < dataRows.length; i++) {
        const item = dataRows[i];
        const rowNum = i + 2;
        const errors: string[] = [];

        const questionText = item.question || item.text;
        const type = item.type;
        const difficulty = item.difficulty || 'medium';
        const marks = parseInt(item.marks) || 5;
        const subjectId = item.subjectId;
        const options = Array.isArray(item.options) ? item.options : (item.options ? String(item.options).split('|') : []);
        const correctAnswer = item.correctAnswer;

        if (!questionText) errors.push('Question content is required');
        if (!type || !['mcq', 'checkbox', 'text'].includes(type)) errors.push('Invalid or missing question type (must be: mcq, checkbox, text)');
        if (!subjectId) errors.push('Subject ID is required');

        if (type !== 'text') {
          if (!options || options.length < 2) errors.push('MCQ/Checkbox questions require at least 2 options');
          if (correctAnswer === undefined || correctAnswer === '') errors.push('Correct answer identifier is required');
        }

        preview.push({ questionText, type, difficulty, marks, subjectId, options });

        if (errors.length === 0) {
          // Check DB Foreign Key
          const dbSubject = await prisma.subject.findUnique({ where: { id: subjectId } });
          if (!dbSubject) errors.push(`Invalid Subject ID: ${subjectId}`);
        }

        if (errors.length > 0) {
          validationErrors.push({ row: rowNum, errors });
          failedImports++;
        } else {
          // Insert Question
          const paperName = req.body.paperName || 'Uploaded Question Set';
          const q = await prisma.question.create({
            data: {
              question: questionText,
              type,
              difficulty,
              marks,
              facultyId: faculty.id,
              subjectId,
              departmentId: faculty.departmentId,
              paperName
            }
          });

          // Insert options
          if (type !== 'text' && options && options.length > 0) {
            const optionData = options.map((optVal: string, idx: number) => {
              let isCorrect = false;
              if (type === 'mcq') {
                isCorrect = String(idx) === String(correctAnswer);
              } else if (type === 'checkbox') {
                const correctIndices = Array.isArray(correctAnswer) 
                  ? correctAnswer.map(String)
                  : String(correctAnswer).split(',');
                isCorrect = correctIndices.includes(String(idx));
              }
              return {
                questionId: q.id,
                option: optVal,
                isCorrect
              };
            });
            await prisma.questionOption.createMany({ data: optionData });
          }

          successfulImports++;
        }
      }

      await prisma.activityLog.create({
        data: {
          userId: req.user!.id,
          action: `Bulk Imported Questions from ${format.toUpperCase()}. Succeeded: ${successfulImports}, Failed: ${failedImports}`
        }
      });

      return res.status(200).json({
        totalRecords: dataRows.length,
        successfulImports,
        failedImports,
        duplicateRecords,
        validationErrors,
        preview
      });
    } catch (error) {
      next(error);
    }
  },

  // 4. Bulk Departments Upload
  uploadDepartments: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'File is required' });
      const csv = req.file.buffer.toString('utf-8');
      const rows = parseCSV(csv);
      if (rows.length < 2) return res.status(400).json({ message: 'CSV is empty' });

      const headers = rows[0].map(h => h.toLowerCase());
      const dataRows = rows.slice(1);
      const idxName = headers.indexOf('departmentname');

      if (idxName === -1) return res.status(400).json({ message: 'Missing header: departmentName' });

      const validationErrors: { row: number; errors: string[] }[] = [];
      const preview: any[] = [];
      let successfulImports = 0;
      let failedImports = 0;
      let duplicateRecords = 0;

      for (let i = 0; i < dataRows.length; i++) {
        const name = dataRows[i][idxName];
        const rowNum = i + 2;
        const errors: string[] = [];

        if (!name) errors.push('Department name is required');
        preview.push({ name });

        if (errors.length === 0) {
          const dbDept = await prisma.department.findUnique({ where: { departmentName: name } });
          if (dbDept) {
            errors.push(`Department already exists: ${name}`);
            duplicateRecords++;
          }
        }

        if (errors.length > 0) {
          validationErrors.push({ row: rowNum, errors });
          failedImports++;
        } else {
          await prisma.department.create({ data: { departmentName: name } });
          successfulImports++;
        }
      }

      return res.status(200).json({
        totalRecords: dataRows.length,
        successfulImports,
        failedImports,
        duplicateRecords,
        validationErrors,
        preview
      });
    } catch (error) {
      next(error);
    }
  },

  // 5. Bulk Courses Upload
  uploadCourses: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'File is required' });
      const csv = req.file.buffer.toString('utf-8');
      const rows = parseCSV(csv);
      if (rows.length < 2) return res.status(400).json({ message: 'CSV is empty' });

      const headers = rows[0].map(h => h.toLowerCase());
      const dataRows = rows.slice(1);
      const idxName = headers.indexOf('coursename');
      const idxDeptId = headers.indexOf('departmentid');

      if (idxName === -1 || idxDeptId === -1) {
        return res.status(400).json({ message: 'Missing headers: courseName, departmentId' });
      }

      const validationErrors: { row: number; errors: string[] }[] = [];
      const preview: any[] = [];
      let successfulImports = 0;
      let failedImports = 0;
      let duplicateRecords = 0;

      for (let i = 0; i < dataRows.length; i++) {
        const name = dataRows[i][idxName];
        const deptId = dataRows[i][idxDeptId];
        const rowNum = i + 2;
        const errors: string[] = [];

        if (!name) errors.push('Course name is required');
        if (!deptId) errors.push('Department ID is required');
        preview.push({ name, deptId });

        if (errors.length === 0) {
          const dbCourse = await prisma.course.findUnique({ where: { courseName: name } });
          if (dbCourse) {
            errors.push(`Course already exists: ${name}`);
            duplicateRecords++;
          }
          const dbDept = await prisma.department.findUnique({ where: { id: deptId } });
          if (!dbDept) errors.push(`Invalid Department ID: ${deptId}`);
        }

        if (errors.length > 0) {
          validationErrors.push({ row: rowNum, errors });
          failedImports++;
        } else {
          await prisma.course.create({ data: { courseName: name, departmentId: deptId } });
          successfulImports++;
        }
      }

      return res.status(200).json({
        totalRecords: dataRows.length,
        successfulImports,
        failedImports,
        duplicateRecords,
        validationErrors,
        preview
      });
    } catch (error) {
      next(error);
    }
  },

  // 6. Bulk Subjects Upload
  uploadSubjects: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'File is required' });
      const csv = req.file.buffer.toString('utf-8');
      const rows = parseCSV(csv);
      if (rows.length < 2) return res.status(400).json({ message: 'CSV is empty' });

      const headers = rows[0].map(h => h.toLowerCase());
      const dataRows = rows.slice(1);
      const idxName = headers.indexOf('subjectname');
      const idxCourseId = headers.indexOf('courseid');
      const idxSem = headers.indexOf('semester');

      if (idxName === -1 || idxCourseId === -1) {
        return res.status(400).json({ message: 'Missing headers: subjectName, courseId' });
      }

      const validationErrors: { row: number; errors: string[] }[] = [];
      const preview: any[] = [];
      let successfulImports = 0;
      let failedImports = 0;
      let duplicateRecords = 0;

      for (let i = 0; i < dataRows.length; i++) {
        const name = dataRows[i][idxName];
        const courseId = dataRows[i][idxCourseId];
        const semester = idxSem !== -1 ? parseInt(dataRows[i][idxSem]) : 1;
        const rowNum = i + 2;
        const errors: string[] = [];

        if (!name) errors.push('Subject name is required');
        if (!courseId) errors.push('Course ID is required');
        preview.push({ name, courseId, semester });

        if (errors.length === 0) {
          const dbCourse = await prisma.course.findUnique({ where: { id: courseId } });
          if (!dbCourse) errors.push(`Invalid Course ID: ${courseId}`);
        }

        if (errors.length > 0) {
          validationErrors.push({ row: rowNum, errors });
          failedImports++;
        } else {
          await prisma.subject.create({
            data: {
              subjectName: name,
              courseId,
              semester: semester || 1
            }
          });
          successfulImports++;
        }
      }

      return res.status(200).json({
        totalRecords: dataRows.length,
        successfulImports,
        failedImports,
        duplicateRecords,
        validationErrors,
        preview
      });
    } catch (error) {
      next(error);
    }
  }
};
