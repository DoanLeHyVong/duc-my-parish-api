import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(3).max(100).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(200),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(10).max(200),
});
