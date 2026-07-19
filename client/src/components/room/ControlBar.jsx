// Call controls — the floating pill at the bottom of the live stage.
// Every control is a real button: focus-visible ring, aria-pressed for
// toggles, tooltip labels with the keyboard shortcut. Danger (leave) is
// two-press, matching the InlineCancel vocabulary from the dashboard.
import { useEffect, useRef, useState } from "react";

function Key({ children }) {
  return (
    <kbd className="rounded border border-white/20 bg-white/10 px-1 font-sans text-[10px] leading-4">
      {children}
    </kbd>
  );
}

function ControlButton({ label, shortcut, active, danger, disabled, onClick, children }) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        className={[
          "grid h-11 w-11 place-items-center rounded-full transition-colors duration-150",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400",
          disabled
            ? "cursor-not-allowed bg-white/5 text-white/30"
            : danger
              ? "bg-bad-600 text-white hover:bg-bad-500"
              : active
                ? "bg-white text-night-950 hover:bg-white/90"
                : "bg-white/10 text-white hover:bg-white/20",
        ].join(" ")}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-lg bg-night-900 px-2.5 py-1.5 text-xs text-white/90 opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
        {shortcut && <Key>{shortcut}</Key>}
      </span>
    </div>
  );
}

// Stroke icon set, consistent 1.8 weight with the rest of the app.
const icons = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  micOff: (
    <>
      <path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-.5 1.7M9 9.5V11a3 3 0 0 0 4.6 2.5" />
      <path d="M5 11a7 7 0 0 0 11.4 4.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M4 4l16 16" />
    </>
  ),
  cam: (
    <>
      <rect x="3" y="7" width="12" height="10" rx="2" />
      <path d="m15 11 5-3v8l-5-3" />
    </>
  ),
  camOff: (
    <>
      <path d="M8 7h5a2 2 0 0 1 2 2v1l5-3v8l-2.2-1.3M15 15.5V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h.5" />
      <path d="M4 4l16 16" />
    </>
  ),
  screen: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M12 13V8.5m0 0-2.5 2.5M12 8.5l2.5 2.5M8 21h8" />
    </>
  ),
  chat: (
    <>
      <path d="M21 12a8 8 0 0 1-8 8H4l1.7-3.4A8 8 0 1 1 21 12z" />
    </>
  ),
  code: (
    <>
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" />
    </>
  ),
  leave: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </>
  ),
};

function Icon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {icons[name]}
    </svg>
  );
}

export default function ControlBar({
  micOn,
  camOn,
  sharing,
  canShare,
  panel, // null | "chat" | "code"
  unread,
  onMic,
  onCam,
  onShare,
  onPanel,
  onLeave,
}) {
  const [armed, setArmed] = useState(false);
  const disarmTimer = useRef(null);

  useEffect(() => () => clearTimeout(disarmTimer.current), []);

  function leave() {
    if (!armed) {
      setArmed(true);
      disarmTimer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    clearTimeout(disarmTimer.current);
    onLeave();
  }

  return (
    <div
      data-controlbar
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-night-900/90 px-3 py-2.5 shadow-2xl backdrop-blur-md"
    >
      <ControlButton label={micOn ? "Mute" : "Unmute"} shortcut="M" active={!micOn} onClick={onMic}>
        <Icon name={micOn ? "mic" : "micOff"} />
      </ControlButton>
      <ControlButton label={camOn ? "Camera off" : "Camera on"} shortcut="V" active={!camOn} onClick={onCam}>
        <Icon name={camOn ? "cam" : "camOff"} />
      </ControlButton>
      <ControlButton
        label={sharing ? "Stop sharing" : "Share screen"}
        active={sharing}
        disabled={!canShare}
        onClick={onShare}
      >
        <Icon name="screen" />
      </ControlButton>

      <span className="mx-1 h-6 w-px bg-white/10" aria-hidden />

      <div className="relative">
        <ControlButton label="Chat" shortcut="C" active={panel === "chat"} onClick={() => onPanel("chat")}>
          <Icon name="chat" />
        </ControlButton>
        {unread > 0 && panel !== "chat" && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </div>
      <ControlButton label="Code pad" active={panel === "code"} onClick={() => onPanel("code")}>
        <Icon name="code" />
      </ControlButton>

      <span className="mx-1 h-6 w-px bg-white/10" aria-hidden />

      {armed ? (
        <button
          type="button"
          onClick={leave}
          className="rounded-full bg-bad-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-bad-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad-500"
        >
          Confirm leave
        </button>
      ) : (
        <ControlButton label="Leave room" danger onClick={leave}>
          <Icon name="leave" />
        </ControlButton>
      )}
    </div>
  );
}
