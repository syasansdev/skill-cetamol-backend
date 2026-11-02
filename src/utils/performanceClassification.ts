import prisma from '../config/db';

export type PerformanceTier = 'Outstanding' | 'Proficient' | 'Competent' | 'Developing' | 'Needs Improvement';

export interface PerformanceCategoryDetail {
  category: PerformanceTier | string;
  minScore: number;
  maxScore: number;
  color: string;
  description?: string | null;
  emoji?: string;
}

export const GRADE_EMOJIS: Record<string, string> = {
  'Outstanding': '🌟',
  'Proficient': '🎯',
  'Competent': '✅',
  'Developing': '📈',
  'Needs Improvement': '⚠️',
  // Backwards compatibility mappings
  'Exceptional': '🌟',
  'Good': '🎯',
  'Average': '✅'
};

export const DEFAULT_THRESHOLDS: PerformanceCategoryDetail[] = [
  {
    category: 'Outstanding',
    minScore: 90.0,
    maxScore: 100.0,
    color: '#10b981',
    emoji: '🌟',
    description: 'Outstanding mastery of the subject matter with exemplary accuracy and problem-solving speed.'
  },
  {
    category: 'Proficient',
    minScore: 75.0,
    maxScore: 89.99,
    color: '#3b82f6',
    emoji: '🎯',
    description: 'Strong competence and understanding with consistent accuracy across sections.'
  },
  {
    category: 'Competent',
    minScore: 60.0,
    maxScore: 74.99,
    color: '#06b6d4',
    emoji: '✅',
    description: 'Sound grasp of foundational concepts, demonstrating practical competence.'
  },
  {
    category: 'Developing',
    minScore: 40.0,
    maxScore: 59.99,
    color: '#f59e0b',
    emoji: '📈',
    description: 'Developing foundational skills; additional practice recommended.'
  },
  {
    category: 'Needs Improvement',
    minScore: 0.0,
    maxScore: 39.99,
    color: '#ef4444',
    emoji: '⚠️',
    description: 'Requires targeted academic remediation and practice.'
  }
];

let cachedThresholds: PerformanceCategoryDetail[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

export async function getActiveThresholds(): Promise<PerformanceCategoryDetail[]> {
  const now = Date.now();
  if (cachedThresholds && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedThresholds;
  }

  try {
    const dbThresholds = await prisma.performanceThreshold.findMany({
      orderBy: { minScore: 'desc' }
    });

    if (dbThresholds.length === 5) {
      cachedThresholds = dbThresholds.map(t => ({
        category: t.category,
        minScore: t.minScore,
        maxScore: t.maxScore,
        color: t.color || '#64748b',
        description: t.description,
        emoji: GRADE_EMOJIS[t.category] || '📊'
      }));
      lastCacheTime = now;
      return cachedThresholds;
    }
  } catch (err) {
    console.warn('[PerformanceClassification] Could not load DB thresholds, using defaults:', err);
  }

  return DEFAULT_THRESHOLDS;
}

export function invalidateThresholdCache(): void {
  cachedThresholds = null;
  lastCacheTime = 0;
}

/**
 * Normalizes legacy category names into the canonical 5 tiers.
 */
export function normalizeCategory(cat: string | null | undefined): PerformanceTier {
  if (!cat) return 'Needs Improvement';
  const c = cat.trim();
  if (c === 'Exceptional' || c === 'Outstanding') return 'Outstanding';
  if (c === 'Good' || c === 'Proficient') return 'Proficient';
  if (c === 'Competent') return 'Competent';
  if (c === 'Average' || c === 'Developing') return 'Developing';
  if (c === 'Needs Improvement') return 'Needs Improvement';
  return 'Needs Improvement';
}

export function classifyScore(percentage: number, thresholds: PerformanceCategoryDetail[] = DEFAULT_THRESHOLDS): {
  category: PerformanceTier;
  grade: string;
  emoji: string;
  displayGrade: string;
  color: string;
  description: string;
} {
  const normalizedPct = Math.max(0, Math.min(100, Math.round(percentage * 100) / 100));

  for (const t of thresholds) {
    // Epsilon tolerance for edge boundaries (e.g. 89.99 vs 90.0)
    if (normalizedPct >= t.minScore - 0.001 && normalizedPct <= t.maxScore + 0.001) {
      const canonical = normalizeCategory(t.category);
      const emoji = GRADE_EMOJIS[canonical] || '📊';
      return {
        category: canonical,
        grade: canonical,
        emoji,
        displayGrade: `${emoji} ${canonical}`,
        color: t.color,
        description: t.description || ''
      };
    }
  }

  // Fallback boundaries if thresholds don't fully cover
  if (normalizedPct >= 90) {
    return { category: 'Outstanding', grade: 'Outstanding', emoji: '🌟', displayGrade: '🌟 Outstanding', color: '#10b981', description: 'Outstanding mastery' };
  }
  if (normalizedPct >= 75) {
    return { category: 'Proficient', grade: 'Proficient', emoji: '🎯', displayGrade: '🎯 Proficient', color: '#3b82f6', description: 'Strong competence' };
  }
  if (normalizedPct >= 60) {
    return { category: 'Competent', grade: 'Competent', emoji: '✅', displayGrade: '✅ Competent', color: '#06b6d4', description: 'Sound grasp' };
  }
  if (normalizedPct >= 40) {
    return { category: 'Developing', grade: 'Developing', emoji: '📈', displayGrade: '📈 Developing', color: '#f59e0b', description: 'Developing skills' };
  }
  return { category: 'Needs Improvement', grade: 'Needs Improvement', emoji: '⚠️', displayGrade: '⚠️ Needs Improvement', color: '#ef4444', description: 'Requires targeted remediation' };
}

export function validateThresholdBoundaries(
  thresholds: Array<{ category: string; minScore: number; maxScore: number }>
): { valid: boolean; error?: string } {
  if (!thresholds || thresholds.length !== 5) {
    return { valid: false, error: 'Exactly five performance categories are required: Outstanding, Proficient, Competent, Developing, Needs Improvement.' };
  }

  const requiredCategories = ['Outstanding', 'Proficient', 'Competent', 'Developing', 'Needs Improvement'];
  const presentCategories = thresholds.map(t => t.category);
  for (const req of requiredCategories) {
    if (!presentCategories.includes(req)) {
      return { valid: false, error: `Missing category definition for "${req}".` };
    }
  }

  // Check each threshold range validity
  for (const t of thresholds) {
    if (typeof t.minScore !== 'number' || typeof t.maxScore !== 'number') {
      return { valid: false, error: `Threshold bounds for "${t.category}" must be valid numbers.` };
    }
    if (t.minScore < 0 || t.maxScore > 100) {
      return { valid: false, error: `Score bounds for "${t.category}" must be between 0 and 100.` };
    }
    if (t.minScore >= t.maxScore) {
      return { valid: false, error: `Minimum score (${t.minScore}%) must be strictly lower than maximum score (${t.maxScore}%) for category "${t.category}".` };
    }
  }

  // Sort descending by minScore
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);

  if (sorted[0].category !== 'Outstanding' ||
      sorted[1].category !== 'Proficient' ||
      sorted[2].category !== 'Competent' ||
      sorted[3].category !== 'Developing' ||
      sorted[4].category !== 'Needs Improvement') {
    return {
      valid: false,
      error: 'Category ordering must strictly be Outstanding (highest) > Proficient > Competent > Developing > Needs Improvement (lowest).'
    };
  }

  // Needs Improvement must start at 0
  if (Math.abs(sorted[4].minScore) > 0.01) {
    return { valid: false, error: 'Needs Improvement category must start at 0%.' };
  }

  // Outstanding must end at 100
  if (Math.abs(sorted[0].maxScore - 100) > 0.01) {
    return { valid: false, error: 'Outstanding category must end at 100%.' };
  }

  // Check contiguous adjacency (gap or overlap <= 0.05 allowed for decimal rounding e.g. 74.99 and 75.0)
  for (let i = 0; i < sorted.length - 1; i++) {
    const higher = sorted[i];
    const lower = sorted[i + 1];
    const diff = higher.minScore - lower.maxScore;
    if (diff < -0.05) {
      return {
        valid: false,
        error: `Overlap detected between "${higher.category}" (min: ${higher.minScore}%) and "${lower.category}" (max: ${lower.maxScore}%).`
      };
    }
    if (diff > 0.05) {
      return {
        valid: false,
        error: `Gap detected between "${lower.category}" (max: ${lower.maxScore}%) and "${higher.category}" (min: ${higher.minScore}%). Scores must be continuous.`
      };
    }
  }

  return { valid: true };
}
