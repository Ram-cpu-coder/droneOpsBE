import dotenv from "dotenv";

dotenv.config();

["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].forEach((key) => {
  if (process.env[key] === "http://127.0.0.1:9") {
    delete process.env[key];
  }
});

const requiredInProduction = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];

if (process.env.NODE_ENV === "production") {
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5000),
  apiPrefix: process.env.API_PREFIX ?? "/api/v1",
  clientOrigins: (process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5178,http://localhost:5178")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  clientPublicUrl: process.env.CLIENT_PUBLIC_URL ?? "http://127.0.0.1:5173",
  databaseUrl: process.env.DATABASE_URL,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me",
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
  telemetryTimeoutSeconds: Number(process.env.TELEMETRY_TIMEOUT_SECONDS ?? 5),
  lowBatteryThreshold: Number(process.env.LOW_BATTERY_THRESHOLD ?? 20),
  telemetryDefaultIntervalSeconds: Number(process.env.TELEMETRY_DEFAULT_INTERVAL_SECONDS ?? 2),
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  brevoSmtpHost: process.env.BREVO_SMTP_HOST ?? "smtp-relay.brevo.com",
  brevoSmtpPort: Number(process.env.BREVO_SMTP_PORT ?? 587),
  brevoSmtpUser: process.env.BREVO_SMTP_USER,
  brevoSmtpPass: process.env.BREVO_SMTP_PASS,
  mailFrom: process.env.MAIL_FROM ?? "DroneOps <no-reply@droneops.local>",
  apiPublicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${Number(process.env.PORT ?? 5000)}${process.env.API_PREFIX ?? "/api/v1"}`,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  connectorWorkerEnabled: process.env.CONNECTOR_WORKER_ENABLED === "true",
  connectorPollIntervalMs: Number(process.env.CONNECTOR_POLL_INTERVAL_MS ?? 5000),
  genericTelemetryApiKey: process.env.GENERIC_TELEMETRY_API_KEY
};
