// A video tile: live <video> when a playable track exists, otherwise the
// initials avatar from the M4b lobby. Name chip and a mic-muted badge sit
// on a gradient scrim so text passes contrast on any video frame.
import { useEffect, useRef } from "react";

export default function VideoTile({
  stream,
  showVideo,
  micOn,
  person,
  you = false,
  mirrored = false,
  className = "",
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  const initials =
    person?.name?.split(" ").map((w) => w[0]).slice(0, 2).join("") ?? "-";

  return (
    <figure
      // No position class here on purpose: callers pass `relative` (in
      // flow) or `absolute` (corner self view). Both keep the overlay
      // children anchored; hardcoding one would conflict with the other.
      className={`overflow-hidden rounded-2xl border border-white/10 bg-night-900 ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.23_0.035_278/0.9),transparent_70%)]"
      />

      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // Own preview must be muted or it feeds back; peer audio plays.
          muted={you}
          className={[
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
            showVideo ? "opacity-100" : "opacity-0",
            mirrored ? "-scale-x-100" : "",
          ].join(" ")}
        />
      )}

      {!showVideo && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-accent-600/20 font-display text-xl font-bold text-accent-400 ring-1 ring-accent-400/30">
            {initials}
          </span>
        </div>
      )}

      <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-night-950/85 to-transparent px-4 pb-2.5 pt-8 text-sm">
        <span className="flex items-center gap-2 font-medium text-white/90">
          {person?.name ?? "-"}
          {you && <span className="text-white/60">(you)</span>}
          {!micOn && (
            <span
              aria-label="Microphone muted"
              className="grid h-5 w-5 place-items-center rounded-full bg-bad-600/90"
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3 stroke-white" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-.5 1.7M9 9.5V11a3 3 0 0 0 4.6 2.5M12 18v3M4 4l16 16" />
              </svg>
            </span>
          )}
        </span>
        <span className="text-xs capitalize text-white/60">{person?.role}</span>
      </figcaption>
    </figure>
  );
}
