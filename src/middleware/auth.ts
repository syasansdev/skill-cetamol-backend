import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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
  console.log("[Auth Middleware] Authorization Header:", authHeader);

  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>
  console.log("[Auth Middleware] Extracted Token:", token);

  if (!token) {
    console.warn("[Auth Middleware] No token found in Authorization header");
    return res.status(401).json({ message: 'Authorization token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your_super_secret_jwt_key', (err: any, user: any) => {
    if (err) {
      console.error("[Auth Middleware] JWT Verification Error:", err.message);
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    console.log("[Auth Middleware] Decoded User:", user);
    // Attach user to request
    req.user = user;
    next();
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
