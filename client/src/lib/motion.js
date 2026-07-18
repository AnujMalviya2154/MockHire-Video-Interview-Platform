// Shared motion utilities — brand surfaces only. Product surfaces animate
// on state change via CSS transitions, never on page load (see M4b docs).
import { gsap } from "gsap";

export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Magnetic hover: element leans toward the cursor, springs back on leave.
// Returns a cleanup function — call it from the effect's teardown.
// Uses gsap.quickTo (no React state, no re-renders per pointer move).
export function magnetize(el, strength = 0.3) {
  if (!el || reducedMotion()) return () => {};
  const xTo = gsap.quickTo(el, "x", { duration: 0.4, ease: "power3.out" });
  const yTo = gsap.quickTo(el, "y", { duration: 0.4, ease: "power3.out" });

  const onMove = (e) => {
    const r = el.getBoundingClientRect();
    xTo((e.clientX - (r.left + r.width / 2)) * strength);
    yTo((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const onLeave = () => {
    xTo(0);
    yTo(0);
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);
  return () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerleave", onLeave);
    gsap.set(el, { x: 0, y: 0 });
  };
}
