import { Router } from "express";
import { auditRouter } from "./audit.routes.js";
import { authRouter } from "./auth.routes.js";
import { droneRouter } from "./drone.routes.js";
import { healthRouter } from "./health.routes.js";
import { settingsRouter } from "./settings.routes.js";
import { telemetryRouter } from "./telemetry.routes.js";
import { userRouter } from "./user.routes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/users", userRouter);
apiRouter.use("/audit", auditRouter);
apiRouter.use("/settings", settingsRouter);
apiRouter.use("/drones", droneRouter);
apiRouter.use("/telemetry", telemetryRouter);
