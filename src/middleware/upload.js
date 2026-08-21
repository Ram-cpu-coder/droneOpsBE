import multer from "multer";
import { AppError } from "../utils/AppError.js";

const DOCUMENT_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const PROFILE_IMAGE_UPLOAD_LIMIT_BYTES = 3 * 1024 * 1024;
const allowedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedDocumentMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain"
]);
const allowedDocumentExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".mp4",
  ".mov",
  ".webm",
  ".pdf",
  ".doc",
  ".docx",
  ".txt"
]);

const fileFilter = (_req, file, cb) => {
  const fileExtension = getFileExtension(file.originalname);
  const isAllowed = allowedDocumentMimeTypes.has(file.mimetype) && allowedDocumentExtensions.has(fileExtension);

  if (!isAllowed) {
    return cb(new AppError("Unsupported evidence file type. Upload only photos, videos, PDF, Word, or text documents.", 415, "UNSUPPORTED_UPLOAD_TYPE"));
  }

  if (file.originalname.length > 180) {
    return cb(new AppError("File name is too long", 400, "UPLOAD_FILENAME_TOO_LONG"));
  }

  return cb(null, true);
};

const documentUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: DOCUMENT_UPLOAD_LIMIT_BYTES,
    files: 1,
    fields: 4,
    fieldSize: 8 * 1024
  }
}).single("file");

export const uploadSingleDocument = (req, res, next) => {
  documentUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) return next(toUploadAppError(error));
    return next(error);
  });
};

const imageFileFilter = (_req, file, cb) => {
  const fileExtension = getFileExtension(file.originalname);
  const allowedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

  if (!allowedImageMimeTypes.has(file.mimetype) || !allowedImageExtensions.has(fileExtension)) {
    return cb(new AppError("Unsupported image type. Upload JPG, PNG, or WebP only.", 415, "UNSUPPORTED_IMAGE_TYPE"));
  }

  return cb(null, true);
};

const imageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: PROFILE_IMAGE_UPLOAD_LIMIT_BYTES,
    files: 1
  }
}).single("file");

export const uploadSingleImage = (req, res, next) => {
  imageUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) return next(toUploadAppError(error, PROFILE_IMAGE_UPLOAD_LIMIT_BYTES));
    return next(error);
  });
};

const toUploadAppError = (error, maxBytes = DOCUMENT_UPLOAD_LIMIT_BYTES) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    return new AppError(`Attachment must be ${formatMegabytes(maxBytes)} MB or smaller`, 413, "UPLOAD_FILE_TOO_LARGE", {
      maxBytes
    });
  }

  if (error.code === "LIMIT_FILE_COUNT") {
    return new AppError("Upload one attachment at a time", 400, "UPLOAD_FILE_LIMIT");
  }

  return new AppError("Upload could not be processed", 400, "UPLOAD_INVALID", { reason: error.code });
};

const getFileExtension = (filename = "") => {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
};

const formatMegabytes = (bytes) => Math.round(bytes / 1024 / 1024);
