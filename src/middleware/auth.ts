import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/db';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    status: string;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ message: 'Authorization token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your_super_secret_jwt_key', async (err: any, decodedUser: any) => {
    if (err) {
      console.error("[Auth Middleware] JWT Verification Error:", err.message);
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    try {
      // Check database to ensure account has not been removed or deactivated by admin
      const dbUser = await prisma.user.findUnique({
        where: { id: decodedUser.id },
        select: { id: true, email: true, role: true, status: true }
      });

      if (!dbUser) {
        console.warn(`[Auth Middleware] User ${decodedUser.id} (${decodedUser.email}) no longer exists in database (removed by admin).`);
        return res.status(401).json({ message: 'Account no longer exists or was removed by administrator.' });
      }

      if (dbUser.status !== 'active') {
        console.warn(`[Auth Middleware] User ${decodedUser.id} account status is '${dbUser.status}'.`);
        return res.status(403).json({ message: 'Account is deactivated or pending administrator approval.' });
      }

      // Attach authoritative live database user to request
      req.user = dbUser;
      next();
    } catch (dbErr) {
      next(dbErr);
    }
  });
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: `Forbidden: Access restricted to [${allowedRoles.join(', ')}]` });
    }

    next();
  };
};
