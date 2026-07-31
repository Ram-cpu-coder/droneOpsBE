import { Router } from "express";
import * as userController from "../controllers/user.controller.js";
import { requireAnyPermission, requireAuth, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { userMeUpdateSchema, userUpdateSchema } from "../validators/core.validators.js";

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.put("/me", validate(userMeUpdateSchema), userController.updateMe);
userRouter.get("/", requireAnyPermission(["*", "missions:manage"]), userController.list);
userRouter.put("/:id", requirePermission("*"), validate(userUpdateSchema), userController.update);
userRouter.delete("/:id", requirePermission("*"), userController.remove);
