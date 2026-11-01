import prisma from '../config/db';

export interface PerformanceCategoryDetail {
  category: 'Exceptional' | 'Good' | 'Average' | 'Needs Improvement';
  minScore: number;
  maxScore: number;
  color: string;
  description?: string | null;
}

export const DEFAULT_THRESHOLDS: PerformanceCategoryDetail[] = [
  {
    category: 'Exceptional',
    minScore: 90.0,
    maxScore: 100.0,
    color: '#10b981',
    description: 'Outstanding mastery of the subject matter with minimal errors.'
  },
  {
    category: 'Good',
    minScore: 75.0,
    maxScore: 89.99,
    color: '#3b82f6',
    description: 'Strong competence and understanding with consistent accuracy.'
  },
  {
    category: 'Average',
    minScore: 50.0,
    maxScore: 74.99,
    color: '#f59e0b',
    description: 'Adequate grasp of foundational concepts, with scope for improvement.'
  },
  {
    category: 'Needs Improvement',
    minScore: 0.0,
    maxScore: 49.99,
    color: '#ef4444',
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

    if (dbThresholds.length === 4) {
      cachedThresholds = dbThresholds.map(t => ({
        category: t.category as any,
        minScore: t.minScore,
        maxScore: t.maxScore,
        color: t.color || '#64748b',
        description: t.description
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

export function classifyScore(percentage: number, thresholds: PerformanceCategoryDetail[] = DEFAULT_THRESHOLDS): {
  category: 'Exceptional' | 'Good' | 'Average' | 'Needs Improvement';
  color: string;
  description: string;
} {
  const normalizedPct = Math.max(0, Math.min(100, Math.round(percentage * 100) / 100));

  for (const t of thresholds) {
    // Epsilon tolerance for edge boundaries (e.g. 89.99 vs 90.0)
    if (normalizedPct >= t.minScore - 0.001 && normalizedPct <= t.maxScore + 0.001) {
      return {
        category: t.category,
        color: t.color,
        description: t.description || ''
      };
    }
  }

  // Fallback boundaries
  if (normalizedPct >= 90) return { category: 'Exceptional', color: '#10b981', description: 'Outstanding mastery' };
  if (normalizedPct >= 75) return { category: 'Good', color: '#3b82f6', description: 'Strong competence' };
  if (normalizedPct >= 50) return { category: 'Average', color: '#f59e0b', description: 'Adequate grasp' };
  return { category: 'Needs Improvement', color: '#ef4444', description: 'Requires targeted remediation' };
}

export function validateThresholdBoundaries(
  thresholds: Array<{ category: string; minScore: number; maxScore: number }>
): { valid: boolean; error?: string } {
  if (!thresholds || thresholds.length !== 4) {
    return { valid: false, error: 'Exactly four performance categories are required: Exceptional, Good, Average, Needs Improvement.' };
  }

  const requiredCategories = ['Exceptional', 'Good', 'Average', 'Needs Improvement'];
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

  // Expect: Exceptional > Good > Average > Needs Improvement
  if (sorted[0].category !== 'Exceptional' ||
      sorted[1].category !== 'Good' ||
      sorted[2].category !== 'Average' ||
      sorted[3].category !== 'Needs Improvement') {
    return {
      valid: false,
      error: 'Category ordering must strictly be Exceptional (highest) > Good > Average > Needs Improvement (lowest).'
    };
  }

  // Needs Improvement must start at 0
  if (Math.abs(sorted[3].minScore) > 0.01) {
    return { valid: false, error: 'Needs Improvement category must start at 0%.' };
  }

  // Exceptional must end at 100
  if (Math.abs(sorted[0].maxScore - 100) > 0.01) {
    return { valid: false, error: 'Exceptional category must end at 100%.' };
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

