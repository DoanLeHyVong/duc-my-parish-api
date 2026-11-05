import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().min(1),
  CLIENT_URL: z.string().default('').refine(
    (value) => !value || value.split(',').every((url) => z.url().safeParse(url.trim()).success),
    'CLIENT_URL phải là một hoặc nhiều URL hợp lệ, phân cách bằng dấu phẩy',
  ),
  JWT_ACCESS_SECRET: z.string().min(24),
  JWT_REFRESH_SECRET: z.string().min(24),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECURE: z.string().default('false').transform((v) => v === 'true'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

export const env = schema.parse(process.env);
export type AppEnv = typeof env;
export type UnifiedEnv = AppEnv & {
  CORS_ORIGINS: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN_SECONDS: number;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_NAME: string;
};

export const getEnv = (): UnifiedEnv => {
  const databaseUrl = new URL(env.DATABASE_URL);
  return {
    ...env,
    CORS_ORIGINS: env.CLIENT_URL,
    JWT_SECRET: env.JWT_ACCESS_SECRET,
    JWT_EXPIRES_IN_SECONDS: parseDurationSeconds(env.JWT_ACCESS_EXPIRES_IN),
    DATABASE_HOST: databaseUrl.hostname,
    DATABASE_PORT: Number(databaseUrl.port || 3306),
    DATABASE_USER: decodeURIComponent(databaseUrl.username),
    DATABASE_PASSWORD: decodeURIComponent(databaseUrl.password),
    DATABASE_NAME: decodeURIComponent(databaseUrl.pathname.slice(1)),
  };
};

function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) return Number(value) || 900;
  const amount = Number(match[1]);
  return amount * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]!] ?? 1);
}
