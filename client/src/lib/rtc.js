// WebRTC wrapper for the 1:1 interview call, built on the browser-native
// RTCPeerConnection — no library. Implements the "perfect negotiation"
// pattern (MDN) so offer glare and mid-call renegotiation (screen share,
// refresh) resolve deterministically: the candidate is the polite peer,
// the interviewer the impolite one — derived from role, no extra
// signaling needed.
//
// Signaling rides the M3 socket relay as { description } / { candidate }
// payloads. The server never inspects them; it forwards to the one other
// authorized participant of the room.

export function createPeer({ iceServers, polite, localStream, onTrack, onSignal, onConnectionChange }) {
  const pc = new RTCPeerConnection({ iceServers });

  // Stable senders for mic + camera; screen share swaps the video
  // sender's track via replaceTrack (D5.4) instead of renegotiating
  // a new transceiver.
  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }
  // Joined without devices (permission denied): still receive the peer.
  if (localStream.getAudioTracks().length === 0)
    pc.addTransceiver("audio", { direction: "recvonly" });
  if (localStream.getVideoTracks().length === 0)
    pc.addTransceiver("video", { direction: "recvonly" });

  let makingOffer = false;
  let ignoreOffer = false;

  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      onSignal({ description: pc.localDescription });
    } catch (err) {
      console.error("negotiation failed:", err.name);
    } finally {
      makingOffer = false;
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) onSignal({ candidate });
  };

  pc.ontrack = ({ track, streams }) => onTrack(track, streams[0]);

  pc.onconnectionstatechange = () => onConnectionChange?.(pc.connectionState);

  // Handle an inbound { description } or { candidate } from the peer.
  async function handleSignal({ description, candidate }) {
    try {
      if (description) {
        const offerCollision =
          description.type === "offer" &&
          (makingOffer || pc.signalingState !== "stable");
        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) return;

        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          onSignal({ description: pc.localDescription });
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error("signal handling failed:", err.name);
    }
  }

  // ── Screen share: swap what the existing video sender transmits ──
  let cameraTrack = localStream.getVideoTracks()[0] ?? null;
  let screenStream = null;

  // The transceiver (not the sender) is the reliable handle: its
  // receiver.track always identifies the video m-line, even when we
  // joined camera-less and the sender's track is null.
  const videoTransceiver = () =>
    pc.getTransceivers().find((t) => t.receiver.track?.kind === "video");

  async function shareScreen(onEnded) {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    const t = videoTransceiver();
    // Joined without a camera ⇒ the video line is recvonly. Flip it to
    // sendrecv so replaceTrack actually transmits (fires renegotiation,
    // which perfect negotiation absorbs).
    if (t && t.direction === "recvonly") t.direction = "sendrecv";
    await t?.sender.replaceTrack(screenTrack);
    // Browser "Stop sharing" bar ends the track outside our UI
    screenTrack.onended = () => {
      stopShare();
      onEnded?.();
    };
    return screenTrack;
  }

  async function stopShare() {
    screenStream?.getTracks().forEach((t) => t.stop());
    screenStream = null;
    const t = videoTransceiver();
    await t?.sender.replaceTrack(cameraTrack);
    // No camera to fall back to ⇒ stop sending on the video line again.
    if (t && !cameraTrack && t.direction === "sendrecv") t.direction = "recvonly";
  }

  async function getTelemetryMode() {
    try {
      const stats = await pc.getStats();
      let activePair = null;

      stats.forEach((report) => {
        if (report.type === "transport" && report.selectedCandidatePairId) {
          activePair = stats.get(report.selectedCandidatePairId);
        }
      });

      if (!activePair) {
        stats.forEach((report) => {
          if (
            report.type === "candidate-pair" &&
            (report.nominated || report.selected || report.state === "succeeded")
          ) {
            activePair = report;
          }
        });
      }

      if (!activePair) return "unknown";

      const local = stats.get(activePair.localCandidateId);
      const remote = stats.get(activePair.remoteCandidateId);
      const lType = local?.candidateType;
      const rType = remote?.candidateType;

      if (lType === "relay" || rType === "relay") return "relay";
      if (
        (lType === "host" || lType === "srflx" || lType === "prflx") &&
        (rType === "host" || rType === "srflx" || rType === "prflx")
      ) {
        return "direct";
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  function destroy() {
    screenStream?.getTracks().forEach((t) => t.stop());
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
  }

  return { pc, handleSignal, shareScreen, stopShare, destroy, getTelemetryMode };
}
