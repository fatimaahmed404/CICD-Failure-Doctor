"use strict";
/**
 * Authentication service.
 *
 * Provides password hashing/verification (bcrypt) and JWT sign/verify helpers.
 * SESSION_SECRET must be set in environment before calling signToken/verifyToken.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.signToken = signToken;
exports.verifyToken = verifyToken;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const BCRYPT_ROUNDS = 12;
async function hashPassword(password) {
    return bcrypt_1.default.hash(password, BCRYPT_ROUNDS);
}
async function verifyPassword(password, hash) {
    return bcrypt_1.default.compare(password, hash);
}
function signToken(userId, email) {
    const secret = process.env.SESSION_SECRET;
    if (!secret)
        throw new Error("[authService] SESSION_SECRET is not set");
    return jsonwebtoken_1.default.sign({ sub: userId, email }, secret, { expiresIn: "7d" });
}
function verifyToken(token) {
    const secret = process.env.SESSION_SECRET;
    if (!secret)
        return null;
    try {
        const payload = jsonwebtoken_1.default.verify(token, secret);
        if (typeof payload.sub !== "string" || typeof payload.email !== "string")
            return null;
        return { userId: payload.sub, email: payload.email };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=authService.js.map