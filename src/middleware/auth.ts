import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import DatabaseManager from "../config/database";
import UserService from "../services/UserService";
import { JWTPayload, UserRole, UserStatus } from "../types";

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: UserRole;
        status: UserStatus;
      };
    }
  }
}

// JWT verification middleware
export const verifyToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access token required",
      });
    }

    const tokenValue = token.startsWith("Bearer ") ? token.slice(7) : token;
    const JWT_SECRET =
      process.env.JWT_SECRET ||
      "your-super-secret-jwt-key-change-in-production";

    const decoded = jwt.verify(tokenValue, JWT_SECRET) as JWTPayload;

    // Get fresh user data from database
    const db = DatabaseManager.getInstance().getDatabase();
    const userCollection = db.collection("user");

    const user = await userCollection.findOne(
      { _id: new ObjectId(decoded.userId) },
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      return res.status(403).json({
        success: false,
        message: "Account is blocked. Contact administrator.",
      });
    }

    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      email: user.email,
      role: user.role,
      status: user.status,
    };

    // Log login activity (only once per session)
    const userService = UserService.getInstance();
    await userService.logActivity(
      decoded.userId,
      "api_access",
      {
        endpoint: req.path,
        method: req.method,
        userAgent: req.get("User-Agent") || "unknown",
      },
      req.ip,
      req.get("User-Agent")
    );

    next();
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

// Role-based access control middleware
export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${allowedRoles.join(", ")}`,
        userRole: req.user.role,
      });
    }

    next();
  };
};

// Admin only middleware
export const requireAdmin = requireRole([UserRole.ADMIN]);

// Admin or Volunteer middleware
export const requireAdminOrVolunteer = requireRole([
  UserRole.ADMIN,
  UserRole.VOLUNTEER,
]);

// Any authenticated user middleware
export const requireAuth = requireRole([
  UserRole.ADMIN,
  UserRole.VOLUNTEER,
  UserRole.DONOR,
]);

// Permission-based access control
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const userPermissions = getUserPermissions(req.user.role);

    if (!userPermissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required permission: ${permission}`,
        userRole: req.user.role,
        userPermissions,
      });
    }

    next();
  };
};

// Resource ownership middleware
export const requireOwnership = (resourceUserIdField: string = "userId") => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Admins can access any resource
    if (req.user.role === UserRole.ADMIN) {
      return next();
    }

    // Check if user owns the resource
    const resourceUserId =
      req.params[resourceUserIdField] || req.body[resourceUserIdField];

    if (resourceUserId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only access your own resources.",
      });
    }

    next();
  };
};

// Rate limiting by user role
export const roleBasedRateLimit = () => {
  const rateLimits = {
    [UserRole.ADMIN]: { windowMs: 15 * 60 * 1000, max: 1000 }, // 1000 requests per 15 minutes
    [UserRole.VOLUNTEER]: { windowMs: 15 * 60 * 1000, max: 500 }, // 500 requests per 15 minutes
    [UserRole.DONOR]: { windowMs: 15 * 60 * 1000, max: 200 }, // 200 requests per 15 minutes
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(); // Let other middleware handle authentication
    }

    const userLimit = rateLimits[req.user.role];
    const key = `rate_limit:${req.user.userId}`;

    // This would integrate with Redis for actual rate limiting
    // For now, just pass through
    next();
  };
};

// Audit logging middleware
export const auditLog = (action: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next();
    }

    const userService = UserService.getInstance();

    // Log the action
    await userService.logActivity(
      req.user.userId,
      action,
      {
        endpoint: req.path,
        method: req.method,
        params: req.params,
        query: req.query,
        body: sanitizeBody(req.body), // Remove sensitive data
        userAgent: req.get("User-Agent") || "unknown",
      },
      req.ip,
      req.get("User-Agent")
    );

    next();
  };
};

// Suspicious activity detection middleware
export const detectSuspiciousActivity = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next();
    }

    try {
      const db = DatabaseManager.getInstance().getDatabase();
      const activityLogCollection = db.collection("activityLog");

      // Check for suspicious patterns in the last hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const recentActivities = await activityLogCollection
        .find({
          userId: req.user.userId,
          timestamp: { $gte: oneHourAgo },
        })
        .toArray();

      // Detect suspicious patterns
      const suspiciousPatterns = [
        // Too many failed login attempts
        recentActivities.filter((a) => a.action === "login_failed").length > 5,

        // Too many API calls
        recentActivities.length > 100,

        // Multiple IP addresses
        new Set(recentActivities.map((a) => a.ipAddress)).size > 3,

        // Unusual user agent patterns
        recentActivities.some(
          (a) =>
            a.userAgent.includes("bot") ||
            a.userAgent.includes("crawler") ||
            a.userAgent.includes("spider")
        ),
      ];

      if (suspiciousPatterns.some((pattern) => pattern)) {
        // Log suspicious activity
        const userService = UserService.getInstance();
        await userService.logActivity(
          req.user.userId,
          "suspicious_activity_detected",
          {
            patterns: suspiciousPatterns,
            recentActivityCount: recentActivities.length,
            uniqueIPs: new Set(recentActivities.map((a) => a.ipAddress)).size,
            endpoint: req.path,
            method: req.method,
          },
          req.ip,
          req.get("User-Agent")
        );

        // For now, just log. In production, you might want to:
        // - Temporarily lock the account
        // - Require additional authentication
        // - Notify administrators
        console.warn(
          `🚨 Suspicious activity detected for user ${req.user.userId}`
        );
      }

      next();
    } catch (error) {
      console.error("Suspicious activity detection error:", error);
      next(); // Don't block the request if detection fails
    }
  };
};

// Helper function to get user permissions based on role
function getUserPermissions(role: UserRole): string[] {
  const permissions = {
    [UserRole.ADMIN]: [
      "user:read",
      "user:write",
      "user:delete",
      "user:manage_roles",
      "user:manage_status",
      "request:read",
      "request:write",
      "request:delete",
      "request:manage",
      "analytics:read",
      "analytics:export",
      "content:read",
      "content:write",
      "content:publish",
      "content:delete",
      "system:configure",
      "system:monitor",
    ],
    [UserRole.VOLUNTEER]: [
      "user:read",
      "request:read",
      "request:write",
      "request:manage",
      "analytics:read",
      "content:read",
    ],
    [UserRole.DONOR]: [
      "user:read_own",
      "user:write_own",
      "request:read",
      "request:write_own",
      "request:delete_own",
    ],
  };

  return permissions[role] || [];
}

// Helper function to sanitize request body for logging
function sanitizeBody(body: any): any {
  if (!body || typeof body !== "object") {
    return body;
  }

  const sensitiveFields = ["password", "token", "secret", "key", "auth"];
  const sanitized = { ...body };

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  }

  return sanitized;
}

// Middleware to check if user can access specific resource
export const canAccessResource = (resourceType: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    try {
      const db = DatabaseManager.getInstance().getDatabase();
      const resourceId = req.params.id;

      // Admin can access everything
      if (req.user.role === UserRole.ADMIN) {
        return next();
      }

      // Check resource ownership based on type
      switch (resourceType) {
        case "blood_request":
          const request = await db
            .collection("request")
            .findOne({ _id: new ObjectId(resourceId) });
          if (!request) {
            return res
              .status(404)
              .json({ success: false, message: "Resource not found" });
          }

          // Volunteers can access all requests, donors only their own
          if (
            req.user.role === UserRole.VOLUNTEER ||
            request.requesterId.toString() === req.user.userId
          ) {
            return next();
          }
          break;

        case "user_profile":
          // Users can only access their own profile
          if (resourceId === req.user.userId) {
            return next();
          }
          break;

        default:
          return res.status(403).json({
            success: false,
            message: "Access denied",
          });
      }

      return res.status(403).json({
        success: false,
        message: "Access denied to this resource",
      });
    } catch (error) {
      console.error("Resource access check error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to check resource access",
      });
    }
  };
};
