import { env } from "../config/env.js";
import { ZodError } from "zod";

export const notFoundHandler = (req, _res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  error.code = "ROUTE_NOT_FOUND";
  next(error);
};

export const errorHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ success: false, message: "Please check the submitted fields", code: "VALIDATION_ERROR", details: error.flatten() });
  }
  const statusCode = error.statusCode ?? 500;
  const payload = {
    success: false,
    message: statusCode === 500 ? "Internal server error" : error.message,
    code: error.code ?? "INTERNAL_ERROR",
    details: error.details
  };

  if (env.nodeEnv === "development") {
    payload.stack = error.stack;
  }

  return res.status(statusCode).json(payload);
};
