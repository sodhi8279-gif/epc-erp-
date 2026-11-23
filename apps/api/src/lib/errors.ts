export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have permission for this action') => new AppError(403, 'FORBIDDEN', msg);
export const bad = (msg: string, details?: unknown) => new AppError(400, 'VALIDATION', msg, details);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);
