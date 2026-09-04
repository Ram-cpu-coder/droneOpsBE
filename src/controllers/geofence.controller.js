import { prisma } from "../config/prisma.js";
import { z } from "zod";
import { AppError } from "../utils/AppError.js";
import { getSocketServer } from "../sockets/index.js";
import { writeAudit } from "../services/audit.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/apiResponse.js";

export const list = asyncHandler(async (req, res) => {
  const geofences = await prisma.geofence.findMany({
    where: { organisationId: req.user.organisationId },
    orderBy: { createdAt: "desc" }
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
  if(id&&!await prisma.geofence.findFirst({where:{id,organisationId},select:{id:true}})) throw new AppError("Geofence not found",404,"NOT_FOUND");
  const geofence=id?await prisma.geofence.update({where:{id},data}):await prisma.geofence.create({data:{...data,organisationId}});
  await writeAudit({organisationId,actorId:req.user.id,action:id?"GEOFENCE_UPDATED":"GEOFENCE_CREATED",entityType:"GEOFENCE",entityId:geofence.id});
  getSocketServer()?.to(`organisation:${organisationId}`).emit("geofences:changed",{id:geofence.id});
  return (id?ok:created)(res,geofence,"Geofence saved");
};
export const create=asyncHandler(save);
export const update=asyncHandler(save);
