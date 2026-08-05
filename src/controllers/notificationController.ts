import { Response, NextFunction } from 'express';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth';

export const NotificationController = {
  // Retrieve all notifications for the logged-in user
  getNotifications: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      const notifications = await prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' }
      });

      return res.status(200).json(notifications);
    } catch (error) {
      next(error);
    }
  },

  // Mark a single notification as read
  markAsRead: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      const { id } = req.params;

      // Verify the notification exists and belongs to the user
      const notification = await prisma.notification.findUnique({
        where: { id }
      });

      if (!notification) {
        return res.status(404).json({ message: 'Notification not found' });
      }

      if (notification.userId !== req.user.id) {
        return res.status(403).json({ message: 'Forbidden: Access restricted to notification owner' });
      }

      const updated = await prisma.notification.update({
        where: { id },
        data: { read: true }
      });

      return res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  },

  // Mark all notifications for the user as read
  markAllAsRead: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      await prisma.notification.updateMany({
        where: { userId: req.user.id, read: false },
        data: { read: true }
      });

      return res.status(200).json({ message: 'All notifications marked as read' });
    } catch (error) {
      next(error);
    }
  },

  // Delete a notification
  deleteNotification: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      const { id } = req.params;

      // Verify the notification exists and belongs to the user
      const notification = await prisma.notification.findUnique({
        where: { id }
      });

      if (!notification) {
        return res.status(404).json({ message: 'Notification not found' });
      }

      if (notification.userId !== req.user.id) {
        return res.status(403).json({ message: 'Forbidden: Access restricted to notification owner' });
      }

      await prisma.notification.delete({
        where: { id }
      });

      return res.status(200).json({ message: 'Notification deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
};
