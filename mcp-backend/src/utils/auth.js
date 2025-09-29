import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

let didWarnSecret = false;

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET || process.env.APP_SECRET;
  if (!secret) {
    if (!didWarnSecret) {
      console.warn(
        "JWT_SECRET not set; using insecure fallback. Set JWT_SECRET in environment."
      );
      didWarnSecret = true;
    }
    return "change-me";
  }
  return secret;
}

export async function hashPassword(password) {
  const SALT_ROUNDS = Number(process.env.PASSWORD_SALT_ROUNDS || 10);
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(payload, options = {}) {
  const secret = resolveJwtSecret();
  const expiresIn = options.expiresIn || process.env.JWT_EXPIRES_IN || "1d";
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyToken(token) {
  const secret = resolveJwtSecret();
  return jwt.verify(token, secret);
}
