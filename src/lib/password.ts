import bcrypt from "bcryptjs";
import { ApiError } from "./api-error.js";

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;

export function assertStrongPassword(password: string): void {
  if (!PASSWORD_PATTERN.test(password)) {
    throw new ApiError(
      422,
      "WEAK_PASSWORD",
      "Mật khẩu phải có ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt."
    );
  }
}

export function hashPassword(password: string): Promise<string> {
  assertStrongPassword(password);
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

