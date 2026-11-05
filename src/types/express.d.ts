import type { RoleCode } from '../generated/prisma/enums.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        roles: RoleCode[];
        permissions: string[];
        authVersion: number;
      };
      admin?: {
        id: number;
        userId: string;
        username?: string;
      };
    }
  }
}

export {};
