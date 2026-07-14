import { AppError } from "../utils/AppError.js";

export const validate = (schema) => {
  return (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query
    });

    if (!result.success) {
      return next(new AppError("Validation failed", 400, "VALIDATION_ERROR", result.error.flatten()));
    }

    req.validated = result.data;
    return next();
  };
};
