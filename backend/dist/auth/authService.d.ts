/**
 * Authentication service.
 *
 * Provides password hashing/verification (bcrypt) and JWT sign/verify helpers.
 * SESSION_SECRET must be set in environment before calling signToken/verifyToken.
 */
import type { AuthenticatedUser } from "../types.js";
export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(password: string, hash: string): Promise<boolean>;
export declare function signToken(userId: string, email: string): string;
export declare function verifyToken(token: string): AuthenticatedUser | null;
//# sourceMappingURL=authService.d.ts.map