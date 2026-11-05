import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError } from "../lib/api-error.js";
import multer from "multer";

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new ApiError(404, "NOT_FOUND", "Không tìm thấy tài nguyên được yêu cầu."));
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 422).json({
      error: {
        code: error.code === "LIMIT_FILE_SIZE" ? "IMPORT_FILE_TOO_LARGE" : "INVALID_UPLOAD",
        message: error.code === "LIMIT_FILE_SIZE" ? "File Excel vượt quá giới hạn 5 MB." : "Không thể nhận file tải lên."
      }
    });
    return;
  }
  if (error && typeof error === "object" && "type" in error) {
    const type = (error as { type?: string }).type;
    if (type === "entity.parse.failed" || type === "entity.too.large") {
      response.status(type === "entity.too.large" ? 413 : 400).json({
        error: {
          code: type === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
          message: type === "entity.too.large" ? "Dữ liệu gửi lên quá lớn." : "Nội dung JSON không hợp lệ."
        }
      });
      return;
    }
  }
  if (error instanceof ZodError) {
    response.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Dữ liệu chưa hợp lệ.",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      }
    });
    return;
  }

  if (error instanceof ApiError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
    });
    return;
  }

  if (process.env.NODE_ENV !== "test") {
    console.error("Unhandled request error", error instanceof Error ? error.message : "unknown");
  }
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Đã xảy ra lỗi. Vui lòng thử lại." } });
};

