# M6b — Site-wide Dark Mode

**Commit:** `feat(client): site-wide dark mode with theme toggle`

A separate commit after M6, by design: the feature is self-contained and
the git story reads cleaner as "feedback workflow" then "dark mode" than
as one mixed dump. No behavior, route, or API surface changed — this is a
token and a toggle. Server untouched (`git status` clean under `server/`).

---

## D6b.1 — Dark mode is a token remap, not a second set of components

**Decision:** Dark mode reassigns the existing `@theme` CSS custom
properties under two selectors in `index.css` — `:root[data-theme="dark"]`
(explicit choice) and `@media (prefers-color-scheme: dark) :root:not([data-theme])`
(OS default). Components were **not** given `dark:` variants; they keep
consuming the same token names (`bg-surface`, `text-ink-900`,
`text-ok-strong`) and those tokens resolve differently per theme.

**Alternatives considered:** (a) Tailwind's `dark:` variant on every
color utility — doubles every className, and a missed `dark:` is an
invisible bug that only shows in one mode; (b) a second stylesheet.

**Why:** The M4b design system already put every color in one `@theme`
block in OKLCH precisely so the look is governed centrally. Dark mode is
the payoff: ~40 lines of remapped variables flip the entire product
register, and it is impossible to "forget" a component because components
never name a light color in the first place. OKLCH makes the remap
principled — the dark ink scale is the light scale's lightness mirrored
at the same hue 278, so the whisper-of-indigo neutral identity survives
into dark instead of going flat grey.

**In short:** "No `dark:` classes anywhere — components consume
semantic tokens, and dark mode is one block that remaps those tokens, so
a component literally cannot be styled correctly in one theme and wrong
in the other."

## D6b.2 — Only the product register themes; brand surfaces are constant

**Decision:** The `ink` scale, `surface`, tint colors (`accent-50/100`,
`ok/warn/bad-100`), text-on-tint (`*-strong`) and shadows remap in dark.
The `night-*` surfaces, accent fills (`accent-400..700`) and `live-500`
do **not** — they are the same in both themes. So landing, the auth brand
panel, and the interview room look identical regardless of theme; only
the dashboard, forms and modals change.

**Why:** M4b established two registers — brand surfaces *sell* and are
already drenched night-indigo; product surfaces *serve*. A "dark mode"
for a page that is already dark is meaningless, and re-tinting the room
mid-call would be a distraction during the one task that matters. Scoping
the theme to the product register is the honest reading of what dark mode
is *for*: the app you stare at, not the marketing you glance at.

**In short:** "The landing page and room are dark in both
themes because they were always brand-dark; dark mode only touches the
product register, which is the only place a light/dark choice means
anything."

## D6b.3 — A `surface` token, split from the page background

**Decision:** Introduced `--color-surface` (white in light, a lifted
night tone `oklch(0.215…)` in dark) for raised elements — cards, inputs,
modals, the ledger. It is deliberately distinct from `ink-50` (the page
background). Previously those elements hardcoded `bg-white`.

**Why:** In light mode "raised" reads as white-on-off-white — a shadow
does the lifting. In dark mode white is wrong (it glares) and a shadow
barely reads on a dark page; elevation has to come from the surface being
*lighter* than the page behind it. One semantic token — "this sits above
the page" — captures that intent and resolves to the right physical color
per theme. `bg-white` couldn't; it means one specific color.

**In short:** "`bg-white` is a color; `bg-surface` is a role —
'raised above the page' — and only a role can be white in light mode and
a lifted charcoal in dark."

## D6b.4 — Text-on-tint gets its own themeable token (`*-strong`)

**Decision:** Semantic colors now carry two separate roles. `-500/-600`
are **fills** (button backgrounds, the room's danger control) and stay
constant across themes. `-strong` is **text sitting on a `-100` tint**
(status badges, error notes, the accent link) and lightens in dark so the
chip keeps its contrast. Badges went from `text-ok-600` to `text-ok-strong`.

**Why:** A single color can't do both jobs across themes. `ok-600` on the
light `ok-100` tint passes contrast; but in dark, `ok-100` becomes a deep
green and `ok-600` text on it fails WCAG AA. Splitting fill from
text-on-tint lets each move independently — the pass/fail badge stays
legible in both modes, and the Pass button fill stays the same brand
green everywhere.

**In short:** "One green can't be both a button fill and
readable text on a green chip across two themes, so the system separates
'fill' from 'text-on-tint' and only the latter themes."

## D6b.5 — No-flash boot, choice persisted, OS-default respected

**Decision:** A tiny inline script in `index.html` reads
`localStorage["mh-theme"]` and sets `data-theme` **before first paint**.
With no stored choice, no attribute is set and CSS follows
`prefers-color-scheme` on its own. `lib/theme.js` handles reads/flips
after boot; the `ThemeToggle` in `ui.jsx` reflects and toggles.

**Alternatives considered:** setting the theme from React on mount — but
React runs after first paint, so the user would see a light flash before
dark applied (FOUC). A cookie — unnecessary; the server has no say in a
purely visual client preference, and a cookie would ride every request
for nothing.

**Why:** The theme must be on `<html>` before the first byte of CSS
paints, which only an inline head script guarantees. localStorage (not a
cookie) because this never needs to reach the server — keeping it
client-only means zero new request weight and nothing to handle in Express.
Respecting `prefers-color-scheme` when the user hasn't chosen is the
accessible default; an explicit toggle then wins and sticks.

**In short:** "The theme is applied by a five-line inline
script before paint so there's no flash, stored in localStorage because
the server has no reason to know, and it defers to the OS until the user
decides otherwise."

---

## Security & quality review (per SECURITY-CHECKLIST.md)

- **Zero server changes; zero new dependencies.** The only new runtime
  code is `lib/theme.js` (~25 lines) and a 5-line inline boot script.
  `npm audit`: 0 vulnerabilities.
- **No secrets, no user data.** The stored value is the literal string
  `"light"` or `"dark"` — no PII, nothing sensitive, wrapped in try/catch
  so private-mode storage denial degrades to "theme applies this visit
  only" instead of throwing.
- **No new XSS surface.** The boot script writes a validated enum
  (`"dark"`/`"light"` only) to `dataset.theme`; it never interpolates
  storage into HTML. No `dangerouslySetInnerHTML` anywhere.
- **Accessibility:** dark tokens tuned so body text and tinted chips clear
  WCAG AA in both modes (ink-900 on ink-50, `*-strong` on `*-100`);
  `color-scheme: dark` set so native controls (the datetime picker, scroll-
  bars) match; the toggle is a real button with `aria-pressed` and a stable
  `aria-label`. `prefers-reduced-motion` still honored (unchanged).
- **Verified live in both themes:** OS-default dark on first load, toggle
  to light and back, persistence across reload with no flash, dashboard +
  schedule modal + inputs + buttons, and confirmed the landing page and
  the `night-950` token are byte-identical across themes (brand register
  constant). Throwaway verification user deleted from Atlas.
- **Build clean** (`npm run build`); production bundle +~1.5 kB CSS for
  the second token set.
