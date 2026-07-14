import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { authRateLimiter, uploadRateLimiter } from "../middleware/rateLimiters.js";
import { uploadSingleImage } from "../middleware/upload.js";
import { validate } from "../middleware/validate.js";
import {
  googleCompleteProfileSchema,
  googleLoginSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  refreshTokenSchema,
  signupSchema
} from "../validators/auth.validators.js";

export const authRouter = Router();

authRouter.post("/signup", authRateLimiter, validate(signupSchema), authController.signup);
authRouter.post("/login", authRateLimiter, validate(loginSchema), authController.login);
authRouter.post("/google", authRateLimiter, validate(googleLoginSchema), authController.googleLogin);
authRouter.post("/google/complete-profile", authRateLimiter, validate(googleCompleteProfileSchema), authController.completeGoogleProfile);
authRouter.post("/profile-image", uploadRateLimiter, uploadSingleImage, authController.uploadProfileImage);
authRouter.post("/refresh-token", validate(refreshTokenSchema), authController.refreshToken);
authRouter.get("/verify/:token", authController.verifyEmail);
authRouter.get("/verify-email-change/:token", authController.verifyEmailChange);
authRouter.post("/forgot-password", authRateLimiter, validate(passwordResetRequestSchema), authController.requestPasswordReset);
authRouter.get("/reset-password/:token", authController.showPasswordReset);
authRouter.post("/reset-password/:token", authRateLimiter, validate(passwordResetSchema), authController.resetPassword);
authRouter.post("/logout", requireAuth, authController.logout);
