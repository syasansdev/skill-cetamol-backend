import { Response, NextFunction } from 'express';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth';
import {
  getActiveThresholds,
  classifyScore,
  validateThresholdBoundaries,
  invalidateThresholdCache,
  DEFAULT_THRESHOLDS
} from '../utils/performanceClassification';

export const PerformanceThresholdController = {
  // 1. Get All Configured Performance Thresholds
  getThresholds: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const thresholds = await getActiveThresholds();
      return res.status(200).json(thresholds);
    } catch (error) {
      next(error);
    }
  },

  // 2. Update Performance Thresholds (Super Admin / Admin)
  updateThresholds: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { thresholds, applyToHistorical } = req.body;

      if (!thresholds || !Array.isArray(thresholds)) {
        return res.status(400).json({ message: 'Invalid payload: thresholds array is required.' });
      }

      // Validate threshold boundaries (no gaps, no overlaps, continuous 0..100)
      const validation = validateThresholdBoundaries(thresholds);
      if (!validation.valid) {
        return res.status(400).json({ message: validation.error });
      }

      // Upsert all 4 categories in a transaction
      await prisma.$transaction(
        thresholds.map(t =>
          prisma.performanceThreshold.upsert({
            where: { category: t.category },
            update: {
              minScore: Number(t.minScore),
              maxScore: Number(t.maxScore),
              color: t.color || '#64748b',
              description: t.description || null
            },
            create: {
              category: t.category,
              minScore: Number(t.minScore),
              maxScore: Number(t.maxScore),
              color: t.color || '#64748b',
              description: t.description || null
            }
          })
        )
      );

      // Invalidate in-memory cache
      invalidateThresholdCache();
      const updated = await getActiveThresholds();

      // Recalculate historical results if requested
      let historicalUpdatedCount = 0;
      if (applyToHistorical) {
        const results = await prisma.result.findMany();
        for (const r of results) {
          const { category } = classifyScore(r.percentage, updated);
          if (r.performanceCategory !== category) {
            await prisma.result.update({
              where: { id: r.id },
              data: { performanceCategory: category }
            });
            historicalUpdatedCount++;
          }
        }
      }

      if (req.user) {
        await prisma.activityLog.create({
          data: {
            userId: req.user.id,
            action: `Updated global performance classification thresholds. Historical results updated: ${historicalUpdatedCount}`
          }
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Performance classification thresholds updated successfully.',
        thresholds: updated,
        historicalUpdatedCount
      });
    } catch (error) {
      next(error);
    }
  },

  // 3. Controlled Recalculation of Historical Results
  recalculateResults: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const thresholds = await getActiveThresholds();
      const results = await prisma.result.findMany();
      let updatedCount = 0;

      for (const r of results) {
        const { category } = classifyScore(r.percentage, thresholds);
        if (r.performanceCategory !== category) {
          await prisma.result.update({
            where: { id: r.id },
            data: { performanceCategory: category }
          });
          updatedCount++;
        }
      }

      return res.status(200).json({
        success: true,
        message: `Recalculation complete. ${updatedCount} out of ${results.length} records updated to current thresholds.`,
        totalResults: results.length,
        updatedCount
      });
    } catch (error) {
      next(error);
    }
  }
};

