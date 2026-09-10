import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ── 1. Complete Colleges List (from specification) ───────────────────────────
const collegesData = [
  'Sathyabama University, Chennai',
  'SRM University, Chennai (Ramapuram & KKR)',
  'B.S Abdur Rahman Crescent University, Chennai',
  'Jeppiaar University, Chennai',
  'Vels University, Chennai',
  'Dhanalakshmi Srinivasan University, Mamandur | Samayapuram | Perambalur',
  'Dr.M.G.R.University, Chennai',
  'Kalasalingam University, Krishnankovil',
  'St.Joseph’s College of Engineering, OMR Chennai',
  'St.Joseph’s Institute of Technology, OMR Chennai',
  'Jeppiaar Engineering College, Chennai',
  'Jeppiaar Institute of Technology, Sriperumbudur',
  'Panimalar Engineering College, Chennai',
  'Sri Sairam Engineering College, Chennai',
  'Velammal Institute of Technology, Chennai',
  'Velammal College of Engineering and Technology, Madurai',
  'Mepco Schlenk Engineering College, Sivakasi',
  'Dhanalakshmi Srinivasan Engineering College, Perambalur',
  'Dhanalakshmi Srinivasan College of Engineering and Technology, Chennai',
  'Dhanalakshmi Srinivasan College of Engineering, Coimbatore',
  'Adiparasakthi Engineering College, Melmaruvathu',
  'Surya Engineering College Perundurai',
  'Excel Engineering College, Kumarapalayam',
  'Rajiv Gandhi College of Eng and Tech, Pondicherry',
  'Achariya College of Engineering Technology, Pondicherry',
  'Krishnasamy College of Engineering and Technology, Cuddalore',
  'TJS Engineering College, Tiruvallur',
  'K.L.N College of Engineering, Madurai',
  'P.S.R Engineering College, Sivakasi',
  'Er.Perumal Manimekalai College of Engineering, Hosur',
  'Pandian Saraswathi Yadav Engineering College, Sivagangai',
  'Renganayagi Varatharajan College of Eng, Sattur',
  'Tagore Institute of Engineering and Technology, Attur',
  'Mangayarkarasi Engineering College, Madurai',
  'Kamaraj College of Technology, Madurai',
  'Sri Vidya College of Engineering and Technology, Virudunagar',
  'Gnanam Business School, Tanjore',
  'Amity Global Business School, Chennai',
  'Lead B School, Palakkad',
  'Sairam School of Management, Chennai',
  'Madras School of Social Work, Chennai',
  'Dwarka Doss Goverdhan Doss Vaishnav College, Chennai',
  'Achariya Arts & Science College, Pondicherry',
  'E.S.Arts & Science College, Villupuram',
  'Peri Arts & Science College, Kanchipuram',
  'Theivanai Ammal College for Women, Villupuram',
  'Dhanalakshmi Srinivasan College of Arts & Science for Women, Perambalur',
  'Dhanalakshmi Srinivasan Arts & Science College, Mamallapuram'
];

// ── 2. Complete Engineering Courses List ─────────────────────────────────────
const engineeringDepartments = [
  'Aeronautical Engineering',
  'Aerospace Engineering',
  'Agricultural Engineering',
  'Automobile Engineering',
  'Biomedical Engineering',
  'Biotechnology',
  'Chemical Engineering',
  'Civil Engineering',
  'Computer Science and Engineering',
  'Computer Science and Business Systems',
  'Computer Science and Engineering (Artificial Intelligence)',
  'Computer Science and Engineering (Artificial Intelligence and Machine Learning)',
  'Computer Science and Engineering (Cyber Security)',
  'Computer Science and Engineering (Data Science)',
  'Computer Science and Engineering (Internet of Things)',
  'Information Technology',
  'Electrical and Electronics Engineering',
  'Electronics and Communication Engineering',
  'Electronics and Instrumentation Engineering',
  'Mechanical Engineering',
  'Mechatronics Engineering',
  'Robotics and Automation Engineering',
  'Artificial Intelligence and Data Science',
  'Artificial Intelligence and Machine Learning',
  'Data Science and Engineering',
  'Data Engineering',
  'Computer Engineering',
  'Software Engineering',
  'Cyber Security Engineering',
  'Internet of Things Engineering',
  'Cloud Computing Engineering',
  'Blockchain Engineering',
  'Full Stack Development',
  'Electronics and Computer Engineering',
  'Electronics and VLSI Design',
  'VLSI Design and Technology',
  'Embedded Systems Engineering',
  'Renewable Energy Engineering',
  'Electric Vehicle Technology',
  'Manufacturing Engineering',
  'Industrial Engineering',
  'Environmental Engineering',
  'Petroleum Engineering',
  'Mining Engineering',
  'Marine Engineering',
  'Naval Architecture',
  'Safety and Fire Engineering',
  'Quantum Computing Engineering',
  'Human-Computer Interaction Engineering',
  'Computer Graphics Engineering',
  'Game Technology Engineering'
];

// ── 3. Complete Arts & Science Courses List ───────────────────────────────────
const artsAndScienceDepartments = [
  // B.A.
  'B.A. Tamil',
  'B.A. English',
  'B.A. Hindi',
  'B.A. History',
  'B.A. Economics',
  'B.A. Political Science',
  'B.A. Sociology',
  'B.A. Psychology',
  'B.A. Journalism',
  'B.A. Visual Communication',
  'B.A. Tourism Management',
  'B.A. Fine Arts',
  'B.A. Music',
  'B.A. Dance',
  'B.A. Performing Arts',

  // B.Sc.
  'B.Sc. Mathematics',
  'B.Sc. Physics',
  'B.Sc. Chemistry',
  'B.Sc. Computer Science',
  'B.Sc. Information Technology',
  'B.Sc. Data Science',
  'B.Sc. Artificial Intelligence',
  'B.Sc. Artificial Intelligence and Machine Learning',
  'B.Sc. Cyber Security',
  'B.Sc. Cloud Computing',
  'B.Sc. Internet of Things',
  'B.Sc. Biotechnology',
  'B.Sc. Microbiology',
  'B.Sc. Biochemistry',
  'B.Sc. Psychology',
  'B.Sc. Forensic Science',
  'B.Sc. Food Technology',
  'B.Sc. Fashion Design',

  // B.Com.
  'B.Com. General',
  'B.Com. Honours',
  'B.Com. Accounting and Finance',
  'B.Com. Corporate Secretaryship',
  'B.Com. Corporate Accounting',
  'B.Com. Professional Accounting',
  'B.Com. Computer Applications',
  'B.Com. Banking and Insurance',
  'B.Com. Finance',
  'B.Com. FinTech',
  'B.Com. Business Analytics',
  'B.Com. Data Analytics',
  'B.Com. International Business',
  'B.Com. E-Commerce',
  'B.Com. Marketing',
  'B.Com. Taxation',

  // BBA
  'BBA General',
  'BBA Finance',
  'BBA Marketing',
  'BBA Human Resource Management',
  'BBA International Business',
  'BBA Business Analytics',
  'BBA Aviation Management',
  'BBA Hospital Management',
  'BBA Logistics and Supply Chain Management',

  // BCA
  'BCA General',
  'BCA Cloud Computing',
  'BCA Data Science',
  'BCA Artificial Intelligence',
  'BCA Cyber Security',

  // Other Courses
  'B.Des.',
  'B.Arch.',
  'B.Plan.',
  'B.F.A.',
  'B.Music',
  'B.P.Ed.',
  'B.Ed.',
  'B.El.Ed.',
  'B.A. LL.B.',
  'BBA LL.B.',
  'B.Com. LL.B.',
  'B.Sc. LL.B.',
  'LL.B.',
  'B.Lib.I.Sc.',
  'B.S.W.',
  'B.C.S.',
  'B.Voc.'
];

// Helper: determine what departments to configure for a college
function getConfiguredDepartmentsForCollege(collegeName: string): { name: string; category: 'Engineering' | 'Arts & Science' }[] {
  const lower = collegeName.toLowerCase();
  const configured: { name: string; category: 'Engineering' | 'Arts & Science' }[] = [];

  const isUniversity = lower.includes('university');
  const isArts = lower.includes('arts') || lower.includes('social work') || lower.includes('vaishnav') || lower.includes('women');
  const isBusinessSchool = lower.includes('business school') || lower.includes('school of management');
  const isEngineering = lower.includes('engineering') || lower.includes('technology') || isUniversity;

  // 1. Business Schools offer Arts & Science courses (BBA, B.Com, Analytics)
  if (isBusinessSchool) {
    const bizCourses = [
      'BBA General',
      'BBA Finance',
      'BBA Marketing',
      'BBA Business Analytics',
      'BBA International Business',
      'BBA Logistics and Supply Chain Management',
      'B.Com. General',
      'B.Com. Finance',
      'B.Com. Business Analytics',
      'B.Com. Accounting and Finance'
    ];
    bizCourses.forEach(name => configured.push({ name, category: 'Arts & Science' }));
    return configured;
  }

  // 2. Pure Arts & Science colleges
  if (isArts && !isUniversity) {
    // Determine a representative set for this specific Arts & Science college
    let artsSubset = [
      'B.Com. General',
      'BBA General',
      'BCA General',
      'B.Sc. Computer Science',
      'B.A. English',
      'B.Sc. Mathematics',
      'B.Sc. Physics',
      'B.Sc. Chemistry',
      'B.Com. Corporate Secretaryship',
      'B.Com. Accounting and Finance'
    ];

    if (lower.includes('dhanalakshmi srinivasan arts & science college, mamallapuram')) {
      // Specifically ensure test example items:
      artsSubset = [
        'B.Com. General',
        'BBA General',
        'BCA General',
        'B.Sc. Computer Science',
        'B.A. English',
        'B.Sc. Information Technology',
        'B.Com. Computer Applications',
        'B.A. Tamil'
      ];
    } else if (lower.includes('social work')) {
      artsSubset = [
        'B.S.W.',
        'B.A. Sociology',
        'B.A. Psychology',
        'B.Sc. Psychology',
        'BBA Human Resource Management',
        'B.A. Economics'
      ];
    } else if (lower.includes('women')) {
      artsSubset = [
        'B.Com. General',
        'B.Com. Accounting and Finance',
        'BBA General',
        'BCA General',
        'B.Sc. Computer Science',
        'B.Sc. Biotechnology',
        'B.Sc. Biochemistry',
        'B.Sc. Fashion Design',
        'B.A. English',
        'B.A. Tamil'
      ];
    } else {
      // General Arts & Science college
      artsSubset = [
        'B.Com. General',
        'B.Com. Honours',
        'B.Com. Computer Applications',
        'BBA General',
        'BCA General',
        'B.Sc. Computer Science',
        'B.Sc. Information Technology',
        'B.Sc. Mathematics',
        'B.A. English',
        'B.A. Economics'
      ];
    }

    artsSubset.forEach(name => configured.push({ name, category: 'Arts & Science' }));
    return configured;
  }

  // 3. Engineering Colleges (offer Engineering only)
  if (isEngineering && !isUniversity) {
    let engSubset = [
      'Computer Science and Engineering',
      'Information Technology',
      'Electronics and Communication Engineering',
      'Mechanical Engineering',
      'Civil Engineering',
      'Electrical and Electronics Engineering',
      'Artificial Intelligence and Data Science'
    ];

    if (lower.includes('jeppiaar engineering college')) {
      // Specifically include requirements example list
      engSubset = [
        'Computer Science and Engineering',
        'Information Technology',
        'Electronics and Communication Engineering',
        'Mechanical Engineering',
        'Civil Engineering',
        'Electrical and Electronics Engineering',
        'Artificial Intelligence and Data Science',
        'Biotechnology'
      ];
    } else if (lower.includes('sairam') || lower.includes('panimalar') || lower.includes('st.joseph')) {
      engSubset = [
        'Computer Science and Engineering',
        'Information Technology',
        'Electronics and Communication Engineering',
        'Electrical and Electronics Engineering',
        'Mechanical Engineering',
        'Civil Engineering',
        'Artificial Intelligence and Data Science',
        'Computer Science and Business Systems',
        'Robotics and Automation Engineering',
        'Chemical Engineering'
      ];
    } else if (lower.includes('technology')) {
      engSubset = [
        'Computer Science and Engineering',
        'Information Technology',
        'Electronics and Communication Engineering',
        'Artificial Intelligence and Machine Learning',
        'Data Science and Engineering',
        'Cyber Security Engineering',
        'Mechanical Engineering'
      ];
    }

    engSubset.forEach(name => configured.push({ name, category: 'Engineering' }));
    return configured;
  }

  // 4. Universities (Offer BOTH Engineering and Arts & Science)
  if (isUniversity) {
    const uniEng = [
      'Computer Science and Engineering',
      'Information Technology',
      'Electronics and Communication Engineering',
      'Electrical and Electronics Engineering',
      'Mechanical Engineering',
      'Civil Engineering',
      'Biomedical Engineering',
      'Biotechnology',
      'Aeronautical Engineering',
      'Aerospace Engineering',
      'Artificial Intelligence and Data Science',
      'Artificial Intelligence and Machine Learning',
      'Robotics and Automation Engineering'
    ];
    const uniArts = [
      'B.Com. General',
      'B.Com. Honours',
      'B.Com. Accounting and Finance',
      'BBA General',
      'BBA Business Analytics',
      'BCA General',
      'BCA Data Science',
      'B.Sc. Computer Science',
      'B.Sc. Information Technology',
      'B.Sc. Mathematics',
      'B.Sc. Physics',
      'B.Sc. Biotechnology',
      'B.A. English',
      'B.A. Journalism',
      'B.A. Visual Communication',
      'B.Des.',
      'B.Arch.'
    ];

    uniEng.forEach(name => configured.push({ name, category: 'Engineering' }));
    uniArts.forEach(name => configured.push({ name, category: 'Arts & Science' }));
    return configured;
  }

  // Fallback default
  configured.push(
    { name: 'Computer Science and Engineering', category: 'Engineering' },
    { name: 'Electronics and Communication Engineering', category: 'Engineering' },
    { name: 'B.Com. General', category: 'Arts & Science' }
  );
  return configured;
}

async function main() {
  console.log('🌱 Starting idempotent database seed...');

  // ── 1. Admin User ──────────────────────────────────────────────────────────
  const adminEmail = 'syasanscareeranalytics@gmail.com';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const adminHash = await bcrypt.hash('syasans123;!', 10);
    await prisma.user.create({
      data: {
        name: 'Administrator',
        email: adminEmail,
        password: adminHash,
        role: 'admin',
        status: 'active'
      }
    });
    console.log(`✅ Created Admin user (${adminEmail})`);
  } else {
    console.log(`ℹ️ Admin user already exists (${adminEmail})`);
  }

  // ── 2. Seed Colleges ───────────────────────────────────────────────────────
  console.log(`🏛️ Seeding ${collegesData.length} colleges...`);
  const collegeMap = new Map<string, string>(); // collegeName -> id

  for (const cName of collegesData) {
    const code = cName
      .split(/[\s,()|&]+/)
      .filter(w => w.length > 0 && !['and', 'of', 'for', 'the', '&'].includes(w.toLowerCase()))
      .map(w => w[0].toUpperCase())
      .slice(0, 6)
      .join('');

    const college = await prisma.college.upsert({
      where: { collegeName: cName },
      update: {},
      create: {
        collegeName: cName,
        code: code || 'COLL'
      }
    });
    collegeMap.set(cName, college.id);
  }
  console.log(`✅ Colleges seeded successfully.`);

  // ── 3. Seed College → Category → Department Relationships ──────────────────
  console.log('📚 Seeding College → Category → Department relationships...');
  let deptCount = 0;

  for (const cName of collegesData) {
    const collegeId = collegeMap.get(cName)!;
    const deptsToSeed = getConfiguredDepartmentsForCollege(cName);

    for (const d of deptsToSeed) {
      // Find or create department for this college
      let dept = await prisma.department.findFirst({
        where: {
          collegeId,
          departmentName: d.name
        }
      });

      if (!dept) {
        dept = await prisma.department.create({
          data: {
            collegeId,
            departmentName: d.name,
            category: d.category
          }
        });
        deptCount++;
      } else if (dept.category !== d.category) {
        // Update category if missing or different
        await prisma.department.update({
          where: { id: dept.id },
          data: { category: d.category }
        });
      }

      // Also ensure a default Course exists for this department so courseId relations work smoothly
      let course = await prisma.course.findFirst({
        where: { departmentId: dept.id }
      });
      if (!course) {
        const courseName = `${d.name} Program (${d.category === 'Engineering' ? 'B.E./B.Tech' : 'Undergraduate'}) - ${cName.substring(0, 15)}`;
        // Check if courseName exists
        const existingC = await prisma.course.findUnique({ where: { courseName } });
        if (!existingC) {
          course = await prisma.course.create({
            data: {
              courseName,
              departmentId: dept.id
            }
          });
        } else {
          course = existingC;
        }
      }
    }
  }

  console.log(`✅ Seed complete. Created/verified configured departments across all ${collegesData.length} colleges.`);
  console.log('   Admin login: syasanscareeranalytics@gmail.com  /  syasans123;!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
