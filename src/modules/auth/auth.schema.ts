import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(3, 'Tên đăng nhập phải có ít nhất 3 ký tự').max(100),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự'),
});
