import prisma from '../config/db';
import { randomUUID } from 'crypto';

export const CANONICAL_SUBJECTS = [
  'Quantitative & Reasoning Aptitude',
  'Verbal Ability',
  'Diagnostic Test',
  'Post Training Assessment',
  'Advanced Computing',
  'Psychometric Test',
  'Guesstimates',
  'Puzzles',
  'Advanced Aptitude',
  'Foundation Aptitude',
  'Programming Languages',
  'Company Specific Aptitude Assessment'
] as const;

export async function setup12SubjectsAndCategorize() {
  console.log('=== STARTING 12 SUBJECTS SETUP & QUESTION CATEGORIZATION ===');

  // 1. Resolve Department and Course
  let dept = await prisma.department.findFirst({
    where: { departmentName: 'Placement Training' }
  });
  if (!dept) {
    dept = await prisma.department.create({
      data: { departmentName: 'Placement Training', category: 'Engineering' }
    });
  }

  let course = await prisma.course.findFirst({
    where: { courseName: 'Aptitude & Practice' }
  });
  if (!course) {
    course = await prisma.course.create({
      data: {
        courseName: 'Aptitude & Practice',
        departmentId: dept.id
      }
    });
  }

  // 2. Ensure each of the 12 subjects exists under this Course
  const subjectMap = new Map<string, string>(); // name -> id
  for (let i = 0; i < CANONICAL_SUBJECTS.length; i++) {
    const sName = CANONICAL_SUBJECTS[i];
    let sub = await prisma.subject.findFirst({
      where: {
        subjectName: sName
      }
    });

    if (!sub) {
      sub = await prisma.subject.create({
        data: {
          subjectName: sName,
          courseId: course.id,
          semester: 1
        }
      });
      console.log(`[Created Subject] "${sName}" -> ${sub.id}`);
    } else {
      console.log(`[Existing Subject] "${sName}" -> ${sub.id}`);
    }
    subjectMap.set(sName, sub.id);
  }

  // 3. Find default faculty for any newly seeded questions
  let faculty = await prisma.faculty.findFirst({
    where: { user: { role: 'admin' } }
  });
  if (!faculty) {
    faculty = await prisma.faculty.findFirst();
  }
  if (!faculty) {
    const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (adminUser) {
      faculty = await prisma.faculty.create({
        data: {
          userId: adminUser.id,
          departmentId: dept.id,
          designation: 'Administrator & Faculty',
          experience: 5
        }
      });
    }
  }

  // 4. Fetch all existing questions in database
  const allQuestions = await prisma.question.findMany({
    select: {
      id: true,
      question: true,
      paperName: true,
      difficulty: true,
      marks: true,
      subjectId: true,
      subject: {
        select: {
          subjectName: true
        }
      }
    }
  });

  console.log(`Analyzing and categorizing ${allQuestions.length} questions into 12 subjects...`);

  const progRegex = /\b(int\s+[a-zA-Z_]|void\s+[a-zA-Z_]|printf|scanf|cout|cin|#include|<stdio\.h>|class\s+[a-zA-Z_]|public\s+static\s+void|def\s+[a-zA-Z_]|SELECT\s+.*FROM|UPDATE\s+.*SET|pointer|malloc|recursion|polymorphism|inheritance|data structure|binary search tree|linked list|stack\s+and\s+queue)\b/i;
  const puzzleRegex = /\b(seating arrangement|circular table|facing (north|south|east|west|center)|blood relation|mother'?s brother|father'?s sister|brother-in-law|sister-in-law|direction sense|walks \d+ (meters|km)|turns to (his|her) (left|right)|floor puzzle|ranking from (top|bottom|left|right)|cube painted|dice opposite face|angle between hour and minute)\b/i;
  const verbalRegex = /\b(synonym|antonym|nearest in meaning|opposite in meaning|fill in the blank|sentence correction|grammatical error|idiom|phrase|analogy|analogous|reading comprehension|passage given below|spelling of the word)\b/i;
  const guesstimateRegex = /\b(guesstimate|market size|estimate the number of|approximate market|how many (cars|flights|smartphones|cups of coffee|refrigerators|airports)|fermi problem|rough estimation)\b/i;
  const psychometricRegex = /\b(strongly agree|strongly disagree|in a situation where|your manager asks|conflict with|work under pressure|ethical dilemma|team member fails|workplace scenario|behavioral|personality trait)\b/i;

  const targetUpdates: { id: string; targetSubjectId: string }[] = [];

  for (const q of allQuestions) {
    const currentSubName = q.subject?.subjectName;
    // If the question belongs to a custom topic created by admin/faculty, preserve it!
    if (currentSubName && !CANONICAL_SUBJECTS.includes(currentSubName as any)) {
      const isLegacyDummy = ['aml examination eec course', 'eec course', 'demo', 'aptitude'].includes(currentSubName.toLowerCase().trim());
      if (!isLegacyDummy) {
        continue;
      }
    }

    const p = (q.paperName || '').trim();
    const text = q.question;

    let targetName: string;

    // 1. Diagnostic Test
    if (p.startsWith('Diagnostic Test')) {
      targetName = 'Diagnostic Test';
    }
    // 2. Post Training Assessment
    else if (p.startsWith('Post Training Test') || p.startsWith('Post Training Assessment')) {
      targetName = 'Post Training Assessment';
    }
    // 3. Company Specific Aptitude Assessment
    else if (
      p.startsWith('Infosys') ||
      p.startsWith('AMCAT') ||
      (p.startsWith('Tech Mahindra') && !p.includes('Verbal')) ||
      p.startsWith('SANMAR') ||
      p.startsWith('PESITM')
    ) {
      targetName = 'Company Specific Aptitude Assessment';
    }
    // 4. Verbal Ability
    else if (p.includes('Verbal') || verbalRegex.test(text)) {
      targetName = 'Verbal Ability';
    }
    // 5. Programming Languages
    else if (progRegex.test(text)) {
      targetName = 'Programming Languages';
    }
    // 6. Advanced Computing
    else if (
      p.startsWith('BITS IT') ||
      p.startsWith('EEC Course') ||
      p.startsWith('Bioinformatic') ||
      p.startsWith('BITS Electrical') ||
      p.startsWith('ECE & ETC')
    ) {
      targetName = 'Advanced Computing';
    }
    // 7. Guesstimates
    else if (guesstimateRegex.test(text)) {
      targetName = 'Guesstimates';
    }
    // 8. Psychometric Test
    else if (psychometricRegex.test(text)) {
      targetName = 'Psychometric Test';
    }
    // 9. Puzzles
    else if (puzzleRegex.test(text)) {
      targetName = 'Puzzles';
    }
    // 10. Advanced Aptitude
    else if (
      q.difficulty === 'hard' ||
      p.startsWith('BITS Consulting') ||
      p.startsWith('BITS Finance') ||
      p.startsWith('BITS Chemical') ||
      p.startsWith('BITS MECH')
    ) {
      targetName = 'Advanced Aptitude';
    }
    // 11. Foundation Aptitude
    else if (q.difficulty === 'easy' && (p.startsWith('Practice Test') || p.startsWith('Quantitative Ability'))) {
      targetName = 'Foundation Aptitude';
    }
    // 12. Quantitative & Reasoning Aptitude
    else {
      targetName = 'Quantitative & Reasoning Aptitude';
    }

    const targetSubId = subjectMap.get(targetName)!;
    if (q.subjectId !== targetSubId) {
      targetUpdates.push({ id: q.id, targetSubjectId: targetSubId });
    }
  }

  console.log(`Re-assigning ${targetUpdates.length} questions to their correct canonical subjects...`);
  
  // Group updates by targetSubjectId for fast batch updates
  const groupedUpdates: Record<string, string[]> = {};
  for (const item of targetUpdates) {
    if (!groupedUpdates[item.targetSubjectId]) {
      groupedUpdates[item.targetSubjectId] = [];
    }
    groupedUpdates[item.targetSubjectId].push(item.id);
  }

  for (const [subId, ids] of Object.entries(groupedUpdates)) {
    // update in chunks of 500
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await prisma.question.updateMany({
        where: { id: { in: chunk } },
        data: { subjectId: subId }
      });
    }
  }

  // 5. Seed specialized questions for Guesstimates, Psychometric Test, Programming Languages, and Puzzles
  if (faculty) {
    await seedDomainQuestions(faculty.id, subjectMap);
  }

  // 6. Re-link existing exams that point to old/deleted subjects
  const allSubIds = Array.from(subjectMap.values());
  const examsToUpdate = await prisma.exam.findMany({
    where: {
      OR: [
        { subjectId: { notIn: allSubIds } },
        { subjectId: null }
      ]
    }
  });

  const defaultSubId = subjectMap.get('Quantitative & Reasoning Aptitude')!;
  for (const ex of examsToUpdate) {
    let newSubId = defaultSubId;
    if (ex.title.toLowerCase().includes('verbal')) {
      newSubId = subjectMap.get('Verbal Ability')!;
    } else if (ex.title.toLowerCase().includes('diagnostic')) {
      newSubId = subjectMap.get('Diagnostic Test')!;
    } else if (ex.title.toLowerCase().includes('post training')) {
      newSubId = subjectMap.get('Post Training Assessment')!;
    } else if (ex.title.toLowerCase().includes('eec') || ex.title.toLowerCase().includes('computing')) {
      newSubId = subjectMap.get('Advanced Computing')!;
    } else if (ex.title.toLowerCase().includes('infosys') || ex.title.toLowerCase().includes('amcat') || ex.title.toLowerCase().includes('placement')) {
      newSubId = subjectMap.get('Company Specific Aptitude Assessment')!;
    }

    await prisma.exam.update({
      where: { id: ex.id },
      data: { subjectId: newSubId }
    });
  }

  // 7. Clean up obsolete dummy subjects that have 0 questions and are known legacy dummies
  const legacyDummyNames = ['AML Examination EEC Course', 'EEC Course', 'Demo'];
  const dummySubjects = await prisma.subject.findMany({
    where: {
      subjectName: { in: legacyDummyNames },
      questions: { none: {} }
    }
  });

  console.log(`Found ${dummySubjects.length} obsolete empty subjects to clean up...`);
  for (const ds of dummySubjects) {
    try {
      // Re-link any portions, notes, or uploaded docs if any
      await prisma.portion.deleteMany({ where: { subjectId: ds.id } });
      await prisma.note.deleteMany({ where: { subjectId: ds.id } });
      await prisma.uploadedDocument.deleteMany({ where: { subjectId: ds.id } });
      await prisma.subject.delete({ where: { id: ds.id } });
      console.log(`[Cleaned Obsolete Subject] ${ds.subjectName} (${ds.id})`);
    } catch (e: any) {
      console.warn(`Could not delete subject ${ds.subjectName}:`, e.message);
    }
  }

  // 8. Final Count Summary
  console.log('\n=== FINAL QUESTION BANK COUNTS BY 12 SUBJECTS ===');
  for (const sName of CANONICAL_SUBJECTS) {
    const sId = subjectMap.get(sName)!;
    const count = await prisma.question.count({ where: { subjectId: sId } });
    console.log(`- ${sName}: ${count} questions`);
  }
  const totalInDB = await prisma.question.count();
  console.log(`Total questions in system: ${totalInDB}`);
}

async function seedDomainQuestions(facultyId: string, subjectMap: Map<string, string>) {
  // Guesstimates (15 questions)
  const guesstimatesSubId = subjectMap.get('Guesstimates')!;
  const existingGuesstimates = await prisma.question.count({ where: { subjectId: guesstimatesSubId } });
  if (existingGuesstimates < 15) {
    const guesstimatesData = [
      {
        question: "In a management consulting interview guesstimate, what distinguishes a 'Top-Down' approach from a 'Bottom-Up' approach?",
        options: [
          "Top-Down starts from total addressable population and applies demographic filters; Bottom-Up aggregates supply or operational capacity unit by unit.",
          "Top-Down uses only financial revenue data, while Bottom-Up uses only customer surveys.",
          "Bottom-Up relies strictly on historical regression, whereas Top-Down ignores empirical assumptions.",
          "There is no difference; both terms are interchangeable in market sizing."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "Estimate the number of daily domestic flights departing from a major hub airport like Mumbai (CSMIA) with 1 runway operating at near full capacity (runway slot interval of approx. 90 seconds, operating 18 hours/day).",
        options: ["Approx. 700 - 900 flights", "Approx. 150 - 200 flights", "Approx. 2,500 - 3,000 flights", "Approx. 50 - 80 flights"],
        correct: 0,
        difficulty: "hard",
        marks: 5
      },
      {
        question: "Estimate the daily consumption of cups of tea in India, assuming an urban/rural population of 1.4 billion, ~70% tea drinkers, and an average frequency of 2.5 cups per consumer daily.",
        options: ["Approx. 2.4 to 2.5 Billion cups", "Approx. 250 Million cups", "Approx. 10 Billion cups", "Approx. 50 Million cups"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "Estimate the annual market size (in units) of refrigerators sold in an urban region with 5 million households, where 80% own a refrigerator and average product replacement lifespan is 8 years.",
        options: ["500,000 units per year", "2,000,000 units per year", "100,000 units per year", "50,000 units per year"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "If a metro train with 6 coaches operates every 5 minutes during a 4-hour peak period, and each coach comfortably holds 250 passengers, what is the maximum one-directional peak passenger throughput?",
        options: ["72,000 passengers", "18,000 passengers", "120,000 passengers", "36,000 passengers"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "Estimate the total revenue of a 4-screen multiplex cinema in a Tier-1 city on a weekend day, running 4 shows/screen, 250 seats/screen, 80% occupancy, and average ticket price of Rs. 250.",
        options: ["Rs. 8,00,000", "Rs. 1,60,000", "Rs. 24,00,000", "Rs. 4,50,000"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In market sizing estimation for Electric Vehicles (EV), what is the 'Replacement Cycle' formula used to estimate annual replenishment demand from the installed base?",
        options: [
          "Annual Demand = (Installed Base of Users) / (Average Product Lifespan in Years)",
          "Annual Demand = Installed Base * Depreciation Rate * GDP Growth",
          "Annual Demand = Target Market Size - Initial Inventory",
          "Annual Demand = Total Population / Inflation Rate"
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "Estimate the total volume of water needed daily for drinking and cooking in a university residential campus with 10,000 students, assuming standard per capita drinking/cooking requirement of 5 liters/day.",
        options: ["50,000 Liters", "5,000 Liters", "500,000 Liters", "1,000,000 Liters"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "Estimate the number of delivery executives active during dinner peak (8 PM - 10 PM) in a city with 40,000 dinner orders, if each executive completes an average of 2 deliveries per hour.",
        options: ["10,000 delivery executives", "20,000 delivery executives", "5,000 delivery executives", "40,000 delivery executives"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In a Fermi estimation problem, which of the following is an effective technique to validate an order-of-magnitude guesstimate?",
        options: [
          "Triangulating the result using an independent supply-side constraint check",
          "Multiplying the estimate by 10 to ensure safety margins",
          "Ignoring boundary conditions and assumptions",
          "Assuming zero variance in per-capita metrics"
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "Estimate the total daily sales volume of fuel at a busy highway petrol pump with 8 dispensing nozzles, each nozzle serving 1 vehicle every 3 minutes with an average fuel fill of 20 liters, over 16 active hours.",
        options: ["51,200 Liters", "12,800 Liters", "102,400 Liters", "25,600 Liters"],
        correct: 0,
        difficulty: "hard",
        marks: 5
      },
      {
        question: "Estimate the total number of hospital beds in a city of 1.5 million people, given a healthcare infrastructure benchmark of 2.5 hospital beds per 1,000 population.",
        options: ["3,750 beds", "1,500 beds", "6,000 beds", "10,000 beds"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "Estimate the number of tires replaced annually in a delivery fleet consisting of 2,500 light commercial 4-wheel vehicles, if each vehicle replaces all 4 tires every 50,000 km, covering an average of 25,000 km per year.",
        options: ["5,000 tires per year", "10,000 tires per year", "2,500 tires per year", "20,000 tires per year"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "What is the primary objective of structuring a market-sizing guesstimate during corporate campus placements?",
        options: [
          "Demonstrating logical decomposition, reasonable proxy assumptions, and sanity-checking ability rather than memorizing exact census figures.",
          "Providing the exact real-time government statistical number down to single decimal digits.",
          "Using complex calculus equations to impress the interview panel.",
          "Skipping intermediate calculation steps to produce an immediate guess."
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "Estimate the number of barbershops/salons in a city of 1.2 million population, assuming 600,000 men get a haircut once every 30 days, a salon has 3 chairs, and each haircut takes 30 minutes (operating 10 hours/day).",
        options: ["Approx. 333 salons", "Approx. 1,200 salons", "Approx. 50 salons", "Approx. 3,000 salons"],
        correct: 0,
        difficulty: "hard",
        marks: 5
      }
    ];

    for (const q of guesstimatesData) {
      await prisma.question.create({
        data: {
          question: q.question,
          type: 'mcq',
          difficulty: q.difficulty,
          marks: q.marks,
          subjectId: guesstimatesSubId,
          facultyId: facultyId,
          paperName: 'Guesstimates Assessment Pool',
          options: {
            create: q.options.map((opt, idx) => ({
              option: opt,
              isCorrect: idx === q.correct
            }))
          }
        }
      });
    }
    console.log(`Seeded ${guesstimatesData.length} Guesstimates questions.`);
  }

  // Psychometric Test (15 questions)
  const psychometricSubId = subjectMap.get('Psychometric Test')!;
  const existingPsychometric = await prisma.question.count({ where: { subjectId: psychometricSubId } });
  if (existingPsychometric < 15) {
    const psychometricData = [
      {
        question: "You are leading a high-priority enterprise project with a strict client deadline tomorrow, and a critical developer falls ill unexpectedly. What is your most effective immediate action?",
        options: [
          "Assess pending deliverables, reprioritize must-have features, reassign tasks among capable team members, and transparently notify the stakeholder with a mitigation plan.",
          "Inform the client that the deadline cannot be met and postpone all release activities indefinitely.",
          "Compel other developers to work around the clock without checking task dependencies or current capacity.",
          "Deliver the half-finished code without running integration tests to meet the timeline."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "A senior team member proposes an architectural approach that you know will cause severe latency under high concurrent load based on empirical benchmark tests. How should you address this?",
        options: [
          "Schedule an objective technical design review with the team, present benchmark data collaboratively, and evaluate trade-offs together without making it personal.",
          "Ignore their opinion and secretly write alternative code behind their back.",
          "Confront the colleague aggressively in front of junior engineers to establish authority.",
          "Say nothing and let the system crash in production so they learn a lesson."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "During an audit, you discover a calculation discrepancy in monthly performance reports that inadvertently favored your department's KPI metrics. What is the ethically sound response?",
        options: [
          "Document the discrepancy, report it immediately to management and the audit committee, and implement a validation guard to prevent recurrence.",
          "Keep quiet since nobody noticed and your department received praise.",
          "Blame an intern or junior contractor who recently left the team.",
          "Delete the audit log files so no one can trace the calculation flaw."
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "You receive contradictory project priorities from two executive stakeholders. Both tasks are marked urgent. How do you proceed professionally?",
        options: [
          "Align both stakeholders in a concise sync or email outlining capacity, timeline trade-offs, and request executive consensus on prioritization.",
          "Pick the project from the executive you like better and ignore the other.",
          "Refuse to work on either task until they fight it out amongst themselves.",
          "Pretend to work on both simultaneously while delivering neither on time."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "While presenting a client demo, a stakeholder points out an obvious factual error on one of your presentation slides. What is the best immediate reaction?",
        options: [
          "Acknowledge the mistake gracefully, thank the client for pointing it out, make a note to correct it immediately, and maintain confidence in presenting the core findings.",
          "Defensively argue with the client and insist that the slide is 100% correct.",
          "Blame your presentation teammate publicly in the middle of the meeting.",
          "End the meeting abruptly and walk out of the presentation room."
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "A peer consistently takes credit for collaborative solutions built by the entire project group. How should you resolve this situation?",
        options: [
          "Address the issue privately with the peer first, establishing clear attribution conventions for future status presentations.",
          "Post negative public comments on social media about your peer's character.",
          "Refuse to collaborate with anyone on the team going forward.",
          "Sabotage the peer's portion of the codebase before the next demo."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "Your team is assigned an unfamiliar legacy codebase with scarce documentation and a tight modernization timeline. What behavioral attitude ensures the best outcome?",
        options: [
          "Curiosity, structured exploration, writing unit tests to document behavior, and seeking knowledge from domain experts proactively.",
          "Complaining daily to management about how terrible the previous team was.",
          "Re-writing the entire software architecture from scratch without management approval.",
          "Doing the bare minimum and claiming lack of documentation as an excuse for inaction."
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "How do you respond when a project you poured weeks of effort into is canceled due to a strategic company pivot?",
        options: [
          "Recognize business context changes, document reusable technical components and learnings from the initiative, and seamlessly pivot enthusiasm to the new priority.",
          "Become resentful and disengage from team activities.",
          "Demand monetary compensation for work that didn't reach production.",
          "Refuse to work on the new project until the old one is reinstated."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "When delivering constructive critical feedback to a junior engineer experiencing performance gaps, which principle is most constructive?",
        options: [
          "Focus on specific observed behaviors and their impact, listen to their perspective, and co-create an actionable improvement roadmap with measurable milestones.",
          "Use vague generalizations like 'you never pay attention' to make them feel guilty.",
          "Compare them negatively to top performers in front of the entire team.",
          "Avoid giving any feedback and silently request their termination."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In an Agile team retrospective, a colleague blames an external team for missed sprint commitments. What is the most constructive way to facilitate?",
        options: [
          "Steer the discussion towards internal team control: 'What dependencies could we have anticipated earlier, and how can we mitigate this proactively next sprint?'",
          "Encourage everyone to join in criticizing the other department.",
          "Cancel retrospectives permanently since dependencies cannot be controlled.",
          "Send an angry email blast to the external team's executive director."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "A client requests an out-of-scope feature modification during an informal phone check-in. What is the professional way to respond?",
        options: [
          "Express appreciation for the idea, state that it sounds valuable, and propose routing it through the formal change request process to assess timeline and scope impact.",
          "Immediately agree without checking with your technical team or budget.",
          "Flatly reject the client with a rude statement that it is not your job.",
          "Secretly code the feature without logging tickets or running QA tests."
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "Which workplace characteristic is most predictive of psychological safety within high-performing engineering teams?",
        options: [
          "Team members feel safe to take calculated risks, admit mistakes, ask questions, and propose unconventional ideas without fear of humiliation or punishment.",
          "Zero tolerance for any technical bugs in staging environments.",
          "Strict hierarchical communication where only managers speak in meetings.",
          "Complete avoidance of any disagreements or technical debates."
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "You realize 45 minutes before a major client deployment that a minor cosmetic glitch exists on an edge-case screen that doesn't impact data integrity or primary flows. What do you do?",
        options: [
          "Communicate the minor cosmetic issue transparently to the release manager, document it as a known issue for the next patch, and proceed with the deployment plan if authorized.",
          "Halt the entire company deployment without notifying anyone.",
          "Rush an untested hotfix into production 5 minutes before launch.",
          "Pretend you never saw the glitch and delete the user bug report."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "When working in a diverse, cross-functional global team with varying cultural communication norms, which approach fosters the best alignment?",
        options: [
          "Clear asynchronous written documentation, active listening, explicit definitions of done, and mutual respect for time-zone boundaries.",
          "Expecting everyone to conform immediately to your personal cultural communication habits.",
          "Scheduling meetings exclusively at 2 AM for international colleagues without asking.",
          "Avoiding direct communication with colleagues outside your geographical office."
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "A junior team member asks you a technical question while you are deep in focused development work on an urgent bug. How do you handle this respectfully?",
        options: [
          "Acknowledge them politely, explain that you are mid-investigation on an urgent bug, and set a specific time (e.g., in 30 minutes) to sit down and review their question together.",
          "Snap angrily at them for daring to disturb you.",
          "Completely ignore them and stare silently at your screen.",
          "Give them completely bogus code so they go away."
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      }
    ];

    for (const q of psychometricData) {
      await prisma.question.create({
        data: {
          question: q.question,
          type: 'mcq',
          difficulty: q.difficulty,
          marks: q.marks,
          subjectId: psychometricSubId,
          facultyId: facultyId,
          paperName: 'Psychometric Assessment Pool',
          options: {
            create: q.options.map((opt, idx) => ({
              option: opt,
              isCorrect: idx === q.correct
            }))
          }
        }
      });
    }
    console.log(`Seeded ${psychometricData.length} Psychometric Test questions.`);
  }

  // Programming Languages (20 questions)
  const progSubId = subjectMap.get('Programming Languages')!;
  const existingProg = await prisma.question.count({ where: { subjectId: progSubId } });
  if (existingProg < 20) {
    const progData = [
      {
        question: "In Python, what is the output of the following expression: `type(lambda x: x * 2)`?",
        options: ["<class 'function'>", "<class 'lambda'>", "<class 'type'>", "<class 'method'>"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In C, what is the primary cause and symptom of a 'Segmentation Fault' (SIGSEGV)?",
        options: [
          "Attempting to access memory that the program does not have permissions to read or write (e.g., dereferencing NULL or invalid pointers).",
          "Exceeding the maximum integer limit in a variable.",
          "Using recursion without an iterative loop.",
          "Missing a semicolon at the end of a struct definition."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In Java, what is the key difference between `String`, `StringBuilder`, and `StringBuffer`?",
        options: [
          "String is immutable; StringBuilder is mutable and not thread-safe; StringBuffer is mutable and synchronized (thread-safe).",
          "String and StringBuilder are identical; StringBuffer stores characters as primitive integers.",
          "StringBuilder cannot append strings dynamically; StringBuffer is restricted to ASCII characters.",
          "All three classes are immutable and thread-safe."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "Which SQL clause is used to filter aggregated group records produced by a `GROUP BY` statement?",
        options: ["HAVING", "WHERE", "FILTER", "ORDER BY"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In C++, why is it critical for a base class with virtual functions to declare a `virtual ~Base()` destructor?",
        options: [
          "To ensure that the derived class destructor is correctly invoked when deleting an object through a pointer to the base class, preventing resource leaks.",
          "To make the class abstract so it cannot be instantiated.",
          "To force all member variables to be zeroed out in memory.",
          "To prevent any derived classes from inheriting from the base class."
        ],
        correct: 0,
        difficulty: "hard",
        marks: 5
      },
      {
        question: "In Python, what is the difference between shallow copy (`copy.copy()`) and deep copy (`copy.deepcopy()`)?",
        options: [
          "A shallow copy constructs a new compound object and inserts references to the original objects; a deep copy recursively duplicates all nested objects.",
          "A shallow copy only copies strings, while deep copy copies integers.",
          "There is no functional difference in Python 3.",
          "A shallow copy creates a read-only frozen set."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In SQL, what is the fundamental difference between `TRUNCATE TABLE` and `DELETE FROM`?",
        options: [
          "TRUNCATE is a DDL operation that deallocates data pages rapidly without logging individual row deletions; DELETE is a DML operation that deletes row-by-row and can be rolled back.",
          "TRUNCATE deletes the table schema permanently; DELETE only deletes column headers.",
          "DELETE can only be used on tables with fewer than 100 rows.",
          "TRUNCATE allows WHERE clauses for selective removal, whereas DELETE does not."
        ],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In Java, what does the `volatile` keyword guarantee when applied to a field?",
        options: [
          "It guarantees that reads and writes are always read directly from and written to main memory, ensuring visibility across threads without CPU caching issues.",
          "It guarantees that all operations on the variable are atomic, including increments (`++`).",
          "It prevents the variable from ever being modified after initialization.",
          "It serializes the object to disk on every state modification."
        ],
        correct: 0,
        difficulty: "hard",
        marks: 5
      },
      {
        question: "In Python, what does the `yield` keyword turn a standard function into?",
        options: ["A Generator function that produces values lazily one at a time via the iterator protocol.", "A Coroutine that runs exclusively on secondary CPU cores.", "A Lambda expression with static memory allocation.", "A Singleton class instance."],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In C/C++, what is the size of a pointer variable on a standard 64-bit operating system architecture?",
        options: ["8 bytes (64 bits)", "4 bytes (32 bits)", "2 bytes (16 bits)", "16 bytes (128 bits)"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In Java, which collection maintains elements in sorted order based on their natural ordering or a custom Comparator?",
        options: ["TreeSet", "HashSet", "ArrayList", "LinkedHashSet"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In SQL, which index type stores the actual table data rows physically in the sorted order of the index key?",
        options: ["Clustered Index", "Non-Clustered Index", "Bitmap Index", "Filtered Index"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In Python, what is the time complexity of checking `if item in my_dict:` for a dictionary with N keys?",
        options: ["O(1) average time complexity", "O(N) linear time complexity", "O(log N) logarithmic time complexity", "O(N^2) quadratic time complexity"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In C++, what does the `explicit` keyword specifier on a constructor prevent?",
        options: ["It prevents implicit conversions and copy-initialization from matching that constructor.", "It prevents the constructor from being called with new.", "It makes the constructor private to external libraries.", "It restricts the constructor to heap allocation only."],
        correct: 0,
        difficulty: "hard",
        marks: 5
      },
      {
        question: "In Java, what occurs when an uncaught runtime exception is thrown inside a `try` block that has a matching `catch` block and a `finally` block?",
        options: [
          "The matching catch block executes, followed by the mandatory execution of the finally block before control exits the method.",
          "The finally block is bypassed completely to avoid side effects.",
          "The program terminates immediately without executing catch or finally.",
          "The try block restarts execution from line 1."
        ],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In Python, what will `bool([])`, `bool([0])`, and `bool({})` evaluate to respectively?",
        options: ["False, True, False", "False, False, False", "True, True, True", "False, True, True"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In C, what is the output of: `int a = 10, b = 20; printf(\"%d\", a > b ? a : b);`?",
        options: ["20", "10", "1", "0"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "Which SQL constraint ensures that all values in a column are distinct and not null, acting as the primary entity identifier?",
        options: ["PRIMARY KEY", "FOREIGN KEY", "CHECK", "DEFAULT"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In Java, what is an interface called that contains exactly one abstract method?",
        options: ["Functional Interface (Single Abstract Method)", "Marker Interface", "Anonymous Interface", "Immutable Interface"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In Python, how does the Global Interpreter Lock (GIL) affect execution of pure CPU-bound threads in standard CPython?",
        options: [
          "It prevents multiple native threads from executing Python bytecode simultaneously on multiple CPU cores, restricting concurrency to single-core execution.",
          "It doubles execution speed by automatically vectorizing CPU operations.",
          "It prevents file I/O operations from blocking other threads.",
          "It has no effect on multi-core CPU utilization."
        ],
        correct: 0,
        difficulty: "hard",
        marks: 5
      }
    ];

    for (const q of progData) {
      await prisma.question.create({
        data: {
          question: q.question,
          type: 'mcq',
          difficulty: q.difficulty,
          marks: q.marks,
          subjectId: progSubId,
          facultyId: facultyId,
          paperName: 'Programming Languages Assessment Pool',
          options: {
            create: q.options.map((opt, idx) => ({
              option: opt,
              isCorrect: idx === q.correct
            }))
          }
        }
      });
    }
    console.log(`Seeded ${progData.length} Programming Languages questions.`);
  }

  // Puzzles (15 questions)
  const puzzlesSubId = subjectMap.get('Puzzles')!;
  const existingPuzzles = await prisma.question.count({ where: { subjectId: puzzlesSubId } });
  if (existingPuzzles < 15) {
    const puzzleData = [
      {
        question: "Eight friends P, Q, R, S, T, U, V, W are sitting around a circular table facing the center. P is third to the right of Q. R is second to the left of P. T is immediate neighbor of neither P nor Q. Who is sitting directly opposite to Q?",
        options: ["R", "S", "T", "U"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "Pointing to a man on stage, Sunita says, 'His mother is the only daughter-in-law of my grandfather's only son.' How is the man related to Sunita?",
        options: ["Brother", "Uncle", "Father", "Son"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "A man starts walking from Point A towards North. After walking 20 meters, he turns right and walks 15 meters. Then he turns right again and walks 20 meters. Finally, he turns left and walks 10 meters to reach Point B. What is the shortest distance and direction of Point B from Point A?",
        options: ["25 meters East", "15 meters East", "35 meters North", "20 meters South"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "If January 1, 2024 was a Monday, what day of the week was January 1, 2025? (Note: 2024 is a leap year with 366 days).",
        options: ["Wednesday", "Tuesday", "Thursday", "Monday"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "What is the angle between the hour hand and minute hand of an analog clock at 3:30?",
        options: ["75 degrees", "90 degrees", "60 degrees", "85 degrees"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "A solid wooden cube of 3 cm side is painted blue on all six sides. It is then cut into smaller cubes of 1 cm side each. How many of the small cubes will have NO face painted at all?",
        options: ["1 small cube", "0 small cubes", "8 small cubes", "6 small cubes"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In a class row of 50 students facing North, Rahul is ranked 18th from the left end and Divya is ranked 16th from the right end. How many students are sitting between Rahul and Divya?",
        options: ["16 students", "18 students", "14 students", "20 students"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "Statements: All laptops are electronic gadgets. All electronic gadgets are machines. Conclusions: I. All laptops are machines. II. Some machines are laptops.",
        options: ["Both Conclusion I and Conclusion II follow", "Only Conclusion I follows", "Only Conclusion II follows", "Neither conclusion follows"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      },
      {
        question: "In a certain coded cipher, 'PYTHON' is written as 'QZWIPO'. Following that identical rule, how will 'CODING' be written?",
        options: ["DPEJOH", "DPFKOH", "COEKOH", "DPEIOH"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "Five persons A, B, C, D, E live on different floors of a 5-storey building where ground floor is 1 and topmost floor is 5. C lives on an odd-numbered floor above floor 2. Exactly two people live between C and A. D lives immediately below B. On which floor does E live if B lives on floor 4?",
        options: ["Floor 1", "Floor 2", "Floor 3", "Floor 5"],
        correct: 0,
        difficulty: "hard",
        marks: 5
      },
      {
        question: "If South-East becomes North, North-East becomes West, and all other cardinal directions rotate identically, what will West become?",
        options: ["South-East", "North-East", "South-West", "North-West"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "A clock loses 3 minutes every hour. If it was synchronized correctly at 8:00 AM on Monday, what time will the clock display at 8:00 PM on the same day?",
        options: ["7:24 PM", "7:36 PM", "7:48 PM", "8:36 PM"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "In a family of six persons A, B, C, D, E, F: B is the son of C but C is not the mother of B. A and C are a married couple. E is the brother of C. D is the daughter of A. F is the brother of A. How many male members are there in the family?",
        options: ["4 male members", "3 male members", "2 male members", "5 male members"],
        correct: 0,
        difficulty: "hard",
        marks: 5
      },
      {
        question: "Four fair coins are tossed simultaneously. What is the probability of getting at least 2 heads?",
        options: ["11/16", "5/16", "1/2", "3/8"],
        correct: 0,
        difficulty: "medium",
        marks: 5
      },
      {
        question: "Look at the pattern: 3, 8, 15, 24, 35, 48, ___. What number comes next in the progression?",
        options: ["63", "60", "64", "59"],
        correct: 0,
        difficulty: "easy",
        marks: 5
      }
    ];

    for (const q of puzzleData) {
      await prisma.question.create({
        data: {
          question: q.question,
          type: 'mcq',
          difficulty: q.difficulty,
          marks: q.marks,
          subjectId: puzzlesSubId,
          facultyId: facultyId,
          paperName: 'Puzzles Assessment Pool',
          options: {
            create: q.options.map((opt, idx) => ({
              option: opt,
              isCorrect: idx === q.correct
            }))
          }
        }
      });
    }
    console.log(`Seeded ${puzzleData.length} Puzzles questions.`);
  }
}

if (require.main === module) {
  setup12SubjectsAndCategorize()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
