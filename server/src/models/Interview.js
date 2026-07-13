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
      index: true,
    },
    candidate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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

export default mongoose.model("Interview", interviewSchema);
