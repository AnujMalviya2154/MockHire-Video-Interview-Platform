import { Router } from "express";
import mongoose from "mongoose";
import validatorLib from "validator";
import Interview from "../models/Interview.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Everything below requires a valid session
router.use(requireAuth);

// Populate only public-safe fields — never password/tokenVersion
const PARTICIPANT_FIELDS = "name email role";

// What a candidate is allowed to see of the feedback: result only,
// never the interviewer's private comments or rating.
function shapeForViewer(interview, viewerId) {
  const obj = interview.toObject({ versionKey: false });
  const isInterviewer = String(obj.interviewer?._id ?? obj.interviewer) === String(viewerId);
  if (!isInterviewer && obj.feedback) {
    obj.feedback = { result: obj.feedback.result ?? "pending" };
  }
  return obj;
}

// POST /api/interviews — schedule (interviewer only)
router.post(
  "/",
  requireRole("interviewer"),
  asyncHandler(async (req, res) => {
    const { title, description, candidateEmail, scheduledAt } = req.body ?? {};

    if (typeof title !== "string" || !title.trim() || title.length > 120)
      return res.status(400).json({ message: "Valid title required (max 120 chars)" });
    if (description != null && (typeof description !== "string" || description.length > 1000))
      return res.status(400).json({ message: "Description too long (max 1000 chars)" });
    if (typeof candidateEmail !== "string" || !validatorLib.isEmail(candidateEmail))
      return res.status(400).json({ message: "Valid candidate email required" });

    const when = new Date(scheduledAt);
    if (!scheduledAt || Number.isNaN(when.getTime()))
      return res.status(400).json({ message: "Valid scheduled date/time required" });
    if (when.getTime() < Date.now() - 60 * 1000)
      return res.status(400).json({ message: "Scheduled time must be in the future" });

    const candidate = await User.findOne({
      email: candidateEmail.toLowerCase(),
      role: "candidate",
    });
    if (!candidate)
      return res.status(404).json({ message: "No registered candidate with that email" });
    if (candidate._id.equals(req.user._id))
      return res.status(400).json({ message: "You cannot interview yourself" });

    const interview = await Interview.create({
      title: title.trim(),
      description: (description ?? "").trim(),
      interviewer: req.user._id, // from the session — never from the client
      candidate: candidate._id,
      scheduledAt: when,
    });

    await interview.populate([
      { path: "interviewer", select: PARTICIPANT_FIELDS },
      { path: "candidate", select: PARTICIPANT_FIELDS },
    ]);
    res.status(201).json({ interview: shapeForViewer(interview, req.user._id) });
  })
);

// GET /api/interviews — list own, paginated (?page=1&limit=10&status=scheduled)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const { status } = req.query;

    // Ownership scoping: a user only ever sees interviews they belong to.
    const filter = {
      $or: [{ interviewer: req.user._id }, { candidate: req.user._id }],
    };
    if (status) {
      if (!["scheduled", "completed", "cancelled"].includes(status))
        return res.status(400).json({ message: "Invalid status filter" });
      filter.status = status;
    }

    const [items, total] = await Promise.all([
      Interview.find(filter)
        .sort({ scheduledAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("interviewer", PARTICIPANT_FIELDS)
        .populate("candidate", PARTICIPANT_FIELDS),
      Interview.countDocuments(filter),
    ]);

    res.json({
      interviews: items.map((i) => shapeForViewer(i, req.user._id)),
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      total,
    });
  })
);

// GET /api/interviews/room/:roomCode — join-time lookup (participants only)
router.get(
  "/room/:roomCode",
  asyncHandler(async (req, res) => {
    const { roomCode } = req.params;
    if (typeof roomCode !== "string" || !/^[a-f0-9]{32}$/.test(roomCode))
      return res.status(400).json({ message: "Invalid room code" });

    const interview = await Interview.findOne({ roomCode })
      .populate("interviewer", PARTICIPANT_FIELDS)
      .populate("candidate", PARTICIPANT_FIELDS);

    // 404 for both "doesn't exist" and "not yours" — a non-participant
    // can't distinguish a real room code from a fake one.
    const isParticipant =
      interview &&
      [interview.interviewer._id, interview.candidate._id].some((id) =>
        id.equals(req.user._id)
      );
    if (!isParticipant) return res.status(404).json({ message: "Interview not found" });
    if (interview.status === "cancelled")
      return res.status(410).json({ message: "This interview was cancelled" });

    const EIGHT_HOURS = 8 * 60 * 60 * 1000;
    if (Date.now() > new Date(interview.scheduledAt).getTime() + EIGHT_HOURS) {
      return res.status(410).json({ message: "This interview room expired 8 hours after the scheduled time." });
    }

    res.json({ interview: shapeForViewer(interview, req.user._id) });
  })
);

// Shared loader for the two :id mutations — validates the id, loads the
// interview, and enforces that the caller is its interviewer.
async function loadOwnInterview(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: "Invalid identifier" });
    return null;
  }
  // Scoped query: not-found and not-yours are indistinguishable (no IDOR probing)
  const interview = await Interview.findOne({ _id: id, interviewer: req.user._id });
  if (!interview) {
    res.status(404).json({ message: "Interview not found" });
    return null;
  }
  return interview;
}

// PATCH /api/interviews/:id/feedback — submit feedback (owning interviewer)
router.patch(
  "/:id/feedback",
  requireRole("interviewer"),
  asyncHandler(async (req, res) => {
    const interview = await loadOwnInterview(req, res);
    if (!interview) return;
    if (interview.status === "cancelled")
      return res.status(409).json({ message: "Cannot submit feedback on a cancelled interview" });

    const { rating, comments, result } = req.body ?? {};
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ message: "Rating must be an integer 1-5" });
    if (comments != null && (typeof comments !== "string" || comments.length > 2000))
      return res.status(400).json({ message: "Comments too long (max 2000 chars)" });
    if (!["pass", "fail"].includes(result))
      return res.status(400).json({ message: "Result must be pass or fail" });

    interview.feedback = { rating, comments: (comments ?? "").trim(), result };
    interview.status = "completed";
    await interview.save();

    res.json({ interview: shapeForViewer(interview, req.user._id) });
  })
);

// PATCH /api/interviews/:id/cancel — cancel (owning interviewer)
router.patch(
  "/:id/cancel",
  requireRole("interviewer"),
  asyncHandler(async (req, res) => {
    const interview = await loadOwnInterview(req, res);
    if (!interview) return;
    if (interview.status !== "scheduled")
      return res
        .status(409)
        .json({ message: `Cannot cancel a ${interview.status} interview` });

    interview.status = "cancelled";
    await interview.save();
    res.json({ interview: shapeForViewer(interview, req.user._id) });
  })
);

export default router;
