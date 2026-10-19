/**
 * Exam Utilities
 * Deterministic question assignment, evaluation, scoring, and text formatting.
 */

export function cleanQuestionText(text: string): string {
  if (!text) return '';
  return text.replace(/^(?:q(?:uestion)?\s*\d+[\s.:)\-–—]+|\d+\s*[\.\)]\s+)/i, '').trim();
}

/**
 * Deterministic PRNG shuffle using a seed string (e.g. `${studentId}-${exam.id}`)
 */
export function pseudoRandomShuffle<T>(array: T[], seedStr: string): T[] {
  const result = [...array];
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed << 5) - seed + seedStr.charCodeAt(i);
    seed |= 0;
  }
  seed = Math.abs(seed);
  let m = result.length, t, i;
  while (m) {
    seed = (seed * 9301 + 49297) % 233280;
    i = Math.floor((seed / 233280) * m--);
    t = result[m];
    result[m] = result[i];
    result[i] = t;
  }
  return result;
}

/**
 * Returns the exact deterministic question subset assigned to this candidate for this exam.
 * Consistent across getExams, getExamById, submitExam, getResults, and getResultDetails.
 */
export function getAssignedExamQuestions(exam: any, studentId: string): any[] {
  if (!exam || !exam.examQuestions) return [];

  // 1. Sort by ID deterministically before shuffling
  const sortedEqs = [...exam.examQuestions].sort((a: any, b: any) => {
    const idA = a.questionId || a.id || '';
    const idB = b.questionId || b.id || '';
    return idA.localeCompare(idB);
  });

  // 2. Deterministic shuffle keyed to student and exam
  const seedStr = `${studentId}-${exam.id}`;
  const shuffledEqs = pseudoRandomShuffle(sortedEqs, seedStr);

  // 3. Filter valid questions
  const validEqs = shuffledEqs.filter((eq: any) => eq && eq.question);

  // 4. Limit to exam.questionCount if specified
  const countLimit = exam.questionCount && exam.questionCount > 0
    ? Math.min(exam.questionCount, validEqs.length)
    : validEqs.length;

  return validEqs.slice(0, countLimit);
}

export interface EvaluatedQuestionDetail {
  id: string;
  text: string;
  type: string;
  options: string[];
  correctAnswer: string | string[];
  studentOption: string | string[] | null;
  isCorrect: boolean;
  marksAwarded: number;
  difficulty: string;
}

export interface AnswerInsertData {
  studentExamId: string;
  questionId: string;
  selectedOption: string | null;
  answerText: string | null;
  marksAwarded: number;
}

export interface EvaluationResult {
  assignedEqs: any[];
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  score: number;
  totalPoints: number;
  percentage: number;
  status: 'pass' | 'fail';
  answerInserts: AnswerInsertData[];
  detailedQuestions: EvaluatedQuestionDetail[];
}

/**
 * Evaluates candidate answers against the assigned questions of an exam.
 */
export function evaluateExamAnswers(
  exam: any,
  studentId: string,
  answersMap: Record<string, any>,
  studentExamId: string = ''
): EvaluationResult {
  const assignedEqs = getAssignedExamQuestions(exam, studentId);
  const marksPerQ = exam.marksPerQuestion && exam.marksPerQuestion > 0 ? exam.marksPerQuestion : 1;
  const negMarks = exam.negativeMarking ? (exam.negativeMarks || 0) : 0;

  let rawScore = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;

  const answerInserts: AnswerInsertData[] = [];
  const detailedQuestions: EvaluatedQuestionDetail[] = [];

  for (let qIndex = 0; qIndex < assignedEqs.length; qIndex++) {
    const eq = assignedEqs[qIndex];
    const q = eq.question;

    // Check by question ID, examQuestion ID, or question index
    let studentAns = answersMap[q.id];
    if (studentAns === undefined && eq.id) studentAns = answersMap[eq.id];
    if (studentAns === undefined) studentAns = answersMap[String(qIndex)];

    const hasAnswer = studentAns !== undefined &&
                      studentAns !== null &&
                      studentAns !== '' &&
                      (!Array.isArray(studentAns) || studentAns.length > 0);

    const sortedOptions = [...(q.options || [])].sort((a: any, b: any) =>
      (a.id || '').localeCompare(b.id || '')
    );

    let correctAnswer: string | string[] = '0';
    if (q.type === 'mcq') {
      const idx = sortedOptions.findIndex((o: any) => o.isCorrect);
      correctAnswer = idx >= 0 ? String(idx) : '0';
    } else if (q.type === 'checkbox') {
      correctAnswer = sortedOptions
        .map((o: any, idx: number) => (o.isCorrect ? String(idx) : null))
        .filter((idx: any): idx is string => idx !== null);
    } else {
      correctAnswer = '';
    }

    let isCorrect = false;
    let selectedOption: string | null = null;
    let answerText: string | null = null;
    let marksAwarded = 0;
    let studentOptionForDetail: string | string[] | null = null;

    if (!hasAnswer) {
      skippedCount++;
    } else {
      if (q.type === 'mcq') {
        const numIdx = Number(studentAns);
        let matchedIdx = -1;
        if (!isNaN(numIdx) && numIdx >= 0 && numIdx < sortedOptions.length) {
          matchedIdx = numIdx;
        } else {
          const strVal = String(studentAns).trim().toLowerCase();
          matchedIdx = sortedOptions.findIndex((o: any) =>
            (o.id && o.id === studentAns) ||
            (o.option && o.option.trim().toLowerCase() === strVal)
          );
        }

        if (matchedIdx >= 0) {
          selectedOption = String(matchedIdx);
          studentOptionForDetail = String(matchedIdx);
          isCorrect = Boolean(sortedOptions[matchedIdx]?.isCorrect);
        } else {
          selectedOption = String(studentAns);
          studentOptionForDetail = String(studentAns);
          isCorrect = false;
        }
      } else if (q.type === 'checkbox') {
        let rawParts: string[] = [];
        if (Array.isArray(studentAns)) {
          rawParts = studentAns.map(String);
        } else if (typeof studentAns === 'string') {
          rawParts = studentAns.split(',').map((s: string) => s.trim()).filter(Boolean);
        }

        const matchedIndices: number[] = [];
        for (const item of rawParts) {
          const num = Number(item);
          if (!isNaN(num) && num >= 0 && num < sortedOptions.length) {
            if (!matchedIndices.includes(num)) matchedIndices.push(num);
          } else {
            const strVal = item.trim().toLowerCase();
            const fIdx = sortedOptions.findIndex((o: any) =>
              (o.id && o.id === item) ||
              (o.option && o.option.trim().toLowerCase() === strVal)
            );
            if (fIdx >= 0 && !matchedIndices.includes(fIdx)) {
              matchedIndices.push(fIdx);
            }
          }
        }
        matchedIndices.sort((a, b) => a - b);

        const correctIndices = sortedOptions
          .map((o: any, idx: number) => (o.isCorrect ? idx : null))
          .filter((idx: any): idx is number => idx !== null)
          .sort((a, b) => a - b);

        selectedOption = matchedIndices.map(String).join(',');
        studentOptionForDetail = matchedIndices.map(String);
        isCorrect = matchedIndices.length > 0 &&
                    matchedIndices.length === correctIndices.length &&
                    matchedIndices.every((val, i) => val === correctIndices[i]);
      } else if (q.type === 'text') {
        answerText = String(studentAns).trim();
        studentOptionForDetail = answerText;
        isCorrect = answerText.length > 0;
      }

      if (isCorrect) {
        correctCount++;
        rawScore += marksPerQ;
        marksAwarded = marksPerQ;
      } else {
        wrongCount++;
        if (negMarks > 0) {
          rawScore -= negMarks;
          marksAwarded = -negMarks;
        } else {
          marksAwarded = 0;
        }
      }
    }

    if (studentExamId) {
      answerInserts.push({
        studentExamId,
        questionId: q.id,
        selectedOption,
        answerText,
        marksAwarded
      });
    }

    detailedQuestions.push({
      id: q.id,
      text: cleanQuestionText(q.question || ''),
      type: q.type,
      options: sortedOptions.map((o: any) => o.option),
      correctAnswer,
      studentOption: studentOptionForDetail,
      isCorrect,
      marksAwarded,
      difficulty: q.difficulty || 'medium'
    });
  }

  const finalScore = correctCount === 0 ? 0 : Math.max(0, rawScore);
  const totalPoints = assignedEqs.length > 0
    ? Math.round(assignedEqs.length * marksPerQ)
    : (exam.totalMarks || 10);

  const percentage = (totalPoints > 0 && finalScore > 0)
    ? Math.min(100, Math.max(0, Math.round((finalScore / totalPoints) * 100)))
    : 0;

  const passThreshold = exam.passPercentage || 40;
  const status: 'pass' | 'fail' = (percentage >= passThreshold && finalScore > 0) ? 'pass' : 'fail';

  return {
    assignedEqs,
    correctCount,
    wrongCount,
    skippedCount,
    score: finalScore,
    totalPoints,
    percentage,
    status,
    answerInserts,
    detailedQuestions
  };
}
