import { prisma } from "../config/prisma.js";
import { sendEmailChangeVerificationEmail } from "./email.service.js";
import { writeAudit } from "./audit.service.js";
import { AppError } from "../utils/AppError.js";
import { createOneTimeToken } from "../utils/oneTimeTokens.js";

export const userSelect = {
  id: true,
  organisation: {
    select: {
      id: true,
      name: true
    }
  },
  name: true,
  email: true,
  role: true,
  profileImageUrl: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true
};

export const updateOwnProfile = async ({ actor, payload }) => {
  const requestedEmail = payload.email?.trim().toLowerCase();
  const data = {};

  if (payload.name !== undefined) data.name = payload.name?.trim();
  if (payload.profileImageUrl !== undefined) data.profileImageUrl = payload.profileImageUrl?.trim() || null;

  if (!data.name && payload.name !== undefined) throw new AppError("Name is required", 400, "NAME_REQUIRED");
  if (!requestedEmail && payload.email !== undefined) throw new AppError("Email is required", 400, "EMAIL_REQUIRED");

  const currentUser = await prisma.user.findUnique({
    where: { id: actor.id },
    select: {
      ...userSelect,
      organisationId: true
    }
  });
  if (!currentUser) throw new AppError("Invalid session", 401, "INVALID_SESSION");

  const emailChange = requestedEmail && requestedEmail !== currentUser.email.toLowerCase()
    ? await prepareEmailChange({ actor, currentUser, requestedEmail })
    : null;

  if (emailChange) {
    data.pendingEmail = emailChange.pendingEmail;
    data.emailChangeToken = emailChange.tokenHash;
  }

  const updatedUser = await prisma.user.update({
    where: { id: actor.id },
    data,
    select: {
      ...userSelect,
      pendingEmail: true
    }
  });

  const emailStatus = emailChange
    ? await sendPendingEmailChange({
        currentUser,
        pendingEmail: emailChange.pendingEmail,
        token: emailChange.token
      })
    : null;

  await writeAudit({
    organisationId: actor.organisationId,
    actorId: actor.id,
    action: emailChange ? "USER_EMAIL_CHANGE_REQUESTED" : "USER_PROFILE_UPDATED",
    entityType: "USER",
    entityId: updatedUser.id,
    metadata: {
      name: updatedUser.name,
      email: updatedUser.email,
      pendingEmail: updatedUser.pendingEmail,
      fields: Object.keys(data)
    }
  });

  const { pendingEmail, ...safeUser } = updatedUser;
  return {
    user: safeUser,
    emailChangePending: emailChange
      ? {
          currentEmail: currentUser.email,
          pendingEmail: emailChange.pendingEmail,
          emailSent: Boolean(emailStatus?.sent)
        }
      : null
  };
};

const prepareEmailChange = async ({ actor, currentUser, requestedEmail }) => {
  // A user must control the current verified address before moving account ownership to a new email.
  if (!currentUser.isVerified) {
    throw new AppError("Verify your current email before changing it", 403, "CURRENT_EMAIL_NOT_VERIFIED");
  }

  const existingEmail = await prisma.user.findUnique({
    where: { email: requestedEmail },
    select: { id: true }
  });
  if (existingEmail && existingEmail.id !== actor.id) {
    throw new AppError("Email is already used by another account", 409, "EMAIL_EXISTS");
  }

  const { token, tokenHash } = createOneTimeToken();
  return {
    pendingEmail: requestedEmail,
    token,
    tokenHash
  };
};

const sendPendingEmailChange = async ({ currentUser, pendingEmail, token }) => {
  try {
    return await sendEmailChangeVerificationEmail({
      user: currentUser,
      pendingEmail,
      emailChangeToken: token
    });
  } catch (error) {
    console.warn(`[mail] Email change verification failed for ${currentUser.email}: ${error.message}`);
    return { sent: false, error: error.message };
  }
};
