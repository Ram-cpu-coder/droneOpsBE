import { Server } from "socket.io";
import { env } from "../config/env.js";

let io;

export const attachSocketServer = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigins,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    socket.on("mission:join", (missionId) => {
      socket.join(`mission:${missionId}`);
    });

    socket.on("drone:join", (droneId) => {
      socket.join(`drone:${droneId}`);
    });
  });

  return io;
};

export const getSocketServer = () => io;

export const publishTelemetry = (telemetry) => {
  if (!io) return;

  io.to(`drone:${telemetry.droneId}`).emit("telemetry:update", telemetry);
  if (telemetry.missionId) {
    io.to(`mission:${telemetry.missionId}`).emit("telemetry:update", telemetry);
  }
  io.emit("operations:telemetry", telemetry);
};

export const publishAlert = (alert) => {
  if (!io) return;
  io.emit("operations:alert", alert);
};

export const publishActivity = (activity) => {
  if (!io) return;
  io.emit("operations:activity", activity);
};
