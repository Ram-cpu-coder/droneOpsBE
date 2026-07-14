import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const signAccessToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      organisationId: user.organisationId,
      role: user.role
    },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpiresIn }
  );
};

export const signRefreshToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      organisationId: user.organisationId,
      type: "refresh"
    },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpiresIn }
  );
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.jwtAccessSecret);
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, env.jwtRefreshSecret);
};
