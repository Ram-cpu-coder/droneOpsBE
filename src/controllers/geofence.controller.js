import { prisma } from "../config/prisma.js";
import { z } from "zod";
import { AppError } from "../utils/AppError.js";
import { getSocketServer } from "../sockets/index.js";
import { writeAudit } from "../services/audit.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";
import { getGovernmentAirspaceStatus, syncGovernmentAirspace } from "../services/governmentAirspace.service.js";

export const list = asyncHandler(async (req, res) => {
  const source = z.enum(["MANUAL", "GOVERNMENT"]).optional().parse(req.query.source);
  const geofences = await prisma.geofence.findMany({
    where: { organisationId: req.user.organisationId, ...(source ? { source } : {}) },
    orderBy: [{ source: "asc" }, { updatedAt: "desc" }, { createdAt: "desc" }]
  });

  return ok(res, geofences);
});

const zoneSchema=z.object({name:z.string().trim().min(2).max(160),type:z.enum(["RESTRICTED","WARNING","ADVISORY"]),isActive:z.boolean().default(true),polygon:z.array(z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)])).min(3).max(500)}).strict();
const save=async(req,res)=>{
  const data=zoneSchema.parse(req.body);
  const signedArea = data.polygon.reduce((sum, point, index, points) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  if (Math.abs(signedArea) < 1e-10) throw new AppError("Draw a boundary with a non-zero area", 400, "INVALID_BOUNDARY");
  const organisationId=req.user.organisationId;
  const id=req.params.id?z.string().uuid().parse(req.params.id):null;
  const existing=id?await prisma.geofence.findFirst({where:{id,organisationId},select:{id:true,source:true}}):null;
  if(id&&!existing) throw new AppError("Geofence not found",404,"NOT_FOUND");
  if(existing?.source==="GOVERNMENT") throw new AppError("Government airspace restrictions are read-only. Sync them from the configured provider.",409,"GOVERNMENT_GEOFENCE_READ_ONLY");
  const geofence=id?await prisma.geofence.update({where:{id},data}):await prisma.geofence.create({data:{...data,organisationId}});
  await writeAudit({organisationId,actorId:req.user.id,action:id?"GEOFENCE_UPDATED":"GEOFENCE_CREATED",entityType:"GEOFENCE",entityId:geofence.id});
  getSocketServer()?.to(`organisation:${organisationId}`).emit("geofences:changed",{id:geofence.id});
  return (id?ok:created)(res,geofence,"Geofence saved");
};
export const create=asyncHandler(save);
export const update=asyncHandler(save);

export const remove = asyncHandler(async (req, res) => {
  const organisationId = req.user.organisationId;
  const id = z.string().uuid().parse(req.params.id);
  const geofence = await prisma.geofence.findFirst({ where: { id, organisationId }, select: { id: true, source: true } });
  if (!geofence) throw new AppError("Geofence not found", 404, "NOT_FOUND");
  if (geofence.source === "GOVERNMENT") throw new AppError("Government airspace restrictions are read-only. Disable the provider sync instead.", 409, "GOVERNMENT_GEOFENCE_READ_ONLY");

  await prisma.geofence.delete({ where: { id } });
  await writeAudit({ organisationId, actorId: req.user.id, action: "GEOFENCE_DELETED", entityType: "GEOFENCE", entityId: id });
  getSocketServer()?.to(`organisation:${organisationId}`).emit("geofences:changed", { id });
  return ok(res, { id }, "Geofence deleted");
});

export const governmentStatus = asyncHandler(async (req, res) => {
  return ok(res, await getGovernmentAirspaceStatus(req.user.organisationId));
});

export const syncGovernment = asyncHandler(async (req, res) => {
  const result = await syncGovernmentAirspace({ organisationId: req.user.organisationId });
  await writeAudit({
    organisationId: req.user.organisationId,
    actorId: req.user.id,
    action: "GOVERNMENT_AIRSPACE_SYNCED",
    entityType: "GEOFENCE",
    entityId: req.user.organisationId,
    metadata: result
  });
  getSocketServer()?.to(`organisation:${req.user.organisationId}`).emit("geofences:changed", result);
  return ok(res, result, "Government airspace restrictions synced");
});
