import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { ok, created } from "../utils/apiResponse.js";
import { writeAudit } from "../services/audit.service.js";

export const operationsRouter = Router();
operationsRouter.use(requireAuth);
const date = z.string().datetime().nullable().optional();
const maintenanceSchema = z.object({
  droneId: z.string().uuid(), assignedToId: z.string().uuid().nullable().optional(),
  type: z.string().trim().min(2).max(120), triggerType: z.enum(["HOURS", "CALENDAR", "EVENT"]),
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"]),
  dueAt: date, notes: z.string().max(4000).optional(), correctiveAction: z.string().max(4000).optional()
}).strict();
const pilotSchema = z.object({
  certificationExpiry: date,
  licences: z.array(z.object({type:z.string().trim().min(1).max(60), number:z.string().trim().min(1).max(100), expiresAt:date}).strict()).max(20)
}).strict();
const audit = (req, action, entityType, entityId) => writeAudit({organisationId:req.user.organisationId,actorId:req.user.id,action,entityType,entityId});

operationsRouter.get("/pilots", requirePermission("pilots:read"), asyncHandler(async (req,res) => {
  const pilots = await prisma.user.findMany({where:{organisationId:req.user.organisationId,role:"REMOTE_PILOT"},select:{id:true,name:true,email:true,isVerified:true,pilotCredentials:true,profileImageUrl:true},orderBy:{name:"asc"}});
  return ok(res,pilots);
}));
operationsRouter.put("/pilots/:id/credentials", requirePermission("pilots:manage"), asyncHandler(async (req,res) => {
  const credentials=pilotSchema.parse(req.body);
  const pilot=await prisma.user.findFirst({where:{id:z.string().uuid().parse(req.params.id),organisationId:req.user.organisationId,role:"REMOTE_PILOT"},select:{id:true}});
  if(!pilot) throw new AppError("Pilot not found",404,"NOT_FOUND");
  const updated=await prisma.user.update({where:{id:pilot.id},data:{pilotCredentials:credentials},select:{id:true,name:true,email:true,isVerified:true,pilotCredentials:true,profileImageUrl:true}});
  await audit(req,"PILOT_CREDENTIALS_UPDATED","USER",pilot.id);
  return ok(res,updated,"Pilot credentials updated");
}));
operationsRouter.get("/maintenance", requirePermission("maintenance:read"), asyncHandler(async (req,res) => {
  return ok(res,await prisma.maintenanceRecord.findMany({where:{organisationId:req.user.organisationId},include:{drone:{select:{id:true,droneCode:true,status:true,flightHours:true,lastMaintenanceDate:true,nextMaintenanceDate:true}},assignedTo:{select:{id:true,name:true}}},orderBy:{createdAt:"desc"}}));
}));
const saveMaintenance = asyncHandler(async (req,res) => {
  const data=maintenanceSchema.parse(req.body);
  const organisationId=req.user.organisationId;
  const id=req.params.id ? z.string().uuid().parse(req.params.id) : null;
  const record=await prisma.$transaction(async tx=>{
    const drone=await tx.drone.findFirst({where:{id:data.droneId,organisationId}});
    if(!drone) throw new AppError("Drone not found",404,"NOT_FOUND");
    const previous=id?await tx.maintenanceRecord.findFirst({where:{id,organisationId}}):null;
    if(id&&!previous) throw new AppError("Maintenance record not found",404,"NOT_FOUND");
    if(previous&&previous.droneId!==data.droneId) throw new AppError("A maintenance record cannot be moved to another drone",409,"INVALID_DRONE");
    if(previous&&["COMPLETED","CANCELLED"].includes(previous.status)) throw new AppError("Closed maintenance records cannot be edited",409,"MAINTENANCE_CLOSED");
    if(data.assignedToId&&!await tx.user.findFirst({where:{id:data.assignedToId,organisationId},select:{id:true}})) throw new AppError("Assignee not found",404,"NOT_FOUND");
    if(["IN_PROGRESS","COMPLETED"].includes(data.status)&&drone.status==="IN_MISSION") throw new AppError("Finish the active flight before performing maintenance",409,"DRONE_IN_MISSION");
    if(data.status==="COMPLETED"&&!data.correctiveAction?.trim()) throw new AppError("Record the work performed before completing maintenance",400,"WORK_REQUIRED");
    const completionDate = data.status === "COMPLETED" ? new Date() : null;
    const payload={...data,completedAt:completionDate};
    const saved=id?await tx.maintenanceRecord.update({where:{id},data:payload}):await tx.maintenanceRecord.create({data:{...payload,organisationId}});
    if(data.status==="IN_PROGRESS") await tx.drone.update({where:{id:drone.id},data:{status:"MAINTENANCE"}});
    if(data.status==="COMPLETED") await tx.drone.update({where:{id:drone.id},data:{lastMaintenanceDate:completionDate}});
    return tx.maintenanceRecord.findUnique({where:{id:saved.id},include:{drone:{select:{id:true,droneCode:true,status:true,flightHours:true}},assignedTo:{select:{id:true,name:true}}}});
  }, { isolationLevel: "Serializable" });
  await audit(req,id?"MAINTENANCE_UPDATED":"MAINTENANCE_CREATED","MAINTENANCE",record.id);
  return (id?ok:created)(res,record,"Maintenance saved");
});
operationsRouter.post("/maintenance",requirePermission("maintenance:manage"),saveMaintenance);
operationsRouter.put("/maintenance/:id",requirePermission("maintenance:manage"),saveMaintenance);

operationsRouter.post("/maintenance/:id/release", requirePermission("maintenance:manage"), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const organisationId = req.user.organisationId;
  const drone = await prisma.$transaction(async tx => {
    const record = await tx.maintenanceRecord.findFirst({ where: { id, organisationId }, include: { drone: true } });
    if (!record) throw new AppError("Maintenance record not found", 404, "NOT_FOUND");
    if (record.status !== "COMPLETED" || record.drone.status !== "MAINTENANCE") throw new AppError("Complete maintenance before returning the aircraft to service", 409, "NOT_READY");
    const pending = await tx.maintenanceRecord.count({ where: { droneId: record.droneId, status: { in: ["IN_PROGRESS", "OVERDUE"] } } });
    const overdue = await tx.maintenanceRecord.count({ where: { droneId: record.droneId, status: "SCHEDULED", dueAt: { lte: new Date() } } });
    const defects = await tx.defect.count({ where: { droneId: record.droneId, status: { notIn: ["CLOSED", "RESOLVED"] } } });
    if (pending || overdue || defects) throw new AppError("Resolve outstanding maintenance and defects before return to service", 409, "OUTSTANDING_WORK");
    if (record.drone.certificationStatus !== "CERTIFIED" || (record.drone.certificationExpiry && record.drone.certificationExpiry <= new Date())) throw new AppError("Current aircraft certification is required", 409, "CERTIFICATION_REQUIRED");
    return tx.drone.update({ where: { id: record.droneId }, data: { status: "AVAILABLE" }, select: { id: true, droneCode: true, status: true } });
  }, { isolationLevel: "Serializable" });
  await audit(req, "DRONE_RETURNED_TO_SERVICE", "DRONE", drone.id);
  return ok(res, drone, "Drone returned to service");
}));
