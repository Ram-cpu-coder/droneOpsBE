import { Router } from "express";
import * as aiController from "../controllers/ai.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { aiRateLimiter } from "../middleware/rateLimiters.js";
import { validate } from "../middleware/validate.js";
import { aiChatSchema } from "../validators/ai.validators.js";

export const aiRouter = Router();

aiRouter.use(requireAuth);
aiRouter.get("/status", aiRateLimiter, aiController.status);
aiRouter.post("/chat", aiRateLimiter, validate(aiChatSchema), aiController.chat);
