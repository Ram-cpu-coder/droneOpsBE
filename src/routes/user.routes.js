import { Router } from "express";
import * as userController from "../controllers/user.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.put("/me", userController.updateMe);
userRouter.get("/", requirePermission("*"), userController.list);
userRouter.put("/:id", requirePermission("*"), userController.update);
userRouter.delete("/:id", requirePermission("*"), userController.remove);
