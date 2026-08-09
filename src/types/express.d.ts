declare global {
  namespace Express {
    interface Request {
      admin?: { id: number; username?: string };
    }
  }
}
export {};
