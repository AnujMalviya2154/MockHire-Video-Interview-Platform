// The room's side panel: chat and the shared code pad, one tab visible
// at a time. Everything here mirrors a server-enforced constraint —
// chat 1000 chars, code 50 kB, five allowed languages. The mirror is UX;
// the server remains the enforcer (M3).
import { useEffect, useMemo, useRef, useState } from "react";

const MAX_CHAT = 1000;
const MAX_CODE = 50_000;
const LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "plaintext", label: "Plain text" },
];

export default function SidePanel({
  panel, // "chat" | "code"
  onSwitch,
  onClose,
  unread,
  // chat
  messages,
  selfId,
  onSend,
  // code
  code,
  language,
  onCode,
  onLanguage,
}) {
  return (
    <aside
      data-sidepanel
      aria-label={panel === "chat" ? "Chat" : "Code pad"}
      className="relative flex h-full w-full flex-col border-l border-white/10 bg-night-900/95 backdrop-blur-md"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        {/* Tab switch lives in the panel itself: on small screens the
            panel covers the control bar, so this must not depend on it. */}
        <div role="tablist" aria-label="Panel" className="flex gap-1 rounded-full bg-white/5 p-1">
          {[
            ["chat", "Chat"],
            ["code", "Code pad"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={panel === key}
              onClick={() => panel !== key && onSwitch(key)}
              className={[
                "relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-150",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400",
                panel === key ? "bg-white text-night-950" : "text-white/70 hover:text-white",
              ].join(" ")}
            >
              {label}
              {key === "chat" && unread > 0 && panel !== "chat" && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-semibold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="grid h-8 w-8 place-items-center rounded-lg text-white/60 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {panel === "chat" ? (
        <Chat messages={messages} selfId={selfId} onSend={onSend} />
      ) : (
        <CodePad code={code} language={language} onCode={onCode} onLanguage={onLanguage} />
      )}
    </aside>
  );
}

// ── Chat ─────────────────────────────────────────────────────────────
// Text-only: every message body is a React text node. Autoscroll sticks
// to the bottom unless the reader scrolled up, in which case a "new
// messages" pill appears instead of yanking their position.
function Chat({ messages, selfId, onSend }) {
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);
  const stickRef = useRef(true);
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
      setUnseen(false);
    } else {
      setUnseen(true);
    }
  }, [messages]);

  function onScroll() {
    const el = listRef.current;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (stickRef.current) setUnseen(false);
  }

  function send(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text.slice(0, MAX_CHAT));
    setDraft("");
    stickRef.current = true;
  }

  return (
    <>
      <div
        ref={listRef}
        onScroll={onScroll}
        className="relative flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && (
          <p className="pt-8 text-center text-sm text-white/50">
            Messages stay in the room. Nothing here is stored.
          </p>
        )}
        {messages.map((m, i) => {
          const mine = m.from.id === selfId;
          return (
            <div key={i} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] ${mine ? "text-right" : ""}`}>
                <p className="mb-0.5 text-[11px] text-white/50">
                  {mine ? "You" : m.from.name}
                </p>
                <p
                  className={[
                    "inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed",
                    mine ? "bg-accent-600 text-white" : "bg-white/10 text-white/90",
                  ].join(" ")}
                >
                  {m.text}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {unseen && (
        <button
          type="button"
          onClick={() => {
            stickRef.current = true;
            listRef.current.scrollTop = listRef.current.scrollHeight;
            setUnseen(false);
          }}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-accent-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-lg transition-colors duration-150 hover:bg-accent-500"
        >
          New messages
        </button>
      )}

      <form onSubmit={send} className="flex items-end gap-2 border-t border-white/10 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHAT))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e);
          }}
          rows={1}
          placeholder="Message"
          aria-label="Chat message"
          className="max-h-28 min-h-[42px] flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-accent-400 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={!draft.trim()}
          className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-accent-600 text-white transition-colors duration-150 hover:bg-accent-500 disabled:bg-white/10 disabled:text-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 12h16M14 6l6 6-6 6" />
          </svg>
        </button>
      </form>
    </>
  );
}

// ── Code pad ─────────────────────────────────────────────────────────
// A deliberate non-editor (D5.1): mono textarea with a line-number rail,
// Tab inserts two spaces, no syntax parsing, no execution. The server
// treats code as inert text and so do we.
function CodePad({ code, language, onCode, onLanguage }) {
  const lineCount = useMemo(() => code.split("\n").length, [code]);
  const railRef = useRef(null);
  const areaRef = useRef(null);

  function syncScroll() {
    if (railRef.current && areaRef.current)
      railRef.current.scrollTop = areaRef.current.scrollTop;
  }

  function onKeyDown(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.target;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = code.slice(0, s) + "  " + code.slice(end);
      if (next.length > MAX_CODE) return;
      onCode(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <label className="flex items-center gap-2 text-xs text-white/60">
          Language
          <select
            value={language}
            onChange={(e) => onLanguage(e.target.value)}
            className="rounded-lg border border-white/10 bg-night-900 px-2 py-1.5 text-xs text-white focus:border-accent-400 focus:outline-none"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </label>
        <span className="text-[11px] tabular-nums text-white/40">
          {code.length.toLocaleString()} / {MAX_CODE.toLocaleString()}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 font-mono text-[13px] leading-[1.6] focus-within:ring-1 focus-within:ring-inset focus-within:ring-accent-400/50">
        <div
          ref={railRef}
          aria-hidden
          className="w-11 select-none overflow-hidden border-r border-white/5 py-3 pr-2 text-right text-white/30"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={areaRef}
          value={code}
          onChange={(e) => {
            if (e.target.value.length <= MAX_CODE) onCode(e.target.value);
          }}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Shared code pad"
          placeholder="Write code together. Both of you see every keystroke."
          className="flex-1 resize-none bg-transparent px-3 py-3 text-white/90 placeholder:text-white/35 focus:outline-none"
        />
      </div>
    </div>
  );
}
