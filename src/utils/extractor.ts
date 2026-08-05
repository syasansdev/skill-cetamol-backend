const pdf = require('pdf-parse') as any;
import mammoth from 'mammoth';

export interface ParsedQuestion {
  question: string;
  type: 'mcq' | 'checkbox' | 'text';
  difficulty: 'easy' | 'medium' | 'hard';
  marks: number;
  options: { option: string; isCorrect: boolean }[];
}

export const Extractor = {
  // Extract text from PDF buffer
  extractTextFromPDF: async (buffer: Buffer): Promise<string> => {
    try {
      const data = await pdf(buffer);
      return data.text;
    } catch (err) {
      console.error('PDF parsing error:', err);
      throw new Error('Failed to parse PDF file');
    }
  },

  // Extract text from DOCX buffer
  extractTextFromDOCX: async (buffer: Buffer): Promise<string> => {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (err) {
      console.error('Word parsing error:', err);
      throw new Error('Failed to parse Word (.docx) file');
    }
  },

  // Parse CSV format questions
  parseCSVQuestions: (csvText: string): ParsedQuestion[] => {
    const questions: ParsedQuestion[] = [];
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) return [];

    // Helper to split CSV line safely, respecting quotes
    const splitCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let insideQuote = false;
      let entry = '';
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          insideQuote = !insideQuote;
        } else if (char === ',' && !insideQuote) {
          result.push(entry.trim().replace(/^"|"$/g, ''));
          entry = '';
        } else {
          entry += char;
        }
      }
      result.push(entry.trim().replace(/^"|"$/g, ''));
      return result;
    };

    const headers = splitCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const dataLines = lines.slice(1);

    const qIdx = headers.indexOf('question');
    const typeIdx = headers.indexOf('type');
    const diffIdx = headers.indexOf('difficulty');
    const marksIdx = headers.indexOf('marks');
    const correctIdx = headers.indexOf('correct');

    // Option columns mapping: support option1..option4, optiona..optiond, or a single options column
    const optIndices: { label: string; index: number }[] = [];
    headers.forEach((h, idx) => {
      if (h.startsWith('option') || h === 'a' || h === 'b' || h === 'c' || h === 'd') {
        optIndices.push({ label: h, index: idx });
      }
    });

    for (const line of dataLines) {
      if (!line.trim()) continue;
      const cells = splitCSVLine(line);
      if (cells.length === 0 || !cells[qIdx]) continue;

      const questionText = cells[qIdx];
      const type = (cells[typeIdx] || 'mcq').toLowerCase() as 'mcq' | 'checkbox' | 'text';
      const difficulty = (cells[diffIdx] || 'medium').toLowerCase() as 'easy' | 'medium' | 'hard';
      const marks = parseInt(cells[marksIdx]) || 5;
      const correctStr = (cells[correctIdx] || '').trim().toLowerCase();

      const options: { option: string; isCorrect: boolean }[] = [];
      
      if (optIndices.length > 0) {
        optIndices.forEach((optInfo, idx) => {
          const optValue = cells[optInfo.index];
          if (optValue) {
            const optLetter = optInfo.label.replace('option', '').toLowerCase();
            const correctList = correctStr.split(',').map(s => s.trim());
            
            const isCorrect = correctList.includes(optLetter) ||
                              correctList.includes(String(idx)) ||
                              correctList.includes(optValue.toLowerCase());

            options.push({
              option: optValue,
              isCorrect
            });
          }
        });
      }

      questions.push({
        question: questionText,
        type: options.length === 0 ? 'text' : type,
        difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
        marks,
        options
      });
    }

    return questions;
  },

  // Parse raw unstructured text using heuristics (PDF / DOCX)
  parseUnstructuredQuestions: (text: string): ParsedQuestion[] => {
    const questions: ParsedQuestion[] = [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    let currentQuestion: Partial<ParsedQuestion> & { rawOptions: string[], correctAnswers: string[] } = {
      question: '',
      type: 'text',
      difficulty: 'medium',
      marks: 5,
      rawOptions: [],
      correctAnswers: []
    };

    const saveCurrentQuestion = () => {
      if (currentQuestion.question) {
        const rawOptions = currentQuestion.rawOptions || [];
        const correctAnswers = currentQuestion.correctAnswers || [];
        
        // Map raw options to structures
        const options = rawOptions.map((opt, idx) => {
          const optLetter = String.fromCharCode(65 + idx).toLowerCase(); // a, b, c, d
          
          // Check if option text or letter is marked as correct
          const isCorrect = correctAnswers.some(ans => {
            const cleanAns = ans.toLowerCase().trim();
            return cleanAns === optLetter || 
                   cleanAns === opt.toLowerCase() ||
                   cleanAns.startsWith(optLetter) ||
                   opt.toLowerCase().includes(cleanAns);
          });

          return { option: opt, isCorrect };
        });

        // Determine type: if we have options, MCQ or Checkbox, else Text
        let type: 'mcq' | 'checkbox' | 'text' = 'text';
        if (options.length > 0) {
          const correctCount = options.filter(o => o.isCorrect).length;
          type = correctCount > 1 ? 'checkbox' : 'mcq';
          
          // Fallback: if options exist but no correct answer is detected, mark the first one as correct
          if (correctCount === 0) {
            options[0].isCorrect = true;
            type = 'mcq';
          }
        }

        questions.push({
          question: currentQuestion.question,
          type,
          difficulty: currentQuestion.difficulty || 'medium',
          marks: currentQuestion.marks || 5,
          options
        });
      }
    };

    const questionRegex = /^(?:Q(?:uestion)?\s*\d*[\.\:\-\)]|\d+[\.\:\-\)])\s*(.*)/i;
    const optionRegex = /^(?:[A-Da-d0-9]\s*[\.\-\)]|\[\s*[xX]?\s*\]|\(\s*[A-Da-d0-9]\s*\))\s*(.*)/i;
    const correctRegex = /^(?:Correct(?:\s*Answer)?|Answer|Key)\s*[\:\-]?\s*(.*)/i;

    for (const line of lines) {
      const qMatch = line.match(questionRegex);
      const oMatch = line.match(optionRegex);
      const cMatch = line.match(correctRegex);

      if (qMatch) {
        // Save previous question
        saveCurrentQuestion();
        
        // Reset current question
        currentQuestion = {
          question: qMatch[1].trim(),
          type: 'text',
          difficulty: 'medium',
          marks: 5,
          rawOptions: [],
          correctAnswers: []
        };
      } else if (oMatch && currentQuestion.question) {
        currentQuestion.rawOptions.push(oMatch[1].trim());
      } else if (cMatch && currentQuestion.question) {
        const answers = cMatch[1].replace(/[\.\)]/g, '').split(/[,;]/).map(a => a.trim());
        currentQuestion.correctAnswers.push(...answers);
      } else {
        if (currentQuestion.question) {
          if (currentQuestion.rawOptions.length > 0) {
            const lastIdx = currentQuestion.rawOptions.length - 1;
            currentQuestion.rawOptions[lastIdx] += ' ' + line;
          } else {
            currentQuestion.question += ' ' + line;
          }
        }
      }
    }

    saveCurrentQuestion();

    return questions;
  }
};
