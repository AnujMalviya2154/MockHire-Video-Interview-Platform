import { Router } from "express";
import rateLimit from "express-rate-limit";
import validatorLib from "validator";
import User from "../models/User.js";
import { signToken, cookieOptions, requireAuth, COOKIE_NAME } from "../middleware/auth.js";

const router = Router();

// Tighter limit on auth endpoints to slow brute-force / credential stuffing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, try again later" },
});

router.post("/register", authLimiter, async (req, res) => {
  const { name, email, password, role } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || name.length > 80)
    return res.status(400).json({ message: "Valid name required" });
  if (typeof email !== "string" || !validatorLib.isEmail(email))
    return res.status(400).json({ message: "Valid email required" });
  if (typeof password !== "string" || password.length < 8 || password.length > 128)
    return res.status(400).json({ message: "Password must be 8-128 characters" });
  if (role && !["candidate", "interviewer"].includes(role))
    return res.status(400).json({ message: "Invalid role" });

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(409).json({ message: "Email already registered" });

  const user = await User.create({ name: name.trim(), email, password, role });
  res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
  res.status(201).json({ user: user.toSafeJSON() });
});

router.post("/login", authLimiter, async (req, res) => {
  const rid = req.headers['x-debug-request-id'] || 'no-req-id';
  console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] REQUEST_RECEIVED`);
  const { email, password } = req.body ?? {};
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length > 128 // cap before bcrypt — no CPU-burn via huge inputs
  ) {
    console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] VALIDATION_FAILED`);
    return res.status(400).json({ message: "Email and password required" });
  }

  console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] VALIDATION_PASSED`);
  console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] FIND_USER_START`);
  const t0 = Date.now();
  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] FIND_USER_FINISHED`, { found: !!user, elapsedMs: Date.now() - t0 });
  
  if (!user) {
    console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] RETURN_401_NO_USER`);
    return res.status(401).json({ message: "Invalid credentials" });
  }

  console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] BCRYPT_START`);
  const b0 = Date.now();
  const match = await user.comparePassword(password);
  console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] BCRYPT_FINISHED`, { match, elapsedMs: Date.now() - b0 });

  if (!match) {
    console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] RETURN_401_BAD_PASSWORD`);
    return res.status(401).json({ message: "Invalid credentials" });
  }

  res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
  console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] JWT_CREATED_AND_COOKIE_WRITTEN`);
  res.json({ user: user.toSafeJSON() });
  console.log(`[${new Date().toISOString()}] [${rid}] [auth] [login] RESPONSE_SENT_200`);
});

router.post("/logout", requireAuth, async (req, res) => {
  // Bump tokenVersion ⇒ every outstanding JWT for this user is now invalid
  // (true revocation, not just clearing the client's cookie)
  req.user.tokenVersion += 1;
  await req.user.save();
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ message: "Logged out" });
});

router.get("/me", requireAuth, (req, res) => {
  const rid = req.headers['x-debug-request-id'] || 'no-req-id';
  res.json({ user: req.user.toSafeJSON() });
  console.log(`[${new Date().toISOString()}] [${rid}] [auth] [me] RESPONSE_SENT_200`, { userId: req.user._id });
});

export default router;
