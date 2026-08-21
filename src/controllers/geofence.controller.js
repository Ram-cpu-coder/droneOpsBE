import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const geofences = await prisma.geofence.findMany({
    where: { organisationId: req.user.organisationId },
    orderBy: { createdAt: "desc" }
  });

  return ok(res, geofences);
});

export const create = asyncHandler(async (req, res) => {
  const geofence = await prisma.geofence.create({
    data: {
      organisationId: req.user.organisationId,
      ...req.body
    }
  });

  return created(res, geofence, "Geofence created");
});
