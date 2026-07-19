import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { formatWhen, untilLabel, isImminent, useTick } from "../lib/time";
import { reducedMotion } from "../lib/motion";
import { connectSocket, disconnectSocket, joinRoom } from "../lib/socket";
import { createPeer } from "../lib/rtc";
import { Logo, Button, Spinner } from "../components/ui";
import ControlBar from "../components/room/ControlBar";
import SidePanel from "../components/room/SidePanel";
import VideoTile from "../components/room/VideoTile";

// M5: the live interview room. Three phases on one route:
//   lobby  — green room: device preview, pre-toggles, then join
//   live   — WebRTC call + chat + shared code pad over the M3 socket
//   ended  — quiet exit screen after leaving
//
// Reaching this page at all already proves REST authorization (M2), and
// the socket join re-proves it against the DB (M3). Everything ephemeral:
// leaving stops every track, closes the peer connection, drops the socket.
export default function InterviewRoom() {
  const { roomCode } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [interview, setInterview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState("lobby"); // lobby | live | ended

  // ── Media (owned here so every phase shares one lifecycle) ─────────
  const streamRef = useRef(null); // local camera+mic MediaStream
  const [localStream, setLocalStream] = useState(null);
  const [mediaDenied, setMediaDenied] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  // ── Peer / call state ──────────────────────────────────────────────
  const peerRef = useRef(null); // { pc, handleSignal, shareScreen, stopShare, destroy }
  const [peerStream, setPeerStream] = useState(null);
  const [peerPresent, setPeerPresent] = useState(false);
  const [peerMeta, setPeerMeta] = useState({ micOn: true, camOn: true, sharing: false });
  const [sharing, setSharing] = useState(false);
  const [callState, setCallState] = useState(""); // RTCPeerConnection.connectionState

  // ── Panel / chat / code ────────────────────────────────────────────
  const [panel, setPanel] = useState(null); // null | chat | code
  const panelRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const codeTimer = useRef(null);

  useTick(30000);

  // Refs shadowing rapidly-toggled state so socket handlers and the
  // meta-broadcast never read stale values.
  const micOnRef = useRef(micOn);
  const camOnRef = useRef(camOn);
  const sharingRef = useRef(sharing);
  const phaseRef = useRef(phase);
  micOnRef.current = micOn;
  camOnRef.current = camOn;
  sharingRef.current = sharing;
  phaseRef.current = phase;

  // ── Load the interview (server authorizes: participants only) ──────
  useEffect(() => {
    let cancelled = false;
    api
      .getRoom(roomCode)
      .then((d) => !cancelled && setInterview(d.interview))
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.status === 410
              ? "This interview has been cancelled."
              : "You don't have access to this room."
            : "Could not load the room."
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  // ── Acquire devices for the lobby preview ──────────────────────────
  useEffect(() => {
    if (loading || error) return;
    let disposed = false;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (disposed) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        setLocalStream(stream);
      })
      .catch(() => !disposed && setMediaDenied(true));
    return () => {
      disposed = true;
    };
  }, [loading, error]);

  // ── Whole-page teardown: nothing survives leaving this route ───────
  useEffect(
    () => () => {
      clearTimeout(codeTimer.current);
      peerRef.current?.destroy();
      peerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      disconnectSocket();
    },
    []
  );

  // Mic/cam/share state rides the M3 signal relay as { meta } — the
  // server forwards it opaquely to the other participant, so presence
  // and mute badges needed no server change.
  const sendMeta = useCallback(() => {
    connectSocket().emit("signal", {
      meta: {
        micOn: micOnRef.current,
        camOn: camOnRef.current,
        sharing: sharingRef.current,
      },
    });
  }, []);

  const ensurePeer = useCallback(() => {
    if (peerRef.current) return peerRef.current;
    const polite = user.role === "candidate"; // deterministic, no extra negotiation
    peerRef.current = createPeer({
      polite,
      localStream: streamRef.current ?? new MediaStream(),
      onTrack: (_track, stream) => setPeerStream(stream),
      onSignal: (payload) => connectSocket().emit("signal", payload),
      onConnectionChange: setCallState,
    });
    return peerRef.current;
  }, [user.role]);

  // ── Join: connect socket, authorize, wire every handler ────────────
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");

  // Terminal failure in any phase: tear the call down and surface the
  // message on the full-page error screen (the lobby's inline joinError
  // is only for pre-join failures).
  const fatal = useCallback((message) => {
    peerRef.current?.destroy();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLocalStream(null);
    disconnectSocket();
    setError(message);
  }, []);

  async function enterRoom() {
    setJoinBusy(true);
    setJoinError("");
    try {
      const socket = connectSocket();
      const res = await joinRoom(roomCode);
      setCode(res.code);
      setLanguage(res.language);

      socket.on("peer-joined", () => {
        setPeerPresent(true);
        ensurePeer(); // we were first; their arrival starts negotiation
        sendMeta();
      });
      socket.on("peer-left", () => {
        setPeerPresent(false);
        setPeerStream(null);
        peerRef.current?.destroy();
        peerRef.current = null;
        // destroy() stops the screen track silently (stop() never fires
        // onended), so clear the sharing state here or the "presenting"
        // chip would outlive the call it belonged to.
        setSharing(false);
        sharingRef.current = false;
      });
      socket.on("signal", (payload) => {
        if (payload == null || typeof payload !== "object") return;
        if (payload.meta && typeof payload.meta === "object") {
          // Any inbound signal proves a peer is present (covers the
          // "we joined second" case with no peer-joined event for us).
          setPeerPresent(true);
          const { micOn, camOn, sharing } = payload.meta;
          setPeerMeta((m) => ({
            micOn: typeof micOn === "boolean" ? micOn : m.micOn,
            camOn: typeof camOn === "boolean" ? camOn : m.camOn,
            sharing: typeof sharing === "boolean" ? sharing : m.sharing,
          }));
          if (!peerRef.current) {
            ensurePeer();
            sendMeta();
          }
          return;
        }
        if (payload.description || payload.candidate) {
          setPeerPresent(true);
          ensurePeer().handleSignal(payload);
        }
      });
      socket.on("chat-message", (msg) => {
        if (!msg?.from || typeof msg.text !== "string") return;
        setMessages((list) => [...list, msg]);
        // Count as unread only when it's the peer's and chat is closed
        if (msg.from.id !== user.id && panelRef.current !== "chat")
          setUnread((n) => n + 1);
      });
      socket.on("code-change", (value) => {
        if (typeof value === "string") setCode(value);
      });
      socket.on("code-language", (value) => {
        if (typeof value === "string") setLanguage(value);
      });
      socket.io.on("reconnect", async () => {
        // The server's room membership died with the old connection, so
        // an authorized re-join is required before any relay works again.
        // The ack also restores the current code-pad state (M3 resync).
        try {
          const again = await joinRoom(roomCode);
          setCode(again.code);
          setLanguage(again.language);
          sendMeta();
        } catch {
          fatal("Connection to the room was lost.");
        }
      });
      socket.io.on("reconnect_failed", () =>
        fatal("Connection to the room was lost.")
      );

      // Announce ourselves; if a peer is already inside, their meta
      // reply (or offer) reveals them to us.
      sendMeta();
      setPhase("live");
    } catch (err) {
      setJoinError(err.message);
      disconnectSocket();
    } finally {
      setJoinBusy(false);
    }
  }

  // ── Controls ───────────────────────────────────────────────────────
  // Toggles read/write the refs first, so they are safe to call from
  // socket handlers and keyboard events; the emit happens outside the
  // React state updater (StrictMode double-invokes updaters).
  const toggleMic = useCallback(() => {
    const next = !micOnRef.current;
    micOnRef.current = next;
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
    if (phaseRef.current === "live") sendMeta();
  }, [sendMeta]);

  const toggleCam = useCallback(() => {
    const next = !camOnRef.current;
    camOnRef.current = next;
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
    if (phaseRef.current === "live") sendMeta();
  }, [sendMeta]);

  async function toggleShare() {
    const peer = peerRef.current;
    if (!peer) return;
    try {
      if (sharing) {
        await peer.stopShare();
        setSharing(false);
        sharingRef.current = false;
      } else {
        await peer.shareScreen(() => {
          // Ended via the browser's own "Stop sharing" bar
          setSharing(false);
          sharingRef.current = false;
          sendMeta();
        });
        setSharing(true);
        sharingRef.current = true;
      }
      sendMeta();
    } catch {
      /* user dismissed the share picker — nothing to do */
    }
  }

  function leaveRoom() {
    peerRef.current?.destroy();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLocalStream(null);
    disconnectSocket();
    setPhase("ended");
  }

  function closePanel() {
    panelRef.current = null;
    setPanel(null);
  }

  function openPanel(which) {
    const next = panelRef.current === which ? null : which;
    panelRef.current = next;
    setPanel(next);
    if (which === "chat") setUnread(0);
  }

  function sendChat(text) {
    connectSocket().emit("chat-message", text);
  }

  function changeCode(value) {
    setCode(value);
    clearTimeout(codeTimer.current);
    codeTimer.current = setTimeout(
      () => connectSocket().emit("code-change", value),
      150
    );
  }

  function changeLanguage(value) {
    setLanguage(value);
    connectSocket().emit("code-language", value);
  }

  // Keyboard shortcuts — never while typing, never with modifiers
  useEffect(() => {
    if (phase !== "live") return;
    function onKey(e) {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "m") toggleMic();
      else if (e.key === "v") toggleCam();
      else if (e.key === "c") openPanel("chat");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, toggleMic, toggleCam]);

  // ── Render ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-night-950">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-night-950 px-6 text-center">
        <div>
          <p className="font-display text-xl font-semibold text-white">{error}</p>
          <Button variant="light" className="mt-5" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  const meIsInterviewer = String(interview.interviewer?._id) === String(user.id);
  const me = meIsInterviewer ? interview.interviewer : interview.candidate;
  const other = meIsInterviewer ? interview.candidate : interview.interviewer;

  if (phase === "ended") {
    return <Ended title={interview.title} onBack={() => navigate("/dashboard")} />;
  }

  if (phase === "live") {
    return (
      <LiveStage
        interview={interview}
        me={me}
        other={other}
        localStream={localStream}
        peerStream={peerStream}
        peerPresent={peerPresent}
        peerMeta={peerMeta}
        micOn={micOn}
        camOn={camOn}
        sharing={sharing}
        callState={callState}
        panel={panel}
        messages={messages}
        unread={unread}
        selfId={user.id}
        code={code}
        language={language}
        onMic={toggleMic}
        onCam={toggleCam}
        onShare={toggleShare}
        onPanel={openPanel}
        onLeave={leaveRoom}
        onClosePanel={closePanel}
        onSend={sendChat}
        onCode={changeCode}
        onLanguage={changeLanguage}
      />
    );
  }

  return (
    <Lobby
      interview={interview}
      me={me}
      other={other}
      localStream={localStream}
      mediaDenied={mediaDenied}
      micOn={micOn}
      camOn={camOn}
      onMic={toggleMic}
      onCam={toggleCam}
      joinBusy={joinBusy}
      joinError={joinError}
      onEnter={enterRoom}
      onLeave={() => navigate("/dashboard")}
    />
  );
}

// ── Lobby ────────────────────────────────────────────────────────────
// The M4b green room, now with a real device preview in your seat.
function Lobby({
  interview,
  me,
  other,
  localStream,
  mediaDenied,
  micOn,
  camOn,
  onMic,
  onCam,
  joinBusy,
  joinError,
  onEnter,
  onLeave,
}) {
  const live = isImminent(interview.scheduledAt);

  return (
    <div className="flex min-h-screen flex-col bg-night-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <Logo dark />
        <div className="flex items-center gap-4">
          <p className="hidden text-sm text-white/60 sm:block">
            {interview.title} · with {other?.name}
          </p>
          <Button variant="ghost-dark" onClick={onLeave}>Leave</Button>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-4xl flex-1 content-center gap-6 px-6 py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/4 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-accent-600/15 blur-[120px]"
        />
        <div className="grain absolute inset-0" aria-hidden />

        <SeatStage>
          <VideoTile
            stream={localStream}
            showVideo={Boolean(localStream) && camOn}
            micOn={micOn}
            person={me}
            you
            mirrored
            className="relative aspect-[16/10]"
          />
          <VideoTile
            stream={null}
            showVideo={false}
            micOn
            person={other}
            className="relative aspect-[16/10]"
          />
        </SeatStage>

        <div className="relative flex flex-col items-center gap-5 text-center">
          {mediaDenied ? (
            <p className="max-w-md text-sm text-warn-500">
              Camera and microphone are blocked. Allow them in your browser's
              site settings to be seen and heard, or enter anyway to watch
              and use chat.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <PreToggle on={micOn} onClick={onMic} labelOn="Mic on" labelOff="Mic off" />
              <PreToggle on={camOn} onClick={onCam} labelOn="Camera on" labelOff="Camera off" />
            </div>
          )}

          <p className="flex items-center gap-2 text-sm text-white/60">
            {live ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-live-500" />
                </span>
                <span className="font-medium text-live-500">It's time</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4 stroke-white/50" fill="none" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                </svg>
                {untilLabel(interview.scheduledAt)} · {formatWhen(interview.scheduledAt)}
              </>
            )}
          </p>

          <Button variant="light" onClick={onEnter} disabled={joinBusy} className="min-w-44">
            {joinBusy ? "Joining" : "Enter room"}
          </Button>
          {joinError && <p className="text-sm text-bad-500" role="alert">{joinError}</p>}
          <p className="max-w-md text-sm text-white/50">
            This room is gated to its two participants. Video and chat stay
            between you; nothing in the call is recorded.
          </p>
        </div>
      </main>
    </div>
  );
}

function PreToggle({ on, onClick, labelOn, labelOff }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!on}
      className={[
        "rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400",
        on
          ? "bg-white/10 text-white hover:bg-white/15"
          : "bg-bad-600/20 text-bad-500 ring-1 ring-bad-600/40",
      ].join(" ")}
    >
      {on ? labelOn : labelOff}
    </button>
  );
}

function SeatStage({ children }) {
  const ref = useRef(null);
  // useGSAP auto-reverts on unmount, so StrictMode's double-mount can't
  // strand tiles at opacity 0 (the bug the auth panel hit in M4b).
  useGSAP(
    () => {
      if (reducedMotion() || !ref.current) return;
      gsap.from(ref.current.children, {
        y: 26,
        opacity: 0,
        scale: 0.96,
        duration: 0.55,
        stagger: 0.12,
        ease: "power3.out",
        clearProps: "all",
      });
    },
    { scope: ref }
  );
  return (
    <div ref={ref} className="relative grid gap-3 sm:grid-cols-2">
      {children}
    </div>
  );
}

// ── Live stage ───────────────────────────────────────────────────────
function LiveStage({
  interview,
  me,
  other,
  localStream,
  peerStream,
  peerPresent,
  peerMeta,
  micOn,
  camOn,
  sharing,
  callState,
  panel,
  messages,
  unread,
  selfId,
  code,
  language,
  onMic,
  onCam,
  onShare,
  onPanel,
  onLeave,
  onClosePanel,
  onSend,
  onCode,
  onLanguage,
}) {
  const stageRef = useRef(null);

  // One entrance when going on air: stage settles in, control bar rises.
  useGSAP(
    () => {
      if (reducedMotion() || !stageRef.current) return;
      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from(stageRef.current, { opacity: 0, scale: 0.985, duration: 0.5 })
        .from("[data-controlbar]", { y: 24, opacity: 0, duration: 0.45 }, "-=0.2");
    },
    { scope: stageRef }
  );

  const connecting = peerPresent && !peerStream;
  const reconnecting = callState === "disconnected" || callState === "failed";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-night-950 text-white">
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-3">
        <Logo dark />
        <p className="flex items-center gap-2 text-sm text-white/60">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-live-500" />
          </span>
          <span className="hidden sm:inline">{interview.title}</span>
          <span className="font-medium text-live-500">Live</span>
        </p>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <main ref={stageRef} className="relative min-w-0 flex-1 p-4">
          {peerPresent ? (
            <VideoTile
              stream={peerStream}
              showVideo={Boolean(peerStream) && (peerMeta.camOn || peerMeta.sharing)}
              micOn={peerMeta.micOn}
              person={other}
              className={`relative h-full w-full ${peerMeta.sharing ? "[&_video]:object-contain" : ""}`}
            />
          ) : (
            <div className="grid h-full w-full place-items-center rounded-2xl border border-white/10 bg-night-900">
              <div className="text-center">
                <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent-600/20 font-display text-xl font-bold text-accent-400 ring-1 ring-accent-400/30">
                  {other?.name?.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </span>
                <p className="font-medium text-white/90">Waiting for {other?.name}</p>
                <p className="mt-1 text-sm text-white/50">
                  They'll appear here the moment they join.
                </p>
              </div>
            </div>
          )}

          {(connecting || reconnecting) && (
            <p
              role="status"
              className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-night-900/90 px-4 py-1.5 text-sm text-white/80 ring-1 ring-white/10"
            >
              {reconnecting ? "Reconnecting" : "Connecting video"}
            </p>
          )}

          {/* Self view — corner tile. Always sits above the control bar
              (which is bottom-6 + ~4rem tall) so no width ever clips it.
              Hidden while presenting: the peer sees your screen, you see
              the "presenting" chip instead. */}
          <VideoTile
            stream={localStream}
            showVideo={Boolean(localStream) && camOn && !sharing}
            micOn={micOn}
            person={me}
            you
            mirrored
            className="absolute bottom-[5.75rem] right-4 aspect-[16/10] w-36 shadow-2xl sm:w-44 lg:w-56 xl:right-6"
          />
          {sharing && (
            <p className="absolute bottom-[5.75rem] left-4 rounded-full bg-night-900/90 px-3.5 py-1.5 text-xs text-white/80 ring-1 ring-white/10 xl:left-6">
              You're presenting your screen
            </p>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
            <ControlBar
              micOn={micOn}
              camOn={camOn}
              sharing={sharing}
              canShare={Boolean(navigator.mediaDevices?.getDisplayMedia) && peerPresent}
              panel={panel}
              unread={unread}
              onMic={onMic}
              onCam={onCam}
              onShare={onShare}
              onPanel={onPanel}
              onLeave={onLeave}
            />
          </div>
        </main>

        {panel && (
          <div className="absolute inset-0 z-(--z-modal) md:static md:z-auto md:w-[380px] md:shrink-0">
            <SidePanel
              panel={panel}
              onSwitch={onPanel}
              onClose={onClosePanel}
              unread={unread}
              messages={messages}
              selfId={selfId}
              onSend={onSend}
              code={code}
              language={language}
              onCode={onCode}
              onLanguage={onLanguage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Ended ────────────────────────────────────────────────────────────
function Ended({ title, onBack }) {
  const ref = useRef(null);
  useGSAP(
    () => {
      if (reducedMotion() || !ref.current) return;
      gsap.from(ref.current.children, {
        y: 18,
        opacity: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: "power3.out",
      });
    },
    { scope: ref }
  );

  return (
    <div className="grid min-h-screen place-items-center bg-night-950 px-6">
      <div ref={ref} className="max-w-md text-center">
        <p className="font-display text-2xl font-semibold text-white">
          You left the room
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          {title} has ended for you. Nothing from the call was stored; the
          room state cleared the moment the last person left.
        </p>
        <Button variant="light" className="mt-6" onClick={onBack}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
