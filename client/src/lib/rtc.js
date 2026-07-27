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

// Public STUN only. Documented limitation (D5.3): pairs of symmetric NATs
// would need a TURN relay, which costs money to run. STUN URLs are public
// infrastructure, not secrets.
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// ── TEMPORARY DIAGNOSTIC INSTRUMENTATION ────────────────────────────
// Added for the cross-machine media failure investigation. Remove after
// root cause is identified. These logs MUST NOT change behavior.
const _D = "[RTC-DIAG]";

function _parseCandidate(candidate) {
  if (!candidate || !candidate.candidate) return { raw: String(candidate) };
  const c = candidate.candidate;
  // ICE candidate line format: candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> ...
  const m = c.match(
    /candidate:(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/
  );
  if (!m) return { raw: c };
  return {
    foundation: m[1],
    component: m[2],
    protocol: m[3],
    priority: Number(m[4]),
    address: m[5],
    port: Number(m[6]),
    type: m[7], // host | srflx | prflx | relay
  };
}

async function _logStats(pc, trigger) {
  try {
    const stats = await pc.getStats();
    let selectedPair = null;
    const localCandidates = new Map();
    const remoteCandidates = new Map();

    stats.forEach((report) => {
      if (report.type === "local-candidate") localCandidates.set(report.id, report);
      if (report.type === "remote-candidate") remoteCandidates.set(report.id, report);
    });

    stats.forEach((report) => {
      if (report.type === "candidate-pair" && report.nominated) {
        selectedPair = report;
      }
    });

    // Fallback: if no nominated pair, look for state=succeeded
    if (!selectedPair) {
      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          selectedPair = report;
        }
      });
    }

    if (selectedPair) {
      const local = localCandidates.get(selectedPair.localCandidateId);
      const remote = remoteCandidates.get(selectedPair.remoteCandidateId);
      console.log(`${_D} [stats] trigger=${trigger} SELECTED_PAIR`, {
        localType: local?.candidateType,
        localProtocol: local?.protocol,
        localAddress: local?.address,
        localPort: local?.port,
        remoteType: remote?.candidateType,
        remoteProtocol: remote?.protocol,
        remoteAddress: remote?.address,
        remotePort: remote?.port,
        bytesSent: selectedPair.bytesSent,
        bytesReceived: selectedPair.bytesReceived,
        currentRoundTripTime: selectedPair.currentRoundTripTime,
        totalRoundTripTime: selectedPair.totalRoundTripTime,
        state: selectedPair.state,
        nominated: selectedPair.nominated,
      });
    } else {
      console.log(`${_D} [stats] trigger=${trigger} NO_SELECTED_PAIR`);
      // Log all candidate pairs for debugging
      const pairs = [];
      stats.forEach((report) => {
        if (report.type === "candidate-pair") {
          const local = localCandidates.get(report.localCandidateId);
          const remote = remoteCandidates.get(report.remoteCandidateId);
          pairs.push({
            state: report.state,
            nominated: report.nominated,
            localType: local?.candidateType,
            remoteType: remote?.candidateType,
            bytesSent: report.bytesSent,
            bytesReceived: report.bytesReceived,
          });
        }
      });
      if (pairs.length > 0) console.log(`${_D} [stats] ALL_PAIRS`, pairs);
    }

    // Inbound track stats for packet loss
    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && (report.kind === "video" || report.kind === "audio")) {
        console.log(`${_D} [stats] inbound-rtp kind=${report.kind}`, {
          packetsReceived: report.packetsReceived,
          packetsLost: report.packetsLost,
          bytesReceived: report.bytesReceived,
          jitter: report.jitter,
        });
      }
    });
  } catch (err) {
    console.warn(`${_D} [stats] getStats failed:`, err.message);
  }
}
// ── END DIAGNOSTIC HELPERS ──────────────────────────────────────────

export function createPeer({ polite, localStream, onTrack, onSignal, onConnectionChange }) {
  const tracks = localStream.getTracks();
  console.log(`${_D} createPeer`, {
    polite,
    trackCount: tracks.length,
    tracks: tracks.map((t) => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })),
  });

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

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

  console.log(`${_D} after-addTrack`, {
    senders: pc.getSenders().map((s) => ({ kind: s.track?.kind, readyState: s.track?.readyState })),
    receivers: pc.getReceivers().map((r) => ({ kind: r.track?.kind })),
    transceivers: pc.getTransceivers().map((t) => ({
      mid: t.mid,
      direction: t.direction,
      senderKind: t.sender.track?.kind,
      receiverKind: t.receiver.track?.kind,
    })),
  });

  let makingOffer = false;
  let ignoreOffer = false;

  pc.onnegotiationneeded = async () => {
    console.log(`${_D} onnegotiationneeded`, { signalingState: pc.signalingState, ts: Date.now() });
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      console.log(`${_D} setLocalDescription (auto)`, {
        type: pc.localDescription.type,
        sdpLength: pc.localDescription.sdp.length,
        sdpPreview: pc.localDescription.sdp.substring(0, 200),
      });
      onSignal({ description: pc.localDescription });
      console.log(`${_D} onSignal EMIT`, { type: "description", descType: pc.localDescription.type, ts: Date.now() });
    } catch (err) {
      console.error(`${_D} negotiation FAILED:`, err.name, err.message);
    } finally {
      makingOffer = false;
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      const parsed = _parseCandidate(candidate);
      console.log(`${_D} onicecandidate`, parsed);
      onSignal({ candidate });
    } else {
      console.log(`${_D} onicecandidate END_OF_CANDIDATES`, {
        iceGatheringState: pc.iceGatheringState,
        ts: Date.now(),
      });
    }
  };

  pc.onicegatheringstatechange = () => {
    console.log(`${_D} iceGatheringState →`, pc.iceGatheringState, { ts: Date.now() });
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`${_D} iceConnectionState →`, pc.iceConnectionState, { ts: Date.now() });
    _logStats(pc, `iceConnectionState=${pc.iceConnectionState}`);
  };

  pc.onsignalingstatechange = () => {
    console.log(`${_D} signalingState →`, pc.signalingState, { ts: Date.now() });
  };

  pc.ontrack = ({ track, streams }) => {
    console.log(`${_D} ontrack`, {
      kind: track.kind,
      readyState: track.readyState,
      muted: track.muted,
      streamId: streams[0]?.id,
      streamTrackCount: streams[0]?.getTracks().length,
      ts: Date.now(),
    });
    onTrack(track, streams[0]);
  };

  pc.onconnectionstatechange = () => {
    console.log(`${_D} connectionState →`, pc.connectionState, { ts: Date.now() });
    _logStats(pc, `connectionState=${pc.connectionState}`);
    onConnectionChange?.(pc.connectionState);
  };

  // Handle an inbound { description } or { candidate } from the peer.
  async function handleSignal({ description, candidate }) {
    try {
      if (description) {
        console.log(`${_D} handleSignal RECEIVED description`, {
          type: description.type,
          sdpLength: description.sdp?.length,
          signalingState: pc.signalingState,
          makingOffer,
          ts: Date.now(),
        });
        const offerCollision =
          description.type === "offer" &&
          (makingOffer || pc.signalingState !== "stable");
        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) {
          console.log(`${_D} handleSignal IGNORING_OFFER (impolite, collision)`, { ts: Date.now() });
          return;
        }

        await pc.setRemoteDescription(description);
        console.log(`${_D} setRemoteDescription SUCCESS`, { type: description.type, signalingState: pc.signalingState });
        if (description.type === "offer") {
          await pc.setLocalDescription();
          console.log(`${_D} setLocalDescription (answer)`, {
            type: pc.localDescription.type,
            sdpLength: pc.localDescription.sdp.length,
          });
          onSignal({ description: pc.localDescription });
          console.log(`${_D} onSignal EMIT`, { type: "description", descType: pc.localDescription.type, ts: Date.now() });
        }
      } else if (candidate) {
        const parsed = _parseCandidate(candidate);
        console.log(`${_D} handleSignal RECEIVED candidate`, parsed);
        try {
          await pc.addIceCandidate(candidate);
          console.log(`${_D} addIceCandidate SUCCESS`, { type: parsed.type });
        } catch (err) {
          if (!ignoreOffer) throw err;
          console.log(`${_D} addIceCandidate SUPPRESSED (ignoreOffer)`, { err: err.message });
        }
      }
    } catch (err) {
      console.error(`${_D} handleSignal FAILED:`, err.name, err.message);
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
    console.log(`${_D} shareScreen`, {
      transceiverDirection: t?.direction,
      screenTrackReadyState: screenTrack.readyState,
    });
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

  function destroy() {
    console.log(`${_D} destroy`, { connectionState: pc.connectionState, ts: Date.now() });
    screenStream?.getTracks().forEach((t) => t.stop());
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onicegatheringstatechange = null;
    pc.onsignalingstatechange = null;
    pc.close();
  }

  return { pc, handleSignal, shareScreen, stopShare, destroy };
}
