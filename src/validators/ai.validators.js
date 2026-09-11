import { z } from "zod";

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000)
});

const confirmationSchema = z.object({
  toolName: z.string().trim().min(1),
  arguments: z.record(z.unknown())
});

export const aiChatSchema = z.object({
  body: z.object({
    message: z.string().trim().min(1).max(4000),
    history: z.array(chatMessageSchema).max(12).optional(),
    confirmation: confirmationSchema.optional()
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional()
});
