import { z } from "zod";

const optionalUrl = z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().url().optional());

const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must include one uppercase letter")
  .regex(/[a-z]/, "Password must include one lowercase letter")
  .regex(/\d/, "Password must include one number")
  .regex(/[^A-Za-z0-9]/, "Password must include one special character");

const roleAliases = {
  operations_manager: "OPERATIONS_MANAGER",
  remote_pilot: "REMOTE_PILOT",
  maintenance_coordinator: "MAINTENANCE_COORDINATOR",
  safety_officer: "SAFETY_OFFICER",
  compliance_officer: "COMPLIANCE_OFFICER",
  system_administrator: "SYSTEM_ADMINISTRATOR"
};

const normaliseOrganisationPayload = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const body = { ...value };

  if (!body.organisationMode && body.organizationMode) {
    body.organisationMode = body.organizationMode;
  }

  if (!body.organisationJoinCode && body.organizationCode) {
    body.organisationJoinCode = body.organizationCode;
  }

  if (!body.organisationName && body.organizationName) {
    body.organisationName = body.organizationName;
  }

  if (roleAliases[body.role]) {
    body.role = roleAliases[body.role];
  }

  return body;
};

const roleSchema = z.enum([
  "OPERATIONS_MANAGER",
  "REMOTE_PILOT",
  "MAINTENANCE_COORDINATOR",
  "SAFETY_OFFICER",
  "COMPLIANCE_OFFICER",
  "SYSTEM_ADMINISTRATOR"
]).default("OPERATIONS_MANAGER");

export const signupSchema = z.object({
  body: z.preprocess(normaliseOrganisationPayload, z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: passwordSchema,
    organisationMode: z.enum(["join", "create"]).default("join"),
    organisationJoinCode: z.string().trim().min(4).optional(),
    organisationName: z.string().trim().min(2).optional(),
    industry: z.string().optional(),
    profileImageUrl: optionalUrl,
    role: roleSchema
  }).superRefine(validateOrganisationAccessMode)),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const googleLoginSchema = z.object({
  body: z.object({
    credential: z.string().min(20)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const googleCompleteProfileSchema = z.object({
  body: z.preprocess(normaliseOrganisationPayload, z.object({
    credential: z.string().min(20),
    organisationMode: z.enum(["join", "create"]).default("join"),
    organisationJoinCode: z.string().trim().min(4).optional(),
    organisationName: z.string().trim().min(2).optional(),
    industry: z.string().optional(),
    role: roleSchema
  }).superRefine(validateOrganisationAccessMode)),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

function validateOrganisationAccessMode(data, ctx) {
  if (data.organisationMode === "create") {
    if (!data.organisationName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["organisationName"], message: "Organisation name is required" });
    }
    return;
  }

  if (!data.organisationJoinCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["organisationJoinCode"], message: "Organisation code is required" });
  }
}

export const organisationCodeSchema = z.object({
  body: z.object({
    organisationJoinCode: z.string().trim().min(4)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1).optional()
  }).optional().default({}),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const passwordResetRequestSchema = z.object({
  body: z.object({
    email: z.string().email()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const passwordResetSchema = z.object({
  body: z.object({
    password: passwordSchema,
    confirmPassword: passwordSchema
  }).refine((value) => value.password === value.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"]
  }),
  params: z.object({
    token: z.string().min(16)
  }),
  query: z.object({}).optional()
});
