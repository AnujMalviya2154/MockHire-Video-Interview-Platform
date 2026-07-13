import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    // select: false so the hash never leaves the DB unless explicitly requested
    password: { type: String, required: true, minlength: 8, select: false },
    role: {
      type: String,
      enum: ["candidate", "interviewer"],
      default: "candidate",
    },
    // Incremented on logout — invalidates all previously issued JWTs
    // (real token revocation for a stateless JWT setup)
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeJSON = function () {
  return { id: this._id, name: this.name, email: this.email, role: this.role };
};

export default mongoose.model("User", userSchema);
