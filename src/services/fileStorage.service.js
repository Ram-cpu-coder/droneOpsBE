import fs from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

const isCloudinaryConfigured = () => Boolean(env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret);

if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret
  });
}

export const storeUploadedFile = async (file, context = {}) => {
  if (isCloudinaryConfigured()) {
    return uploadToCloudinary(file, context);
  }

  return saveLocally(file, context);
};

const uploadToCloudinary = async (file, context) => {
  const folder = buildCloudinaryFolder(context);
  const resourceType = file.mimetype.startsWith("image/")
    ? "image"
    : file.mimetype.startsWith("video/")
      ? "video"
      : "raw";
  const originalFilename = toSafeFilename(file.originalname || "attachment");
  const uploadOptions = {
    folder,
    resource_type: resourceType,
    type: context.access === "authenticated" ? "authenticated" : "upload",
    use_filename: true,
    unique_filename: true,
    filename_override: originalFilename
  };

  if (resourceType === "raw") {
    uploadOptions.public_id = `${Date.now()}-${originalFilename}`;
    uploadOptions.unique_filename = false;
  }

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, uploadResult) => {
        if (error) return reject(error);
        return resolve(uploadResult);
      }
    );

    stream.end(file.buffer);
  });

  return {
    fileUrl: context.access === "authenticated"
      ? cloudinary.url(result.public_id, { resource_type: result.resource_type, type: "authenticated", sign_url: true, secure: true })
      : result.secure_url,
    storageProvider: "cloudinary",
    publicId: result.public_id,
    resourceType: result.resource_type,
    bytes: result.bytes
  };
};

const saveLocally = async (file, context) => {
  const uploadRoot = path.resolve(env.uploadDir, ...buildStorageSegments(context));
  await fs.mkdir(uploadRoot, { recursive: true });

  const safeName = toSafeFilename(file.originalname);
  const filename = `${Date.now()}-${safeName}`;
  const filepath = path.join(uploadRoot, filename);

  await fs.writeFile(filepath, file.buffer);
  const publicBaseUrl = env.apiPublicUrl.replace(/\/api\/v\d+\/?$/, "");
  const publicPath = [...buildStorageSegments(context), filename].map(encodeURIComponent).join("/");

  return {
    fileUrl: `${publicBaseUrl}/uploads/${publicPath}`,
    storageProvider: "local",
    publicId: publicPath,
    resourceType: file.mimetype,
    bytes: file.size
  };
};

const buildCloudinaryFolder = (context) => {
  return ["droneops", ...buildStorageSegments(context)].filter(Boolean).join("/");
};

const buildStorageSegments = ({ organisationId, entityType, entityCode, entityId, subfolder } = {}) => (
  [organisationId, entityType, entityCode ?? entityId, subfolder]
    .filter(Boolean)
    .map(toSafeStorageSegment)
);

const toSafeStorageSegment = (value) => (
  value
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
);

const toSafeFilename = (value = "attachment") => (
  value
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "attachment"
);
