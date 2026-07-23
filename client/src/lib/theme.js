// Theme switching for the product register. Brand surfaces (landing,
// room) are night-dark in both themes by design — this only decides how
// the dashboard/forms/modals read.
//
// Model: an explicit choice lives in localStorage and wins; with no
// choice stored, CSS follows prefers-color-scheme on its own (html has
// no data-theme attribute at all). index.html applies the stored choice
// inline before first paint, so there is no flash — this module only
// handles reads and changes after boot.
const KEY = "mh-theme";

export function effectiveTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function toggleTheme() {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable (private mode) — theme still applies this visit */
  }
  return next;
}
