import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const COOKIE_NAME = "iv_token";

const JWT_ISSUER = "mockhire-api";
const JWT_AUDIENCE = "mockhire-client";

export function signToken(user) {
  // No role in the payload on purpose: role is always read fresh from the
  // DB in requireAuth — never trust client-held claims for authorization.
  return jwt.sign(
    { sub: user._id.toString(), ver: user.tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: "1d", issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

export function cookieOptions() {
  return {
    httpOnly: true, // not readable by JS — blocks token theft via XSS
    sameSite: "lax", // CSRF mitigation
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    maxAge: 24 * 60 * 60 * 1000,
  };
}

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ message: "Not authenticated" });
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const user = await User.findById(payload.sub);
    // tokenVersion mismatch ⇒ token was revoked by logout — reject it
    if (!user || payload.ver !== user.tokenVersion)
      return res.status(401).json({ message: "Not authenticated" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired session" });
  }
}

// Verify a raw cookie header (used by the Socket.IO handshake in M3,
// which has no Express req/res). Returns the user or null — same
// validation path as requireAuth so the rules never diverge.
export async function verifyTokenFromCookieHeader(cookieHeader) {
  try {
    if (!cookieHeader) return null;
    const match = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    if (!match) return null;
    const token = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const user = await User.findById(payload.sub);
    if (!user || payload.ver !== user.tokenVersion) return null;
    return user;
  } catch {
    return null;
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}
