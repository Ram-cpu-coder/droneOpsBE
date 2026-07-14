import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiRouter } from "./routes/index.js";

export const createApp = () => {
  const app = express();
  const isLocalDevOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  const isFileDevOrigin = (origin) => origin === "null" || origin?.startsWith("file://");

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(compression());
  app.use(cors({
    origin(origin, callback) {
      const isAllowedDevOrigin = env.nodeEnv !== "production" && (isLocalDevOrigin(origin) || isFileDevOrigin(origin));
      if (!origin || env.clientOrigins.includes(origin) || isAllowedDevOrigin) {
        return callback(null, true);
      }

      const error = new Error("Not allowed by CORS");
      error.statusCode = 403;
      error.code = "CORS_BLOCKED";
      return callback(error);
    },
    credentials: true
  }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
  app.use("/uploads", express.static(path.resolve(env.uploadDir)));

  app.use(env.apiPrefix, apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
