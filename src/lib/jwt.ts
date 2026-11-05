import jwt from "jsonwebtoken";
import { getEnv } from "../config/env.js";

export interface AccessTokenClaims {
  sub: string;
  av: number;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  const env = getEnv();
  return jwt.sign({ av: claims.av }, env.JWT_SECRET, {
    algorithm: "HS256",
    subject: claims.sub,
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
    issuer: "appglv-api",
    audience: "appglv-mobile"
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const env = getEnv();
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: "appglv-api",
    audience: "appglv-mobile"
  });

  if (
    typeof decoded === "string" ||
    !decoded.sub ||
    typeof decoded.av !== "number" ||
    typeof decoded.exp !== "number"
  ) {
    throw new Error("Invalid token claims");
  }

  return { sub: decoded.sub, av: decoded.av };
}

