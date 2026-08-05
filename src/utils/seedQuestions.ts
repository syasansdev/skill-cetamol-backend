import prisma from '../config/db';
import * as bcrypt from 'bcrypt';

const questionsData = [
  {
    question: "The ratio between the present ages of P and Q is 6:7. If Q is 4 years old than P, what will be the ratio of the ages of P and Q after 4 years",
    options: ["7:8", "3:8", "7:9", "5:8"],
    correctIndex: 0,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "A library has an average of 510 visitors on Sundays and 240 on other day. The average number of visitors in a month of 30 days starting with Sunday is",
    options: ["280", "290", "285", "295"],
    correctIndex: 2,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "The average weight of 3 men A, B and C is 84 kg. Another man D joins the group and the average now becomes 80 kg. If another man F, whose weight is 3 kg more that of D replaces A then the average weight of B, C, D and E becomes 79 kg. The weight of A is:",
    options: ["70", "75", "72", "80"],
    correctIndex: 1,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "Ages of two persons differ by 16 years. If 6 year ago, the elder one be 3 times as old the younger one, find their present age",
    options: ["12,28", "16,32", "14,30", "18,34"],
    correctIndex: 2,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "Average age of A and B is 24 years and average age of B, C and D is 22 years. The sum of the ages of A, B, C and D is:",
    options: ["90 years", "96 years", "114 years", "Data inadequate"],
    correctIndex: 3,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "0.1 decades ago, Ajay was quadrice as old as her daughter Simran. 0.6 decades hence, Ajay's age will beat her daughter's age by 0.9 decades. The proportion of the current ages of Ajay and Simran is: [ 0.1 Decades =1 Year; quadrice = 4 times]",
    options: ["8:1", "11:4", "10:2", "13:4"],
    correctIndex: 3,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "A shopkeeper mixes two varieties of sugar costing Rs 25/Kg and Rs 20/Kg in a certain ratio such that the cost of the mixture is Rs 23/Kg. Find the ratio in which the 2 types of sugar were mixed?",
    options: ["2:6", "1:2", "3:2", "5:1"],
    correctIndex: 2,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "The average monthly salary of 12 workers and 3 managers in a factory was Rs. 600. When one of the manager whose salary was Rs. 720, was replaced with a new manager, then the average salary of the team went down to 580. What is the salary of the new manager?",
    options: ["570", "690", "420", "640"],
    correctIndex: 2,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "A container contains 40 litres of milk. From this container, 4 litres of milk was taken out and replaced by water. This process was repeated further two times. How much milk is now contained by the container?",
    options: ["26.34 litres", "28 litres", "27.36 litres", "29.16 litres"],
    correctIndex: 3,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "Average of all prime numbers between 30 and 50?",
    options: ["37", "39", "37.8", "39.8"],
    correctIndex: 3,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "A merchant has 1000 kg of sugar part of which he sells at 8% profit and the rest at 18% profit. He gains 14% on the whole. The quantity sold at 18% profit is",
    options: ["400 kg", "600 kg", "560 kg", "640 kg"],
    correctIndex: 1,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "The average of 6 numbers is 21, if each of the number is multiplied by 6, find the average of new set of numbers.",
    options: ["123", "126", "432", "None"],
    correctIndex: 1,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "How many kgs of rice costing Rs.20 per Kg should be mixed with 12kgs of rice costing Rs.25 per kg, so that on selling the mixture at Rs.30 per kg I get a profit of 25%?",
    options: ["3", "9", "6", "12"],
    correctIndex: 0,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "There are 3 vessels of equal capacity holds milk and water in the ratio of 1:2, 2:3 and 1:4, if the content of all the three vessels are mixed in a single vessel then find the ratio of milk and water in the new vessel?",
    options: ["14:31", "12:31", "15:32", "None"],
    correctIndex: 0,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "A mixture of 40 litres of salt and water contains 70% of salt. How much water must be added to decrease the salt percentage to 40%?",
    options: ["40 litres", "20 litres", "30 litres", "2 litres"],
    correctIndex: 2,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "An empty bottle weighs 1/6th of the full bottle. When a certain percent of water was removed and the bottle was weighed, the weight of the bottle turned out to be 1/3rd of the bottle when it was full. What is the percent of water removed?",
    options: ["70%", "80%", "85%", "75%"],
    correctIndex: 1,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "From a cask of milk containing 30 litres, 6 litres are drawn out and the cask is filled up with water. If the same process is repeated a second, then a third time, what will be the number of litres of milk left in the cask?",
    options: ["0.512 liters", "14.38 liters", "12 liters", "15.36 liters"],
    correctIndex: 3,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "The ratio of the ages of Manju and Kala is 4: 3. The total of their ages is 2.8 decades. The proportion of their ages after 0.8 decades will be",
    options: ["4:3", "7:4", "12:11", "6:5"],
    correctIndex: 3,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "the average of 40 soldiers in a troop is 31 years. If the captain's age is included, the average age of all of them still remains the same. What is the captain's age in years?",
    options: ["More than 31", "Less than 31", "31", "None"],
    correctIndex: 2,
    difficulty: "medium",
    marks: 5
  },
  {
    question: "In a mixture of milk and water, there is only 26% water. After replacing the mixture with 7 liters of pure milk, the percentage of milk in the mixture becomes 76%. The quantity of mixture is:",
    options: ["65 liters", "38 liters", "91 liters", "None of these"],
    correctIndex: 2,
    difficulty: "medium",
    marks: 5
  }
];

export async function seedQuantitativeAptitudeQuestions() {
  try {
    console.log('Checking for "Quantitative Ability-Pattern 1" subject and questions...');

    // 1. Resolve general CSE department
    let cseDept = await prisma.department.findUnique({
      where: { departmentName: 'Computer Science & Engineering' }
    });
    if (!cseDept) {
      cseDept = await prisma.department.create({
        data: { departmentName: 'Computer Science & Engineering' }
      });
    }

    // 2. Resolve general CSE course
    let cseCourse = await prisma.course.findUnique({
      where: { courseName: 'Bachelor of Technology in CSE' }
    });
    if (!cseCourse) {
      cseCourse = await prisma.course.create({
        data: { courseName: 'Bachelor of Technology in CSE', departmentId: cseDept.id }
      });
    }

    // 3. Resolve Subject
    let subject = await prisma.subject.findFirst({
      where: { subjectName: 'Quantitative Ability-Pattern 1' }
    });
    if (!subject) {
      subject = await prisma.subject.create({
        data: {
          subjectName: 'Quantitative Ability-Pattern 1',
          courseId: cseCourse.id,
          semester: 4
        }
      });
      console.log('Created subject: Quantitative Ability-Pattern 1');
    }

    // 4. Resolve administrator user & faculty profile
    let admin = await prisma.user.findUnique({
      where: { email: 'syasanscareeranalytics@gmail.com' }
    });
    if (!admin) {
      const adminHash = await bcrypt.hash('syasans123;!', 10);
      admin = await prisma.user.create({
        data: {
          name: 'Administrator',
          email: 'syasanscareeranalytics@gmail.com',
          password: adminHash,
          role: 'admin',
          status: 'active'
        }
      });
      console.log('Created Admin user.');
    }

    let faculty = await prisma.faculty.findUnique({
      where: { userId: admin.id }
    });
    if (!faculty) {
      faculty = await prisma.faculty.create({
        data: {
          userId: admin.id,
          departmentId: cseDept.id,
          designation: 'Administrator & Faculty',
          experience: 5
        }
      });
      console.log('Created Faculty profile for Admin.');
    }

    // 5. Seed questions
    const createdQuestionIds: string[] = [];
    for (const qData of questionsData) {
      // Check if question already exists in this subject
      let existingQ = await prisma.question.findFirst({
        where: {
          question: qData.question,
          subjectId: subject.id
        },
        include: { options: true }
      });

      if (!existingQ) {
        existingQ = await prisma.question.create({
          data: {
            question: qData.question,
            type: 'mcq',
            difficulty: qData.difficulty,
            marks: qData.marks,
            facultyId: faculty.id,
            subjectId: subject.id,
            options: {
              create: qData.options.map((optVal, idx) => ({
                option: optVal,
                isCorrect: idx === qData.correctIndex
              }))
            }
          },
          include: { options: true }
        });
        console.log(`Created question: "${qData.question.substring(0, 30)}..."`);
      }
      createdQuestionIds.push(existingQ.id);
    }

    // 6. Resolve scheduled Exam
    const examTitle = 'Quantitative Ability-Pattern 1 - Scheduled Exam';
    let existingExam = await prisma.exam.findFirst({
      where: { title: examTitle, subjectId: subject.id }
    });

    if (!existingExam) {
      // Schedule the exam for a default time window (next month)
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 7); // Starts in 7 days
      startDate.setHours(10, 0, 0, 0); // 10:00 AM

      const endDate = new Date(startDate);
      endDate.setHours(startDate.getHours() + 2); // 2 hours duration window

      existingExam = await prisma.exam.create({
        data: {
          title: examTitle,
          description: 'Quantitative Ability - Evaluation Exam covering ages, mixtures, averages, and prime numbers.',
          subjectId: subject.id,
          facultyId: faculty.id,
          duration: 60, // 60 minutes
          totalMarks: questionsData.length * 5, // 100 marks
          startDate,
          endDate,
          status: 'scheduled'
        }
      });

      // Link questions to the exam
      const examQuestionsData = createdQuestionIds.map(qId => ({
        examId: existingExam!.id,
        questionId: qId
      }));

      await prisma.examQuestion.createMany({
        data: examQuestionsData
      });

      console.log(`Created and scheduled exam: "${examTitle}" with ${createdQuestionIds.length} questions.`);
    }

    console.log('✅ Quantitative Aptitude Questions seeding completed successfully.');
  } catch (error) {
    console.error('❌ Error seeding quantitative aptitude questions:', error);
  }
}
