import { AppError } from "../utils/AppError.js";

export const validate = (schema) => {
  return (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body ?? {},
      params: req.params,
      query: req.query
    });

    if (!result.success) {
      return next(new AppError("Validation failed", 400, "VALIDATION_ERROR", formatValidationError(result.error)));
    }

    req.validated = result.data;
    return next();
  };
};

const formatValidationError = (error) => {
  const details = {
    formErrors: [],
    fieldErrors: {}
  };

  error.issues.forEach((issue) => {
    const path = issue.path.filter((segment) => !["body", "params", "query"].includes(segment)).join(".");

    if (!path) {
      details.formErrors.push(issue.message);
      return;
    }

    details.fieldErrors[path] = [...(details.fieldErrors[path] ?? []), issue.message];
  });

  return details;
};
