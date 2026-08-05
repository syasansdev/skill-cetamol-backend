import fs from 'fs';
import path from 'path';
import readline from 'readline';
import prisma from '../config/db';
import { randomUUID } from 'crypto';

export async function importGoogleDriveQuestions() {
  try {
    // 1. Check if Placement Training dept already exists (skip if already set up)
    const existingDept = await prisma.department.findUnique({
      where: { departmentName: 'Placement Training' }
    });
    
    if (existingDept) {
      // Also verify questions exist, not just the department
      const questionsCount = await prisma.question.count({
        where: { subject: { course: { departmentId: existingDept.id } } }
      });
      if (questionsCount > 0) {
        console.log(`Placement Training questions already imported (${questionsCount} questions found). Skipping.`);
        return;
      }
    }

    console.log('Placement Training questions not found or empty. Cleaning up old subjects to import fresh...');
    
    // Clean up any existing subjects to avoid duplicates or constraint errors
    await prisma.subject.deleteMany({
      where: { course: { courseName: 'Aptitude & Practice' } }
    });

    console.log('Starting Google Drive questions import script...');

    // Resolve my_subdb.sql path
    let sqlPath = path.join(__dirname, 'my_subdb.sql');
    if (!fs.existsSync(sqlPath)) {
      sqlPath = path.join(__dirname, '..', '..', 'src', 'utils', 'my_subdb.sql');
    }
    if (!fs.existsSync(sqlPath)) {
      sqlPath = path.join(__dirname, '..', 'src', 'utils', 'my_subdb.sql');
    }

    if (!fs.existsSync(sqlPath)) {
      console.error('SQL dump file my_subdb.sql not found at:', sqlPath);
      return;
    }

    console.log('Found SQL dump at:', sqlPath);

    // 2. Parse categories, passages, and questions from SQL file
    const fileStream = fs.createReadStream(sqlPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    const categoryMap = new Map<number, string>();
    const subCategoryMap = new Map<number, { categoryId: number; description: string }>();
    const passagesMap = new Map<number, { categoryId: number; text: string }>();
    
    const qbOptionsRaw: any[] = [];
    const passagesQuestionsRaw: any[] = [];

    let currentInsertTable = null;

    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.startsWith('INSERT INTO')) {
        const match = trimmed.match(/INSERT INTO\s+`?(\w+)`?/i);
        if (match) {
          currentInsertTable = match[1];
        }
      } else if (currentInsertTable && trimmed.startsWith('(')) {
        const tuple = parseSqlTuple(trimmed);
        
        if (currentInsertTable === 'category') {
          categoryMap.set(Number(tuple[0]), String(tuple[1]));
        } else if (currentInsertTable === 'sub_category') {
          subCategoryMap.set(Number(tuple[0]), {
            categoryId: Number(tuple[1]),
            description: String(tuple[2])
          });
        } else if (currentInsertTable === 'passages') {
          passagesMap.set(Number(tuple[0]), {
            categoryId: Number(tuple[1]), // this is sub_category_id
            text: String(tuple[3])
          });
        } else if (currentInsertTable === 'qb_options') {
          qbOptionsRaw.push(tuple);
        } else if (currentInsertTable === 'passages_questions') {
          passagesQuestionsRaw.push(tuple);
        }

        if (trimmed.endsWith(';')) {
          currentInsertTable = null;
        }
      }
    }

    console.log(`Parsed stats:
    Categories: ${categoryMap.size}
    Subcategories: ${subCategoryMap.size}
    Passages: ${passagesMap.size}
    QB Options (MCQ): ${qbOptionsRaw.length}
    Passage Questions: ${passagesQuestionsRaw.length}`);

    // 3. Create Department, Course, User, and Faculty in database
    console.log('Creating database records for Placement Training...');
    
    const dept = await prisma.department.upsert({
      where: { departmentName: 'Placement Training' },
      update: {},
      create: { departmentName: 'Placement Training' }
    });

    const course = await prisma.course.upsert({
      where: { courseName: 'Aptitude & Practice' },
      update: {},
      create: {
        courseName: 'Aptitude & Practice',
        departmentId: dept.id
      }
    });

    const email = 'placement.coordinator@exam.com';
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        name: 'Placement Coordinator',
        email,
        password: '$2b$10$R/9qfO6G77x9p.gC.sO32eYQG925x3m1gT26Ue75uG92K5x3m1gT2',
        role: 'faculty',
        status: 'active'
      }
    });

    const faculty = await prisma.faculty.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        departmentId: dept.id,
        designation: 'Coordinator',
        experience: 5
      }
    });

    // 4. Create Subjects for each Category
    console.log('Creating Subjects...');
    const subjectIdMap = new Map<number, string>();
    for (const [catId, catDesc] of categoryMap.entries()) {
      const subject = await prisma.subject.create({
        data: {
          subjectName: catDesc,
          courseId: course.id,
          semester: 1
        }
      });
      subjectIdMap.set(catId, subject.id);
    }

    // 5. Build questions and options list
    console.log('Building question models...');
    const questionsToCreate: any[] = [];
    const optionsToCreate: any[] = [];

    // Parse QB Options
    for (const tuple of qbOptionsRaw) {
      const qId = randomUUID();
      const subCatId = Number(tuple[1]);
      const diffLevel = Number(tuple[2]);
      const questionText = String(tuple[3]).trim();
      const facultyId = faculty.id;
      
      const subCat = subCategoryMap.get(subCatId);
      if (!subCat) continue;

      const subjectId = subjectIdMap.get(subCat.categoryId);
      if (!subjectId) continue;

      let difficulty = 'easy';
      if (diffLevel === 2) difficulty = 'medium';
      else if (diffLevel === 3) difficulty = 'hard';

      questionsToCreate.push({
        id: qId,
        question: questionText,
        type: 'mcq',
        difficulty,
        marks: 5,
        facultyId,
        subjectId,
        createdAt: new Date()
      });

      for (let i = 0; i < 5; i++) {
        const optionTextVal = tuple[4 + i];
        if (optionTextVal === null || optionTextVal === undefined || String(optionTextVal).trim() === '') {
          continue;
        }

        const isCorrect = Number(tuple[9 + i]) === 1;

        optionsToCreate.push({
          id: randomUUID(),
          questionId: qId,
          option: String(optionTextVal).trim(),
          isCorrect
        });
      }
    }

    // Parse Passage Questions
    for (const tuple of passagesQuestionsRaw) {
      const qId = randomUUID();
      const passageId = Number(tuple[1]);
      const rawQuestionText = String(tuple[2]).trim();
      const facultyId = faculty.id;
      
      const passage = passagesMap.get(passageId);
      if (!passage) continue;

      const subCat = subCategoryMap.get(passage.categoryId);
      if (!subCat) continue;

      const subjectId = subjectIdMap.get(subCat.categoryId);
      if (!subjectId) continue;

      const questionText = `[Passage: ${passage.text}]\n\n${rawQuestionText}`;

      questionsToCreate.push({
        id: qId,
        question: questionText,
        type: 'mcq',
        difficulty: 'medium',
        marks: 5,
        facultyId,
        subjectId,
        createdAt: new Date()
      });

      for (let i = 0; i < 5; i++) {
        const optionTextVal = tuple[3 + i];
        if (optionTextVal === null || optionTextVal === undefined || String(optionTextVal).trim() === '') {
          continue;
        }

        const isCorrect = Number(tuple[8 + i]) === 1;

        optionsToCreate.push({
          id: randomUUID(),
          questionId: qId,
          option: String(optionTextVal).trim(),
          isCorrect
        });
      }
    }

    console.log(`Prepared to insert ${questionsToCreate.length} questions and ${optionsToCreate.length} options...`);

    const chunkSize = 200;

    console.log('Inserting Questions in chunks...');
    for (let i = 0; i < questionsToCreate.length; i += chunkSize) {
      const chunk = questionsToCreate.slice(i, i + chunkSize);
      await prisma.question.createMany({
        data: chunk
      });
    }

    console.log('Inserting Question Options in chunks...');
    for (let i = 0; i < optionsToCreate.length; i += chunkSize) {
      const chunk = optionsToCreate.slice(i, i + chunkSize);
      await prisma.questionOption.createMany({
        data: chunk
      });
    }

    console.log('🎉 Google Drive questions import complete! Imported successfully.');

  } catch (err) {
    console.error('❌ Error importing Google Drive questions:', err);
  }
}

function parseSqlTuple(str: string): any[] {
  const values: any[] = [];
  let currentVal = '';
  let inString = false;
  let escape = false;
  
  let cleaned = str.trim();
  if (cleaned.startsWith('(')) cleaned = cleaned.substring(1);
  if (cleaned.endsWith(';')) cleaned = cleaned.substring(0, cleaned.length - 1);
  if (cleaned.endsWith(',')) cleaned = cleaned.substring(0, cleaned.length - 1);
  if (cleaned.endsWith(')')) cleaned = cleaned.substring(0, cleaned.length - 1);

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escape) {
      currentVal += char;
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === "'") {
      inString = !inString;
      continue;
    }
    if (char === ',' && !inString) {
      values.push(parseValueType(currentVal.trim()));
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  values.push(parseValueType(currentVal.trim()));
  return values;
}

function parseValueType(val: string): any {
  if (val === 'NULL' || val === 'null' || val === '') return null;
  const num = Number(val);
  if (val !== '' && !isNaN(num)) return num;
  return val;
}
