import * as authService from "../services/auth.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, noContent, ok } from "../utils/apiResponse.js";
import { env } from "../config/env.js";
import { renderPasswordResetFormPage, renderPasswordResetResultPage } from "../templates/passwordResetPage.template.js";
import { renderVerificationPage } from "../templates/verificationPage.template.js";

export const signup = asyncHandler(async (req, res) => {
  const result = await authService.signup(req.validated.body);
  return created(res, result, "Signup created. Verify email before login.");
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.validated.body);
  return ok(res, result, "Login successful");
});

export const googleLogin = asyncHandler(async (req, res) => {
  const result = await authService.loginWithGoogle(req.validated.body);
  return ok(res, result, "Google login successful");
});

export const completeGoogleProfile = asyncHandler(async (req, res) => {
  const result = await authService.completeGoogleProfile(req.validated.body);
  return ok(res, result, "Google profile completed");
});

export const resolveOrganisationCode = asyncHandler(async (req, res) => {
  const result = await authService.resolveOrganisationJoinCode(req.validated.body.organisationJoinCode);
  return ok(res, result, "Organisation code resolved");
});

export const uploadProfileImage = asyncHandler(async (req, res) => {
  const result = await authService.uploadProfileImage(req.file);
  return created(res, result, "Profile image uploaded");
});

export const verifyEmail = asyncHandler(async (req, res, next) => {
  const wantsJson = req.query.format === "json";

  try {
    const user = await authService.verifyEmail(req.params.token);

    if (wantsJson) {
      return ok(res, user, "Email verified");
    }

    return res
      .status(200)
      .type("html")
      .send(renderVerificationPage({
        status: "success",
        title: "Email verified",
        message: "Your DroneOps account is ready. You can now sign in and continue managing fleet operations.",
        user,
        loginUrl: env.clientPublicUrl
      }));
  } catch (error) {
    if (wantsJson) return next(error);

    return res
      .status(error.statusCode ?? 400)
      .type("html")
      .send(renderVerificationPage({
        status: "error",
        title: "Link expired or invalid",
        message: "This verification link can no longer be used. Please return to DroneOps and request a new verification email.",
        loginUrl: env.clientPublicUrl
      }));
  }
});

export const verifyEmailChange = asyncHandler(async (req, res, next) => {
  const wantsJson = req.query.format === "json";

  try {
    const user = await authService.verifyEmailChange(req.params.token);

    if (wantsJson) {
      return ok(res, user, "Email changed");
    }

    return res
      .status(200)
      .type("html")
      .send(renderVerificationPage({
        status: "success",
        title: "Email changed",
        message: "Your DroneOps account email has been updated. Please sign in again with the new email address.",
        user,
        loginUrl: env.clientPublicUrl
      }));
  } catch (error) {
    if (wantsJson) return next(error);

    return res
      .status(error.statusCode ?? 400)
      .type("html")
      .send(renderVerificationPage({
        status: "error",
        title: "Email change failed",
        message: error.message || "This email change link can no longer be used.",
        loginUrl: env.clientPublicUrl
      }));
  }
});

export const requestPasswordReset = asyncHandler(async (req, res) => {
  const result = await authService.requestPasswordReset(req.validated.body);
  return ok(res, result, "If the account exists, a password reset link has been sent.");
});

export const showPasswordReset = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .type("html")
    .send(renderPasswordResetFormPage({ token: req.params.token }));
});

export const resetPassword = asyncHandler(async (req, res) => {
  const wantsJson = req.query.format === "json";

  try {
    await authService.resetPassword({
      token: req.validated.params.token,
      password: req.validated.body.password
    });

    if (wantsJson) {
      return ok(res, { success: true }, "Password updated");
    }

    return res
      .status(200)
      .type("html")
      .send(renderPasswordResetResultPage({
        success: true,
        title: "Password updated",
        message: "Your DroneOps password has been changed. You can now sign in with the new password.",
        loginUrl: env.clientPublicUrl
      }));
  } catch (error) {
    if (wantsJson) {
      throw error;
    }

    return res
      .status(error.statusCode ?? 400)
      .type("html")
      .send(renderPasswordResetResultPage({
        success: false,
        title: "Reset link could not be used",
        message: error.message || "Please request a fresh password reset link from DroneOps.",
        loginUrl: env.clientPublicUrl
      }));
  }
});

export const refreshToken = asyncHandler(async (req, res) => {
  const result = await authService.refreshSession(req.validated.body.refreshToken);
  return ok(res, result, "Session refreshed");
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.id);
  return noContent(res);
});
