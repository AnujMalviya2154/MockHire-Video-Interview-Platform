import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

// Accessible modal shell: Escape + click-outside to close, scroll lock,
// entrance motion (quick scale-settle; reduced-motion gets it instantly).
export default function Modal({ title, onClose, children }) {
  const panelRef = useRef(null);
  const backdropRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.from(backdropRef.current, { opacity: 0, duration: 0.2, ease: "power2.out" });
    gsap.from(panelRef.current, {
      opacity: 0,
      y: 14,
      scale: 0.97,
      duration: 0.28,
      ease: "power3.out",
    });
  });

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-night-950/50 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-[var(--shadow-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink-950">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 transition-colors duration-150 hover:bg-ink-100 hover:text-ink-700"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
