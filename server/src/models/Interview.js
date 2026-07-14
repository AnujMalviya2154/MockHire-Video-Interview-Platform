import mongoose from "mongoose";
import crypto from "crypto";

const interviewSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    interviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    candidate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    scheduledAt: { type: Date, required: true },
    // Unguessable room code — meeting access control, not sequential IDs
    roomCode: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(16).toString("hex"),
    },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled"],
      default: "scheduled",
    },
    feedback: {
      rating: { type: Number, min: 1, max: 5 },
      comments: { type: String, trim: true, maxlength: 2000 },
      result: { type: String, enum: ["pending", "pass", "fail"], default: "pending" },
    },
  },
  { timestamps: true }
);

// Dashboard list queries filter by participant and sort by time —
// compound indexes cover both sides of the $or without a collection scan.
interviewSchema.index({ interviewer: 1, scheduledAt: -1 });
interviewSchema.index({ candidate: 1, scheduledAt: -1 });

export default mongoose.model("Interview", interviewSchema);
