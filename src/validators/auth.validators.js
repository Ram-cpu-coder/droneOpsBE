import { z } from "zod";

const optionalUrl = z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().url().optional());

const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must include one uppercase letter")
  .regex(/[a-z]/, "Password must include one lowercase letter")
  .regex(/\d/, "Password must include one number")
  .regex(/[^A-Za-z0-9]/, "Password must include one special character");

export const signupSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: passwordSchema,
    organisationJoinCode: z.string().trim().min(4),
    industry: z.string().optional(),
    profileImageUrl: optionalUrl,
    role: z.enum([
      "OPERATIONS_MANAGER",
      "REMOTE_PILOT",
      "MAINTENANCE_COORDINATOR",
      "SAFETY_OFFICER",
      "COMPLIANCE_OFFICER"
    ]).default("OPERATIONS_MANAGER")
  }),
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
  body: z.object({
    credential: z.string().min(20),
    organisationJoinCode: z.string().trim().min(4),
    role: z.enum([
      "OPERATIONS_MANAGER",
      "REMOTE_PILOT",
      "MAINTENANCE_COORDINATOR",
      "SAFETY_OFFICER",
      "COMPLIANCE_OFFICER"
    ]).default("OPERATIONS_MANAGER")
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const organisationCodeSchema = z.object({
  body: z.object({
    organisationJoinCode: z.string().trim().min(4)
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1)
  }),
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
