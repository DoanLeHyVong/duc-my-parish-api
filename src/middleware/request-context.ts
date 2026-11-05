import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const validRequestId = /^[A-Za-z0-9._-]{1,64}$/;

export const requestContext: RequestHandler = (request, response, next) => {
  const supplied = request.header("x-request-id")?.trim();
  const requestId = supplied && validRequestId.test(supplied) ? supplied : randomUUID();
  const startedAt = performance.now();
  response.setHeader("X-Request-ID", requestId);

  let logged = false;
  const log = (event: "request.completed" | "request.aborted") => {
    if (logged || process.env.NODE_ENV === "test") return;
    logged = true;
    console.info(JSON.stringify({
      level: event === "request.completed" ? "info" : "warn",
      event,
      requestId,
      method: request.method,
      path: request.originalUrl.split("?", 1)[0],
      statusCode: response.statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100
    }));
  };
  response.once("finish", () => {
    log("request.completed");
  });
  response.once("close", () => {
    if (!response.writableFinished) log("request.aborted");
  });
  next();
};

