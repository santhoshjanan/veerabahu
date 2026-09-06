# Veerabahu design system

Veerabahu is a compact disposition log for privacy-minded home-network operators. Its
visual language is an incumbent, evidence-first operating UI: calm, dense, legible, and
deliberately tool-like.

## Visual system

- **Tokens:** A dark/light token world is defined in `src/lib/design/tokens.css`. Light uses
  warm paper grounds, dark uses charcoal grounds; ink, rules, accent, and state colors are
  paired for each theme.
- **Type:** Use system typography only—no web fonts. The UI combines system sans, a system
  monospace for domains and evidence, and a condensed system fallback for headings.
- **Rhythm:** Keep the compact 4px spacing scale (`--vb-s1` through `--vb-s6`: 4, 8, 12,
  16, 24, 40px). Prefer rules and small gaps over decorative containers.
- **Status:** Domain state is communicated with status edges and explicit status stamps/text;
  color is never the only signal.
- **Density:** Tables and log-like lists favor scanability, aligned metadata, restrained
  padding, and visible evidence over cards or ornamental whitespace.
- **Controls:** Filters use native `<select>` controls. Melt UI is reserved for dialogs and
  side-sheets, where focus and dismissal behavior benefit from the primitive.

## Routes

The six primary screens are:

1. `/` — dashboard overview and consumption health.
2. `/queue` — pipeline and queue status.
3. `/review` — human-in-the-loop disposition queue.
4. `/domains` — domain browser.
5. `/domains/[domain]` — domain evidence/detail view.
6. `/audit` — global append-only audit log.

## Responsive and accessible behavior

The UI is designed for short check-in sessions on laptop, desktop, and narrow LAN screens.
Layouts should collapse without hiding evidence, allow tables to scroll when necessary, and
keep actions reachable at small widths. Preserve keyboard operation, visible focus, WCAG AA
contrast, semantic labels, and text/icon companions for state. Respect
`prefers-reduced-motion`; transitions are brief and informational.

## Finish evidence

The static detector was run on `src/routes src/lib/components src/lib/design`. It found the
AI-style side-tab rule in `src/lib/components/ReviewEntry.svelte`; this commit removes it.
No controllable browser or screenshot surface was available in this environment, so visual
interaction review remains to run in CI or an interactive browser. No screenshots are
claimed as inspected.
