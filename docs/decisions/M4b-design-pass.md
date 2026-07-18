# M4b — Design Pass (visual redesign)

**Commit:** `style(client): design pass — two-register visual system with display type and motion`

This milestone changed no behavior and no API surface. Every route, guard,
and security property from M4 is untouched — verified by re-running the
production build and a live browser pass (landing → login → dashboard
against the real API). What changed is *how the product reads*.

---

## D4b.1 — Two registers, one system

**Decision:** Split the UI into two deliberate visual "registers":

- **Brand register** (landing, auth brand panel, interview room): deep
  night-indigo surfaces (`night-950/900/800`), display typography, glow
  and grain textures, motion on entrance.
- **Product register** (dashboard, forms, modals): quiet light neutrals
  (`ink` scale), Inter, motion only on state change.

**Why:** Award-level sites almost never use one visual temperature for
everything. Marketing surfaces sell; product surfaces serve. A dashboard
styled like a landing page is exhausting; a landing page styled like a
dashboard is forgettable. Keeping both registers in *one* token system
(same hue 278 underlies both) makes them feel like one product.

**Interview one-liner:** "The landing page persuades, the dashboard works
— two visual registers sharing one OKLCH hue so the product still feels
whole."

## D4b.2 — Design tokens in Tailwind v4 `@theme`, colors in OKLCH

**Decision:** All colors, shadows, easings, fonts and z-indices are CSS
custom properties declared once in `index.css` under `@theme`; components
consume them as Tailwind utilities (`bg-night-950`, `text-ink-500`,
`shadow-pop`). Colors are authored in OKLCH.

**Why:** One file governs the whole look — a rebrand is a token edit, not
a find-and-replace across JSX. OKLCH gives perceptually even lightness
steps, so `ink-500` vs `ink-400` differ by the amount the eye *perceives*,
not by what hex math says. This is also why the neutrals can carry a
"whisper" of indigo (chroma 0.003–0.014) without ever looking purple.

**Interview one-liner:** "No hex codes in components — a single `@theme`
block in OKLCH is the source of truth for every surface."

## D4b.3 — Typeface pairing: Bricolage Grotesque + Inter

**Decision:** `Bricolage Grotesque` (variable, optical sizing) for display
headlines only; `Inter` for everything functional.

**Why:** Inter alone is competent but anonymous — every SaaS starter looks
like that. A characterful display face used *sparingly* (h1s, the auth
panel quote, the landing hero) is the cheapest possible route to a
distinctive identity. Restricting it to display sizes keeps body text
optimally readable.

## D4b.4 — A dedicated "live" color that is not the accent

**Decision:** `--color-live-500` (green, hue 145) marks anything on-air —
the landing mock call, room status dots — and is never used for buttons.

**Why:** If the accent color also meant "live", the interface couldn't
distinguish "clickable" from "happening now". Semantic colors earn their
place by meaning exactly one thing.

## D4b.5 — Shared `AuthLayout` (new component)

**Decision:** Login and Register now render inside one `AuthLayout`:
brand panel (dark register) beside the form (product register), collapsing
to form-only on small screens.

**Why:** The two pages had drifted — duplicate markup, slightly different
spacing. Extracting the shell removed the duplication and gave auth the
same split-register story as the rest of the app. The brand panel carries
the product's actual security stance ("gated by identity, not by a link",
"no recordings, by design") — the marketing copy is literally true, which
is on brand for this project.

## D4b.6 — Motion vocabulary: exponential ease-outs only, reduced-motion aware

**Decision:** Two easing tokens (`--ease-out-quart`, `--ease-out-expo`),
entrance animation on the landing page only, state-driven transitions
elsewhere, everything wrapped in `prefers-reduced-motion` respect.

**Why:** Motion reads as quality only when it is consistent and scarce.
One easing family means every animation feels related. Reduced-motion
support is an accessibility requirement, not garnish.

## D4b.7 — No new dependencies

**Decision:** The redesign shipped with zero package additions: no
component library, no animation library beyond what M4 already had, fonts
via Google Fonts CSS import.

**Why:** Every dependency is attack surface, audit surface, and interview
surface. The design system is ~130 lines of tokens plus the existing
primitives file — all of it explainable line by line.

## D4b.8 — GSAP choreography is scoped to brand surfaces

**Decision:** GSAP (already an M4 dependency, with `@gsap/react`) drives
entrance choreography on brand surfaces only: the landing hero word-rise
(manual word wrapping, no paid SplitText), ScrollTrigger feature reveals
(`once: true`), magnetic hover on the two primary CTAs via `gsap.quickTo`
(zero React re-renders per pointer-move), the room lobby's staggered
seat-tile entrance, and the auth panel's staged vignette reveal (via
`useGSAP`, which auto-reverts tweens so React StrictMode's double-mount
can't strand elements at opacity 0). Product surfaces (dashboard, forms,
modals) get no load choreography at all — only 150–250ms CSS state
transitions.

**Why:** Motion that plays every time you open your work tool stops being
delightful by day two and starts being latency. Brand surfaces are seen
once per visit; product surfaces hundreds of times. Everything checks
`prefers-reduced-motion` first and animates transform/opacity only, so
nothing forces layout.

**Interview line:** "GSAP runs on marketing surfaces where a first
impression matters; the app itself animates state changes, never page
loads — and every tween respects prefers-reduced-motion."

## D4b.9 — Copy discipline: bans that keep the UI from reading as generated

**Decision:** Swept all visible copy against a fixed ban list: no
em-dashes in user-facing strings, no numbered section scaffolding
("01 / 02 / 03" eyebrows), at most one eyebrow label per screen, no
scroll-down cues, no placeholder names from lorem-ipsum culture
("Jane Doe" → a real-sounding name), and decorative dots reserved for
actual live state (the `live-500` ping is the only pulsing dot anywhere).

**Why:** These are the tells of template output. A reviewer skimming the
product forms an opinion from copy texture faster than from layout.
Restraint in punctuation and labels reads as an editorial hand.

**Interview line:** "We treated copy as part of the design system — a ban
list enforced in review, because copy tells are the fastest way for a UI
to read as boilerplate."

---

## Security review (unchanged surface, re-verified)

- No secrets introduced; client secret-scan clean.
- All user content still rendered as React text nodes; the redesign added
  no `dangerouslySetInnerHTML`.
- Role-conditional UI remains presentation-only; server still enforces.
- Zero changes under `server/` for the entire design pass (`git status`
  verified); the M3 signaling suite still passes 22/22.
- `npm audit`: 0 vulnerabilities; no new dependencies.
- `npm run build` clean; live browser verification of every screen
  (landing → register → login → dashboard with next-up/ledger states →
  schedule modal → feedback modal → room lobby) at desktop and mobile
  widths, with a real authenticated session against the running API.
- Throwaway verification users and their interviews deleted from Atlas
  afterwards.
