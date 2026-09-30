const pdfParser = require('pdf-parse');
const pdf = typeof pdfParser === 'function' ? pdfParser : (pdfParser.default || pdfParser);
import mammoth from 'mammoth';

export interface ParsedQuestion {
  question: string;
  type: 'mcq' | 'checkbox' | 'text';
  difficulty: 'easy' | 'medium' | 'hard';
  marks: number;
  options: { option: string; isCorrect: boolean }[];
}

/**
 * Extracts and cleans answer tokens from answer key string (e.g. "A", "(B)", "A, C", "Option A")
 */
export function extractAnswerTokens(raw: string): string[] {
  if (!raw) return [];
  let text = raw.trim();

  // Strip wrapping outer parentheses/brackets if whole string is wrapped, e.g. "(A, B)"
  text = text.replace(/^[\(\[\{]\s*(.*?)\s*[\)\]\}]$/, '$1');

  // Split tokens by comma, semicolon, slash, or " and " / " & "
  let rawTokens: string[] = [];
  if (/[,;\/]/.test(text)) {
    rawTokens = text.split(/[,;\/]/);
  } else if (/\s+(?:and|&)\s+/i.test(text)) {
    rawTokens = text.split(/\s+(?:and|&)\s+/i);
  } else {
    // Check if multiple single letters are space-separated, e.g. "A B C"
    if (/^[A-Ha-h](?:\s+[A-Ha-h])+$/.test(text)) {
      rawTokens = text.split(/\s+/);
    } else {
      rawTokens = [text];
    }
  }

  const tokens: string[] = [];
  for (let t of rawTokens) {
    t = t.trim();
    if (!t) continue;

    // Check if token is like "Option A" or "Option (A)" or "Choice B"
    const optMatch = t.match(/^(?:option|choice)\s*\(?([a-z0-9])\)?/i);
    if (optMatch) {
      tokens.push(optMatch[1].toLowerCase());
      continue;
    }

    // Check if token is "(A)" or "[A]" or "A." or "A)" or "A -" or just "A"
    const letterMatch = t.match(/^[\(\[\{]?\s*([a-z0-9])\s*[\)\]\}\.\:\-]?$/i);
    if (letterMatch) {
      tokens.push(letterMatch[1].toLowerCase());
      continue;
    }

    // Check if token is "A) Paris" or "A. Paris" or "A - Paris"
    const letterAndTextMatch = t.match(/^[\(\[]?\s*([a-z0-9])\s*[\.\:\)\-\]]\s*(.*)$/i);
    if (letterAndTextMatch) {
      tokens.push(letterAndTextMatch[1].toLowerCase());
      if (letterAndTextMatch[2].trim()) {
        tokens.push(letterAndTextMatch[2].trim().toLowerCase());
      }
      continue;
    }

    // Fallback: clean outer punctuation and keep normalized text
    const clean = t.replace(/^[\(\[\{\"\']+|[\)\]\}\"\'\.\,\;]+$/g, '').trim().toLowerCase();
    if (clean) {
      tokens.push(clean);
    }
  }

  return tokens;
}

/**
 * Checks whether an option matches the target answer tokens.
 * Crucially avoids loose substring matching on single letters (e.g. avoids letter 'a' matching 'Madrid').
 */
export function isOptionMatch(
  optText: string,
  optIndex: number,
  tokens: string[]
): boolean {
  if (!tokens || tokens.length === 0) return false;

  const optLetter = String.fromCharCode(65 + optIndex).toLowerCase(); // 'a', 'b', 'c', ...
  const optNum = String(optIndex + 1); // '1', '2', '3', ...
  const optIdxStr = String(optIndex);

  // Clean option text: strip leading "A) " or "A. " or "(A) " if still present
  const strippedOpt = optText.trim().replace(/^[\(\[\{]?\s*[a-z0-9]\s*[\)\]\}\.\:\-]\s*/i, '').trim().toLowerCase();
  const rawOpt = optText.trim().toLowerCase();

  for (const token of tokens) {
    const cleanToken = token.trim().toLowerCase();
    if (!cleanToken) continue;

    // 1. Single letter token: STRICT EQUALITY ONLY. NO SUBSTRINGS!
    if (/^[a-z]$/i.test(cleanToken)) {
      if (cleanToken === optLetter) {
        return true;
      }
      continue; // Crucial: never do substring matching for single letters!
    }

    // 2. Single digit token: 1-based or 0-based index match only
    if (/^\d+$/.test(cleanToken)) {
      if (cleanToken === optNum || cleanToken === optIdxStr) {
        return true;
      }
      continue;
    }

    // 3. Full text token: exact match (case-insensitive)
    if (cleanToken === rawOpt || cleanToken === strippedOpt) {
      return true;
    }

    // 4. Normalized punctuation match (e.g. "Paris." vs "Paris")
    const normToken = cleanToken.replace(/[^\w\s]/g, '').trim();
    const normOpt = strippedOpt.replace(/[^\w\s]/g, '').trim();
    if (normToken.length > 0 && normToken === normOpt) {
      return true;
    }
  }

  return false;
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

  // Parse CSV format questions with mode control
  parseCSVQuestions: (
    csvText: string,
    mode: 'mcq' | 'checkbox' | 'auto' = 'auto'
  ): ParsedQuestion[] => {
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

    // Option columns mapping: support option1..option8, optiona..optionh, or a..d
    const optIndices: { label: string; index: number }[] = [];
    headers.forEach((h, idx) => {
      if (h.startsWith('option') || ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].includes(h)) {
        optIndices.push({ label: h, index: idx });
      }
    });

    for (const line of dataLines) {
      if (!line.trim()) continue;
      const cells = splitCSVLine(line);
      if (cells.length === 0 || !cells[qIdx]) continue;

      const questionText = cells[qIdx];
      const origType = (cells[typeIdx] || 'mcq').toLowerCase() as 'mcq' | 'checkbox' | 'text';
      const difficulty = (cells[diffIdx] || 'medium').toLowerCase() as 'easy' | 'medium' | 'hard';
      const marks = parseInt(cells[marksIdx]) || 5;
      const correctStr = (cells[correctIdx] || '').trim();
      const correctTokens = extractAnswerTokens(correctStr);

      const options: { option: string; isCorrect: boolean }[] = [];
      
      if (optIndices.length > 0) {
        optIndices.forEach((optInfo, idx) => {
          const optValue = cells[optInfo.index];
          if (optValue) {
            const isCorrect = isOptionMatch(optValue, idx, correctTokens);
            options.push({
              option: optValue,
              isCorrect
            });
          }
        });
      }

      const matchedCount = options.filter(o => o.isCorrect).length;
      let finalType: 'mcq' | 'checkbox' | 'text' = options.length === 0 ? 'text' : origType;

      if (options.length > 0) {
        if (mode === 'mcq') {
          finalType = 'mcq';
          if (matchedCount > 0) {
            let foundFirst = false;
            options.forEach(o => {
              if (o.isCorrect) {
                if (!foundFirst) foundFirst = true;
                else o.isCorrect = false;
              }
            });
          } else {
            options[0].isCorrect = true;
          }
        } else if (mode === 'checkbox') {
          finalType = 'checkbox';
          if (matchedCount === 0) {
            options[0].isCorrect = true;
          }
        } else {
          // Auto mode
          if (matchedCount > 1) {
            finalType = 'checkbox';
          } else if (matchedCount === 1) {
            finalType = 'mcq';
          } else {
            options[0].isCorrect = true;
            finalType = 'mcq';
          }
        }
      }

      questions.push({
        question: questionText,
        type: finalType,
        difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
        marks,
        options
      });
    }

    return questions;
  },

  // Parse raw unstructured text using heuristics (PDF / DOCX) with mode control
  parseUnstructuredQuestions: (
    text: string,
    mode: 'mcq' | 'checkbox' | 'auto' = 'auto'
  ): ParsedQuestion[] => {
    const questions: ParsedQuestion[] = [];
    
    // Pre-split lines that contain multiple options separated by tabs or 2+ spaces
    const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const lines: string[] = [];

    for (const rawLine of rawLines) {
      const parts = rawLine.split(/(?=(?:[ \t]{2,}|\t+)(?:[A-Ha-h0-9]\s*[\.\:\-\)]|\(?\s*[A-Ha-h0-9]\s*\))\s+)/i);
      if (parts.length > 1) {
        for (const p of parts) {
          if (p.trim()) lines.push(p.trim());
        }
      } else {
        lines.push(rawLine);
      }
    }

    let currentQuestion: {
      question: string;
      difficulty: 'easy' | 'medium' | 'hard';
      marks: number;
      rawOptions: { text: string; isInlineMarked: boolean }[];
      correctAnswers: string[];
    } = {
      question: '',
      difficulty: 'medium',
      marks: 5,
      rawOptions: [],
      correctAnswers: []
    };

    const saveCurrentQuestion = () => {
      if (currentQuestion.question) {
        const rawOptions = currentQuestion.rawOptions || [];
        const correctAnswers = currentQuestion.correctAnswers || [];
        
        // Map raw options to structures and check match against tokens or inline markers
        const options = rawOptions.map((optObj, idx) => {
          const isMatched = isOptionMatch(optObj.text, idx, correctAnswers);
          const isCorrect = isMatched || optObj.isInlineMarked;
          return { option: optObj.text, isCorrect };
        });

        let type: 'mcq' | 'checkbox' | 'text' = 'text';

        if (options.length === 0) {
          type = 'text';
        } else {
          const matchedIndices: number[] = [];
          options.forEach((opt, idx) => {
            if (opt.isCorrect) matchedIndices.push(idx);
          });

          if (mode === 'mcq') {
            type = 'mcq';
            // STRICT SINGLE ANSWER: EXACTLY ONE OPTION MUST BE TRUE
            if (matchedIndices.length > 0) {
              const winner = matchedIndices[0];
              options.forEach((opt, idx) => {
                opt.isCorrect = (idx === winner);
              });
            } else {
              // Fallback: default to option A
              options.forEach((opt, idx) => {
                opt.isCorrect = (idx === 0);
              });
            }
          } else if (mode === 'checkbox') {
            type = 'checkbox';
            if (matchedIndices.length === 0) {
              options[0].isCorrect = true;
            }
          } else {
            // Auto-detect mode
            if (matchedIndices.length > 1) {
              type = 'checkbox';
            } else if (matchedIndices.length === 1) {
              type = 'mcq';
            } else {
              options[0].isCorrect = true;
              type = 'mcq';
            }
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
    // Options: A) B. (C) [D] [x] *A) A*)
    const optionRegex = /^(?:(?:\*\s*)?([A-Ha-h0-9])\s*[\*]?\s*[\.\:\-\)]|\(?\s*([A-Ha-h0-9])\s*[\*]?\s*\)|\[\s*([xX\s]?)\s*\]|\(\s*([xX\s]?)\s*\))\s*(.*)/i;
    // Answer lines: Answer:, Ans:, Ans., Correct Answer:, Correct Option:, Key:, etc.
    const correctRegex = /^(?:(?:Correct|Right)\s*(?:Answer|Option|Choice)?|Answer(?:\s*Key)?|Ans(?:\.|\:)?|Key)\s*(?:is\s*)?[\:\-\.]?\s*(.*)/i;

    for (const line of lines) {
      const qMatch = line.match(questionRegex);
      const oMatch = line.match(optionRegex);
      const cMatch = line.match(correctRegex);

      if (qMatch && !cMatch) {
        // Save previous question
        saveCurrentQuestion();
        
        // Reset current question
        currentQuestion = {
          question: qMatch[1].trim(),
          difficulty: 'medium',
          marks: 5,
          rawOptions: [],
          correctAnswers: []
        };
      } else if (oMatch && currentQuestion.question && !cMatch) {
        let optText = (oMatch[5] || '').trim();
        let isInlineMarked = false;

        // Check if bracket had 'x' like [x]
        if (oMatch[3] && oMatch[3].toLowerCase() === 'x') isInlineMarked = true;
        if (oMatch[4] && oMatch[4].toLowerCase() === 'x') isInlineMarked = true;
        // Check if line had asterisk like *A)
        if (line.startsWith('*') || line.includes('*)')) isInlineMarked = true;
        // Check if ends with (correct) or [correct]
        if (/\((?:correct|ans)\)|\[(?:correct|ans|x)\]/i.test(optText)) {
          isInlineMarked = true;
          optText = optText.replace(/\((?:correct|ans)\)|\[(?:correct|ans|x)\]/gi, '').trim();
        }

        currentQuestion.rawOptions.push({
          text: optText,
          isInlineMarked
        });
      } else if (cMatch && currentQuestion.question) {
        const answers = extractAnswerTokens(cMatch[1]);
        currentQuestion.correctAnswers.push(...answers);
      } else {
        if (currentQuestion.question) {
          if (currentQuestion.rawOptions.length > 0) {
            const lastIdx = currentQuestion.rawOptions.length - 1;
            currentQuestion.rawOptions[lastIdx].text += ' ' + line;
          } else {
            currentQuestion.question += ' ' + line;
          }
        }
      }
    }

    saveCurrentQuestion();

    return questions;
  },

  // Parse answer key from raw unstructured text
  parseAnswerKey: (text: string): Record<number, string[]> => {
    const answerMap: Record<number, string[]> = {};
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    for (const line of lines) {
      // Matches: "1. A", "1) B", "Q1: C", "Question 1 - D", "1. (A, B)", "1. Option B"
      const match = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[\.\:\-\)\s]+\s*(.+)$/i);
      if (match) {
        const qNum = parseInt(match[1], 10);
        const rawAns = match[2];
        const tokens = extractAnswerTokens(rawAns);
        if (tokens.length > 0) {
          answerMap[qNum] = tokens;
        }
      }
    }

    // Also support horizontal / compact formats: "1. A  2. B  3. C" or "1:A 2:B"
    if (Object.keys(answerMap).length === 0) {
      const regex = /(?:^|\s)(?:Q(?:uestion)?\s*)?(\d+)[\.\:\-\)]\s*([A-Ha-h](?:[\s,]+[A-Ha-h])*|\([A-Ha-h]\))\b/gi;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const qNum = parseInt(m[1], 10);
        const tokens = extractAnswerTokens(m[2]);
        if (tokens.length > 0) {
          answerMap[qNum] = tokens;
        }
      }
    }

    return answerMap;
  },

  // Parse questions from question paper and overlay correct answers from separate answer key
  parseQuestionsWithSeparateAnswers: (
    qText: string,
    aText: string,
    mode: 'mcq' | 'checkbox' | 'auto' = 'mcq'
  ): ParsedQuestion[] => {
    const questions = Extractor.parseUnstructuredQuestions(qText, mode);
    const answerMap = Extractor.parseAnswerKey(aText);
    
    questions.forEach((q, idx) => {
      const qNum = idx + 1;
      const correctAnsList = answerMap[qNum];
      if (correctAnsList && correctAnsList.length > 0) {
        // Reset all options to evaluated match
        q.options.forEach((opt, optIdx) => {
          opt.isCorrect = isOptionMatch(opt.option, optIdx, correctAnsList);
        });
        
        const matchedIndices: number[] = [];
        q.options.forEach((opt, optIdx) => {
          if (opt.isCorrect) matchedIndices.push(optIdx);
        });

        if (mode === 'mcq') {
          q.type = 'mcq';
          if (matchedIndices.length > 0) {
            const winner = matchedIndices[0];
            q.options.forEach((opt, optIdx) => {
              opt.isCorrect = (optIdx === winner);
            });
          } else {
            q.options[0].isCorrect = true;
          }
        } else if (mode === 'checkbox') {
          q.type = 'checkbox';
          if (matchedIndices.length === 0) {
            q.options[0].isCorrect = true;
          }
        } else {
          // Auto mode
          if (matchedIndices.length > 1) {
            q.type = 'checkbox';
          } else if (matchedIndices.length === 1) {
            q.type = 'mcq';
          } else {
            q.options[0].isCorrect = true;
            q.type = 'mcq';
          }
        }
      }
    });
    
    return questions;
  }
};
