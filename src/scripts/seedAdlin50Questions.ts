import prisma from '../config/db';
import bcrypt from 'bcrypt';

const answerKeyMap: Record<number, string> = {
  1: 'A',  2: 'C',  3: 'C',  4: 'A',  5: 'B',
  6: 'A',  7: 'D',  8: 'A',  9: 'B',  10: 'B',
  11: 'C', 12: 'C', 13: 'B', 14: 'A', 15: 'B',
  16: 'B', 17: 'B', 18: 'B', 19: 'B', 20: 'B',
  21: 'A', 22: 'B', 23: 'B', 24: 'B', 25: 'B',
  26: 'B', 27: 'B', 28: 'B', 29: 'B', 30: 'B',
  31: 'C', 32: 'A', 33: 'A', 34: 'B', 35: 'B',
  36: 'B', 37: 'A', 38: 'B', 39: 'B', 40: 'B',
  41: 'B', 42: 'B', 43: 'B', 44: 'B', 45: 'B',
  46: 'B', 47: 'B', 48: 'B', 49: 'C', 50: 'B'
};

const questionsData = [
  // 1-10: SQL Server
  {
    num: 1,
    question: "What does DDL stand for in SQL Server?",
    options: ["Data Definition Language", "Data Display Language", "Database Design Logic", "Data Deletion Layer"]
  },
  {
    num: 2,
    question: "Which SQL statement is used to remove a table and its structure permanently from a database?",
    options: ["DELETE TABLE", "REMOVE TABLE", "DROP TABLE", "TRUNCATE TABLE"]
  },
  {
    num: 3,
    question: "Which constraint ensures no duplicate values exist in a column?",
    options: ["NOT NULL", "PRIMARY KEY", "UNIQUE", "CHECK"]
  },
  {
    num: 4,
    question: "Which clause is used in SQL to filter grouped records after an aggregation?",
    options: ["HAVING", "WHERE", "GROUP BY", "ORDER BY"]
  },
  {
    num: 5,
    question: "Which aggregate function ignores NULL values when calculating the average?",
    options: ["AVG() always includes NULLs", "AVG() ignores NULLs automatically", "AVG() treats NULLs as zero", "AVG() throws an error on NULL"]
  },
  {
    num: 6,
    question: "What is the primary difference between UNION and UNION ALL in SQL Server?",
    options: ["UNION removes duplicate rows while UNION ALL includes duplicate rows", "UNION ALL removes duplicate rows while UNION includes duplicate rows", "UNION can only combine two tables while UNION ALL can combine multiple", "UNION works on strings while UNION ALL works on numbers"]
  },
  {
    num: 7,
    question: "Which JOIN returns ALL rows from both tables including unmatched rows?",
    options: ["INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL OUTER JOIN"]
  },
  {
    num: 8,
    question: "Which SQL clause is used to sort the result set in descending order?",
    options: ["ORDER BY column_name DESC", "SORT BY column_name DESC", "GROUP BY column_name DESC", "ALIGN BY column_name DESC"]
  },
  {
    num: 9,
    question: "Which of the following is TRUE about a View in SQL Server?",
    options: ["A view stores data physically like a table", "A view is a saved SELECT query that acts like a virtual table", "Views cannot be used in JOIN operations", "Views can only be created on a single table"]
  },
  {
    num: 10,
    question: "What is the main benefit of creating a Clustered Index on a SQL Server table?",
    options: ["It encrypts the table data on disk", "It physically sorts and stores data rows based on the key values", "It creates a secondary copy of the table in memory", "It automatically backs up the database"]
  },

  // 11-20: Power BI Power Query & Connectivity
  {
    num: 11,
    question: "What is the default data connectivity mode when loading data into Power BI Desktop?",
    options: ["DirectQuery", "Live Connection", "Import", "Composite"]
  },
  {
    num: 12,
    question: "Which tool in Power BI is used to clean, transform, and reshape data prior to modeling?",
    options: ["DAX Studio", "Visual Report View", "Power Query Editor", "Power BI Service Admin Portal"]
  },
  {
    num: 13,
    question: "What does 'Unpivot Columns' do in Power Query?",
    options: ["Converts row data into multiple columns", "Converts column headers into row values (wide to long format)", "Removes duplicate columns", "Merges two queries side by side"]
  },
  {
    num: 14,
    question: "In Power Query, what is the difference between 'Merge Queries' and 'Append Queries'?",
    options: ["Merge adds columns horizontally based on matching keys; Append adds rows vertically", "Append adds columns horizontally; Merge adds rows vertically", "Both functions perform identical operations", "Merge works on single tables only; Append works on database views"]
  },
  {
    num: 15,
    question: "In Power BI data modeling, what is a 'Star Schema'?",
    options: ["A schema with many interconnected tables in a ring", "One central Fact table connected to multiple Dimension tables", "A schema with only one table", "Two Fact tables connected to each other"]
  },
  {
    num: 16,
    question: "What is the standard relationship cardinality between a Dimension table and a Fact table?",
    options: ["Many-to-Many (*:*)", "One-to-Many (1:*)", "One-to-One (1:1)", "Many-to-One (*:1) with bidirectional filtering disabled"]
  },
  {
    num: 17,
    question: "What is the purpose of a Calendar Table in Power BI?",
    options: ["To display a calendar visual on the report page", "To enable Time Intelligence DAX functions like YTD and MTD", "To schedule report refresh automatically", "To store employee attendance records"]
  },
  {
    num: 18,
    question: "What relationship filtering direction is generally recommended for performance and predictability in Power BI?",
    options: ["Both directions (Bidirectional)", "Single direction (Dimension to Fact)", "Cross-table outer join", "Indirect filter propagation"]
  },
  {
    num: 19,
    question: "What happens when you click 'Transform Data' instead of 'Load' in the Power BI Navigator?",
    options: ["Data is immediately loaded into the model", "The Power Query Editor opens so you can clean and shape data first", "The report is published to Power BI Service", "A relationship is automatically created"]
  },
  {
    num: 20,
    question: "Which language is generated in the background by Power Query transformations?",
    options: ["DAX", "M Language", "SQL", "Python"]
  },

  // 21-30: DAX
  {
    num: 21,
    question: "What is the difference between a Calculated Column and a Measure in Power BI DAX?",
    options: ["Calculated columns are computed row by row and stored; measures are computed dynamically at query time", "Measures are stored in the table; calculated columns are not", "Both are identical in how they work", "Calculated columns use filter context; measures use row context"]
  },
  {
    num: 22,
    question: "Which DAX function modifies or overrides the current filter context in a calculation?",
    options: ["SUMX()", "CALCULATE()", "FILTER()", "RELATED()"]
  },
  {
    num: 23,
    question: "What does TOTALYTD() return?",
    options: ["Total value for the previous year", "Cumulative total from the start of the year to the current date", "Total value for the current month only", "Average value year to date"]
  },
  {
    num: 24,
    question: "What does the ALL() function in DAX do when applied to a column or table?",
    options: ["Returns only distinct non-blank rows", "Ignores all filters applied to that column or table", "Applies a strict AND filter to all columns", "Replaces all null values with zeroes"]
  },
  {
    num: 25,
    question: "What is the purpose of SAMEPERIODLASTYEAR() in DAX?",
    options: ["Returns data for the same period in the next year", "Returns a table of dates shifted one year back for year-over-year comparison", "Calculates the difference between this year and last year", "Returns the same date repeated for each row"]
  },
  {
    num: 26,
    question: "What is the key difference between SUM() and SUMX() in DAX?",
    options: ["SUM() evaluates row by row; SUMX() aggregates an entire column at once", "SUM() aggregates a column in filter context; SUMX() iterates row-by-row over an expression", "SUM() works on measures; SUMX() works on calculated columns only", "Both functions are identical"]
  },
  {
    num: 27,
    question: "What does the SWITCH() function do in DAX?",
    options: ["Switches between Import and DirectQuery mode", "Evaluates an expression against a list of values and returns the matching result — a cleaner alternative to nested IF()", "Switches the active relationship between two tables", "Converts data types of a column"]
  },
  {
    num: 28,
    question: "Which DAX function brings a related value from another table into the current row context?",
    options: ["LOOKUPVALUE()", "RELATED()", "USERELATIONSHIP()", "CROSSFILTER()"]
  },
  {
    num: 29,
    question: "In DAX, what is a 'filter context'?",
    options: ["The M language code that filters rows in Power Query", "The set of filters currently applied to a calculation — from slicers, visuals, and report filters", "The WHERE clause equivalent in SQL", "A special type of calculated table"]
  },
  {
    num: 30,
    question: "What does the USERELATIONSHIP() function do in a DAX calculation?",
    options: ["Creates a permanent database foreign key", "Activates an inactive relationship for the duration of the specific calculation", "Combines two unrelated user profiles", "Removes relationship constraints between tables"]
  },

  // 31-40: Visualizations
  {
    num: 31,
    question: "Which Power BI visual is BEST suited to show the contribution of each category to a total?",
    options: ["Line Chart", "Waterfall Chart", "Donut or Pie Chart", "KPI Card"]
  },
  {
    num: 32,
    question: "Which visual type in Power BI is ideal for displaying performance against a target value with status indicators?",
    options: ["Gauge or KPI Card", "Scatter Plot", "Matrix Table", "Treemap"]
  },
  {
    num: 33,
    question: "What is the difference between 'Drill Down' and 'Drill Through' in Power BI?",
    options: ["Drill Down navigates hierarchy levels within a visual; Drill Through navigates to a separate detail page", "Both are the same feature", "Drill Through works on Bar charts only", "Drill Down creates a new page automatically"]
  },
  {
    num: 34,
    question: "What visual format setting allows conditional color changes of data bars based on threshold values?",
    options: ["Data Colors theme reset", "Conditional Formatting", "Tooltip formatting", "Legend sorting"]
  },
  {
    num: 35,
    question: "What does 'Sync Slicers' do in Power BI Desktop?",
    options: ["Synchronises data refresh across all reports", "Applies a slicer selection across multiple report pages simultaneously", "Creates identical visuals on all pages", "Syncs the report to Power BI Service"]
  },
  {
    num: 36,
    question: "What is the purpose of Bookmarks in Power BI Desktop?",
    options: ["To bookmark web links outside Power BI", "To capture the current state of a report page (filters, visuals, visibility) for storytelling and navigation", "To save DAX formulas locally", "To bookmark user permissions"]
  },
  {
    num: 37,
    question: "What is a Waterfall Chart best used for in Power BI?",
    options: ["Showing cumulative effect of positive and negative values over a sequence", "Showing distribution of data", "Comparing exact values across categories", "Displaying geographic data"]
  },
  {
    num: 38,
    question: "Which visual displays hierarchical data as a set of nested rectangles?",
    options: ["Funnel Chart", "Treemap", "Ribbon Chart", "Decomposition Tree"]
  },
  {
    num: 39,
    question: "How do you enable 'Mobile View Optimization' in Power BI Desktop?",
    options: ["File > Mobile Settings", "View > Mobile Layout — then drag visuals into the phone canvas", "It is automatic for all reports", "Publish to Power BI Service first"]
  },
  {
    num: 40,
    question: "What visual interaction setting prevents one visual from filtering another on the same report page?",
    options: ["Sync Slicers panel", "Edit Interactions > Select 'None' icon", "Lock Visual position", "Cross-highlighting toggle"]
  },

  // 41-50: Service & Administration
  {
    num: 41,
    question: "What is the first step to publish a Power BI report from Desktop to Power BI Service?",
    options: ["Export as PDF first", "Save the .pbix file then click Home > Publish and select a Workspace", "Share via email", "Upload from File Explorer on powerbi.com"]
  },
  {
    num: 42,
    question: "What software component is required to connect Power BI Service to on-premises data sources?",
    options: ["Power BI Desktop", "On-Premises Data Gateway", "Azure Data Lake", "SQL Server Management Studio"]
  },
  {
    num: 43,
    question: "What is Row-Level Security (RLS) in Power BI?",
    options: ["A way to lock rows in a database", "A feature that restricts which data rows a specific user can see in a report based on their identity", "Security applied to the Power BI Service login", "Encryption of data rows"]
  },
  {
    num: 44,
    question: "What is the difference between a Dashboard and a Report in Power BI Service?",
    options: ["Reports have one tile; Dashboards have multiple pages", "Reports can have multiple pages from a single dataset; Dashboards pin single-page visual tiles from multiple reports", "Dashboards are created in Desktop; Reports are created in Service", "Both are identical in structure"]
  },
  {
    num: 45,
    question: "What is 'Scheduled Refresh' in Power BI Service?",
    options: ["Automatically refreshing the browser page", "Configuring Power BI Service to automatically pull updated data from the source at set intervals", "Refreshing the list of reports", "Sending reports via email on a schedule"]
  },
  {
    num: 46,
    question: "What storage capacity tier in Power BI allows sharing reports organization-wide without requiring receivers to have Pro licenses?",
    options: ["Power BI Free", "Power BI Premium / Fabric Capacity", "Power BI Pro per user", "Power BI Desktop Standard"]
  },
  {
    num: 47,
    question: "What are 'Deployment Pipelines' in Power BI?",
    options: ["A Python pipeline for data processing", "A Power BI Premium feature to manage content across Development, Test, and Production stages", "A method to deploy Power BI Desktop", "Automatic report creation pipelines"]
  },
  {
    num: 48,
    question: "What is the function of an Apps Workspace in Power BI Service?",
    options: ["A scratchpad for personal drafts only", "A collaborative space for teams to build, manage, and bundle reports into an App for end users", "A repository for storing raw SQL scripts", "An offline backup folder"]
  },
  {
    num: 49,
    question: "Which of these is a best practice for Power BI report performance?",
    options: ["Load all columns from every table", "Use Import mode for large real-time data", "Reduce model size by loading only required columns and using aggregations", "Create as many calculated columns as possible"]
  },
  {
    num: 50,
    question: "What feature in Power BI Service allows users to subscribe to report pages to receive periodic email snapshots?",
    options: ["Data Alerts", "Subscriptions", "Usage Metrics", "Analyze in Excel"]
  }
];

export async function seedAdlinData() {
  console.log('Seeding Adlin Sheeba faculty, subject, and 50 questions dataset...');

  // 1. Ensure Department "Artificial Intelligence & Machine Learning (AML)" exists
  let dept = await prisma.department.findFirst({
    where: {
      OR: [
        { departmentName: { contains: 'AML' } },
        { departmentName: { contains: 'Machine Learning' } },
        { departmentName: 'Artificial Intelligence & Machine Learning' }
      ]
    }
  });
  if (!dept) {
    dept = await prisma.department.create({
      data: { departmentName: 'Artificial Intelligence & Machine Learning (AML)' }
    });
  }

  // 2. Ensure Course exists
  let course = await prisma.course.findFirst({
    where: { departmentId: dept.id }
  });
  if (!course) {
    course = await prisma.course.create({
      data: {
        courseName: 'B.Tech Artificial Intelligence & Machine Learning',
        departmentId: dept.id
      }
    });
  }

  // 3. Ensure Subject "AML Examination EEC Course" exists
  let subject = await prisma.subject.findFirst({
    where: { subjectName: 'AML Examination EEC Course' }
  });
  if (!subject) {
    subject = await prisma.subject.create({
      data: {
        subjectName: 'AML Examination EEC Course',
        courseId: course.id,
        semester: 1
      }
    });
  }

  // 4. Ensure User and Faculty "Adlin Sheeba" exists with email hodaml@stjosephs.ac.in
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: 'hodaml@stjosephs.ac.in' },
        { name: { contains: 'Adlin' } }
      ]
    }
  });

  const hashedPassword = await bcrypt.hash('Password@123', 10);

  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'Adlin Sheeba',
        email: 'hodaml@stjosephs.ac.in',
        password: hashedPassword,
        role: 'faculty',
        status: 'active'
      }
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        email: 'hodaml@stjosephs.ac.in',
        name: 'Adlin Sheeba',
        role: 'faculty',
        status: 'active'
      }
    });
  }

  let faculty = await prisma.faculty.findUnique({
    where: { userId: user.id }
  });

  if (!faculty) {
    faculty = await prisma.faculty.create({
      data: {
        userId: user.id,
        employeeId: 'FAC-ADLIN-001',
        departmentId: dept.id,
        designation: 'Assistant Professor',
        experience: 5
      }
    });
  }

  // 5. Create / Update UploadedDocument record for "EEC Course Examination"
  const docName = 'EEC Course Examination';
  let doc = await prisma.uploadedDocument.findFirst({
    where: { name: docName, facultyId: faculty.id }
  });

  if (!doc) {
    doc = await prisma.uploadedDocument.create({
      data: {
        name: docName,
        fileUrl: 'https://skillcetamol.online/uploads/eec-course-examination.pdf',
        fileType: 'pdf',
        facultyId: faculty.id,
        subjectId: subject.id
      }
    });
  }

  // 6. Check if 50 questions already exist for this doc, if so skip re-inserting on every restart
  const existingQCount = await prisma.question.count({
    where: { uploadedDocumentId: doc.id }
  });

  if (existingQCount < 50) {
    await prisma.question.deleteMany({
      where: { uploadedDocumentId: doc.id }
    });

    console.log(`Inserting 50 questions for document "${docName}" under Adlin Sheeba...`);

    for (const qItem of questionsData) {
      const letterAnswer = answerKeyMap[qItem.num];
      const letterIndexMap: Record<string, number> = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
      const correctIdx = letterIndexMap[letterAnswer];

      await prisma.question.create({
        data: {
          question: `Q${qItem.num}. ${qItem.question}`,
          type: 'mcq',
          difficulty: 'medium',
          marks: 2,
          subjectId: subject.id,
          facultyId: faculty.id,
          departmentId: dept.id,
          paperName: docName,
          uploadedDocumentId: doc.id,
          options: {
            create: qItem.options.map((optStr, idx) => ({
              option: optStr,
              isCorrect: idx === correctIdx
            }))
          }
        }
      });
    }

    console.log(`✅ Successfully seeded 50 questions with 100% correct answer keys for Faculty Adlin Sheeba under subject "${subject.subjectName}" and document "${docName}"!`);
  }

  // 7. Update any existing exams with title "EEC Course Examination" to link to AML Examination EEC Course subject.id & AML departmentId
  await prisma.faculty.update({
    where: { id: faculty.id },
    data: { departmentId: dept.id }
  });

  await prisma.exam.updateMany({
    where: {
      OR: [
        { title: { contains: 'EEC' } },
        { title: { contains: 'Course Examination' } },
        { paperName: 'EEC Course Examination' }
      ]
    },
    data: {
      subjectId: subject.id,
      departmentId: dept.id
    }
  });
  console.log(`Updated all "EEC Course Examination" exams to point to subject "${subject.subjectName}" and department "${dept.departmentName}"`);
}

if (require.main === module) {
  seedAdlinData()
    .catch(e => {
      console.error('Error seeding data:', e);
    })
    .finally(() => prisma.$disconnect());
}
