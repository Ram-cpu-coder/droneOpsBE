import crypto from "node:crypto";

export const createOneTimeToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashOneTimeToken(token)
  };
};

export const hashOneTimeToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};
