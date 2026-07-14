import bcrypt from "bcryptjs";
import { env } from "../config/env.js";

export const hashPassword = async (password) => {
  return bcrypt.hash(password, env.bcryptRounds);
};

export const comparePassword = async (password, passwordHash) => {
  return bcrypt.compare(password, passwordHash);
};
