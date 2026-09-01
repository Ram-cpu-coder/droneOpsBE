import { Server } from "socket.io";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { verifyAccessToken } from "../utils/tokens.js";

let io;

const buildRoom = (type, id) => `${type}:${id}`;

export const attachSocketServer = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigins,
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        const error = new Error("Socket authentication required");
        error.data = { code: "SOCKET_AUTH_REQUIRED" };
        return next(error);
      }

      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, organisationId: true, role: true, isVerified: true }
      });

      if (!user?.isVerified) {
        const error = new Error("Socket authentication failed");
        error.data = { code: "SOCKET_AUTH_FAILED" };
        return next(error);
      }

      socket.data.user = user;
      return next();
    } catch {
      const error = new Error("Socket authentication failed");
      error.data = { code: "SOCKET_AUTH_FAILED" };
      return next(error);
    }
  });

  io.on("connection", (socket) => {
    const organisationId = socket.data.user.organisationId;
    socket.join(buildRoom("organisation", organisationId));

    socket.on("mission:join", async (missionId, ack) => {
      const mission = await prisma.mission.findFirst({
        where: { id: missionId, organisationId },
        select: { id: true }
      });

      if (!mission) {
        ack?.({ joined: false, code: "MISSION_ROOM_FORBIDDEN" });
        return;
      }

      socket.join(buildRoom("mission", mission.id));
      ack?.({ joined: true });
    });

    socket.on("drone:join", async (droneId, ack) => {
      const drone = await prisma.drone.findFirst({
        where: { id: droneId, organisationId },
        select: { id: true }
      });

      if (!drone) {
        ack?.({ joined: false, code: "DRONE_ROOM_FORBIDDEN" });
        return;
      }

      socket.join(buildRoom("drone", drone.id));
      ack?.({ joined: true });
    });
  });

  return io;
};

export const getSocketServer = () => io;

export const publishTelemetry = (telemetry) => {
  if (!io) return;

  io.to(buildRoom("drone", telemetry.droneId)).emit("telemetry:update", telemetry);
  if (telemetry.missionId) {
    io.to(buildRoom("mission", telemetry.missionId)).emit("telemetry:update", telemetry);
  }
  if (telemetry.organisationId) {
    io.to(buildRoom("organisation", telemetry.organisationId)).emit("operations:telemetry", telemetry);
  }
};

export const publishAlert = (alert) => {
  if (!io) return;
  if (alert.organisationId) {
    io.to(buildRoom("organisation", alert.organisationId)).emit("operations:alert", alert);
  }
};

export const publishActivity = (activity) => {
  if (!io) return;
  if (activity.organisationId) {
    io.to(buildRoom("organisation", activity.organisationId)).emit("operations:activity", activity);
  }
};
