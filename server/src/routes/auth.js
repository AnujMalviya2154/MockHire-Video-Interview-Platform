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
  const { email, password } = req.body ?? {};
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length > 128 // cap before bcrypt — no CPU-burn via huge inputs
  )
    return res.status(400).json({ message: "Email and password required" });

  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  // Same message for unknown email and wrong password — no user enumeration
  if (!user || !(await user.comparePassword(password)))
    return res.status(401).json({ message: "Invalid credentials" });

  res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
  res.json({ user: user.toSafeJSON() });
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
  res.json({ user: req.user.toSafeJSON() });
});

export default router;
