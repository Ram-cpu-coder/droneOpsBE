import { prisma } from "../config/prisma.js";
import { hasPermission } from "../constants/roles.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyAccessToken } from "../utils/tokens.js";

const getBearerToken = (req) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
};

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = getBearerToken(req);
  if (!token) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new AppError("jwt expired", 401, "JWT_EXPIRED");
    }
    throw new AppError("Invalid token", 401, "INVALID_TOKEN");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      organisationId: true,
      name: true,
      email: true,
      role: true,
      isVerified: true
    }
  });

  if (!user) throw new AppError("Invalid session", 401, "INVALID_SESSION");
  if (!user.isVerified) throw new AppError("Email verification required", 403, "EMAIL_NOT_VERIFIED");

  req.user = user;
  next();
});

export const requirePermission = (permission) => {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError("Authentication required", 401, "AUTH_REQUIRED"));
    if (!hasPermission(req.user.role, permission)) {
      return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
    }
    return next();
  };
};

export const requireAnyPermission = (permissions) => {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError("Authentication required", 401, "AUTH_REQUIRED"));
    if (!permissions.some((permission) => hasPermission(req.user.role, permission))) {
      return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
    }
    return next();
  };
};
