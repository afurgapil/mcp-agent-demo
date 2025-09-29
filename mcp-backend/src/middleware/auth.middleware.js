import { verifyToken } from "../utils/auth.js";
import { User } from "../models/user.model.js";

async function resolveUserFromToken(token) {
  const decoded = verifyToken(token);
  const userId = decoded?.sub || decoded?.id;
  if (!userId) {
    throw new Error("Token missing subject");
  }
  const userDoc = await User.findById(userId)
    .populate("company")
    .populate("branch")
    .exec();
  if (!userDoc || userDoc.isActive === false) {
    throw new Error("User not found or inactive");
  }
  const safeUser = userDoc.toJSON ? userDoc.toJSON() : userDoc;
  return { decoded, userDoc, safeUser };
}

export function authenticate() {
  return async function authenticateHandler(req, res, next) {
    try {
      const header = req.headers.authorization || "";
      const [, token] = header.split(" ");
      if (!token) {
        return res.status(401).json({ error: "Authorization token required" });
      }
      const { decoded, userDoc, safeUser } = await resolveUserFromToken(token);
      req.auth = decoded;
      req.user = safeUser;
      req.userDocument = userDoc;
      next();
    } catch (err) {
      console.error("Authentication error", err);
      const message = err?.message || "Invalid token";
      res.status(401).json({ error: message });
    }
  };
}

export function optionalAuthenticate() {
  return async function optionalHandler(req, res, next) {
    const header = req.headers.authorization || "";
    const [, token] = header.split(" ");
    if (!token) {
      return next();
    }
    try {
      const { decoded, userDoc, safeUser } = await resolveUserFromToken(token);
      req.auth = decoded;
      req.user = safeUser;
      req.userDocument = userDoc;
    } catch (err) {
      console.warn("Optional auth failed", err?.message || err);
    }
    next();
  };
}

export function requireAdmin() {
  return function requireAdminHandler(req, res, next) {
    if (!req.user || req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Admin privileges are required for this action" });
    }
    next();
  };
}
