import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { noContent, ok } from "../utils/apiResponse.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/audit.service.js";
import * as userService from "../services/user.service.js";

const allowedRoles = new Set([
  "OPERATIONS_MANAGER",
  "REMOTE_PILOT",
  "MAINTENANCE_COORDINATOR",
  "SAFETY_OFFICER",
  "COMPLIANCE_OFFICER",
  "SYSTEM_ADMINISTRATOR"
]);

export const list = asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    // Keep user directories tenant-scoped so one organisation never sees another
    // organisation's accounts in management screens or assignment dropdowns.
    where: {
      organisationId: req.user.organisationId
    },
    select: userService.userSelect,
    orderBy: { createdAt: "desc" }
  });
  return ok(res, users);
});

export const updateMe = asyncHandler(async (req, res) => {
  const result = await userService.updateOwnProfile({
    actor: req.user,
    payload: req.body
  });

  return ok(
    res,
    {
      ...result.user,
      emailChangePending: result.emailChangePending
    },
    result.emailChangePending ? "Email change verification sent to current email" : "Profile updated"
  );
});

export const update = asyncHandler(async (req, res) => {
  const { name, email, role, profileImageUrl, isVerified } = req.body;
  const data = {};

  if (name !== undefined) data.name = name?.trim();
  if (email !== undefined) data.email = email?.trim().toLowerCase();
  if (profileImageUrl !== undefined) data.profileImageUrl = profileImageUrl?.trim() || null;
  if (isVerified !== undefined) data.isVerified = Boolean(isVerified);
  if (role !== undefined) {
    if (!allowedRoles.has(role)) {
      throw new AppError("Selected role is not valid", 400, "INVALID_ROLE");
    }
    data.role = role;
  }

  if (!data.name && name !== undefined) throw new AppError("Name is required", 400, "NAME_REQUIRED");
  if (!data.email && email !== undefined) throw new AppError("Email is required", 400, "EMAIL_REQUIRED");

  try {
    const existingUser = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organisationId: req.user.organisationId
      },
      select: { id: true }
    });

    if (!existingUser) throw new AppError("User not found", 404, "USER_NOT_FOUND");

    const user = await prisma.user.update({
      where: { id: existingUser.id },
      data,
      select: userService.userSelect
    });

    await writeAudit({
      organisationId: req.user.organisationId,
      actorId: req.user.id,
      action: "USER_UPDATED",
      entityType: "USER",
      entityId: user.id,
      metadata: {
        name: user.name,
        email: user.email,
        role: user.role,
        fields: Object.keys(data)
      }
    });

    return ok(res, user, "User updated");
  } catch (error) {
    if (error.code === "P2025") throw new AppError("User not found", 404, "USER_NOT_FOUND");
    if (error.code === "P2002") throw new AppError("Email is already used by another account", 409, "EMAIL_EXISTS");
    throw error;
  }
});

export const remove = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    throw new AppError("You cannot delete your own active account", 400, "SELF_DELETE_BLOCKED");
  }

  try {
    const existingUser = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        organisationId: req.user.organisationId
      },
      select: { id: true }
    });

    if (!existingUser) throw new AppError("User not found", 404, "USER_NOT_FOUND");

    const user = await prisma.user.delete({
      where: { id: existingUser.id },
      select: userService.userSelect
    });

    await writeAudit({
      organisationId: req.user.organisationId,
      actorId: req.user.id,
      action: "USER_DELETED",
      entityType: "USER",
      entityId: user.id,
      metadata: {
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

    return noContent(res);
  } catch (error) {
    if (error.code === "P2025") throw new AppError("User not found", 404, "USER_NOT_FOUND");
    if (error.code === "P2003") {
      throw new AppError("This user has linked operational records. Update their role or access instead of deleting.", 409, "USER_HAS_RECORDS");
    }
    throw error;
  }
});
