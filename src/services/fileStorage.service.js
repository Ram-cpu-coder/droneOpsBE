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

  return saveLocally(file);
};

const uploadToCloudinary = async (file, context) => {
  const folder = buildCloudinaryFolder(context);
  const resourceType = file.mimetype.startsWith("image/") ? "image" : "raw";

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true
      },
      (error, uploadResult) => {
        if (error) return reject(error);
        return resolve(uploadResult);
      }
    );

    stream.end(file.buffer);
  });

  return {
    fileUrl: result.secure_url,
    storageProvider: "cloudinary",
    publicId: result.public_id,
    resourceType: result.resource_type,
    bytes: result.bytes
  };
};

const saveLocally = async (file) => {
  const uploadRoot = path.resolve(env.uploadDir);
  await fs.mkdir(uploadRoot, { recursive: true });

  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${Date.now()}-${safeName}`;
  const filepath = path.join(uploadRoot, filename);

  await fs.writeFile(filepath, file.buffer);
  const publicBaseUrl = env.apiPublicUrl.replace(/\/api\/v\d+\/?$/, "");

  return {
    fileUrl: `${publicBaseUrl}/uploads/${filename}`,
    storageProvider: "local",
    publicId: filename,
    resourceType: file.mimetype,
    bytes: file.size
  };
};

const buildCloudinaryFolder = ({ organisationId, entityType }) => {
  return ["droneops", organisationId, entityType].filter(Boolean).join("/");
};
