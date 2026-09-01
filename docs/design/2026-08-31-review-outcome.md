# Design review outcome — 2026-08-31

Claude Design returned a handoff for the brief in `ui-ux-review-prompt.md`:
nine artboards, a 442-line spec, three live Leaflet prototypes. It is a good
package; this file records what was taken from it, what was not, and why.

The handoff itself is not in the repo — it arrived as
`Screenshots and artboard feedback.zip`. Keep it somewhere findable; the sections
deferred below refer to it.

## Implemented: tokens and contrast only

Chosen deliberately as the slice that needs no product input and fixes verifiable
defects rather than matters of taste. Every ratio below was computed rather than
taken on trust, and is now asserted in `__tests__/utils/contrast.test.ts`.

| defect | before | after |
|---|---|---|
| `--foreground-secondary` on the page — the token carrying most secondary text | 3.47:1 | **4.86:1** |
| gold `#D4A017` used as text or a link | 2.28:1 | **4.85:1** via new `--color-primary-text` |
| white label on a gold button fill — 13 buttons | 2.38:1 | **7.08:1** via new `--color-primary-contrast` |
| dark card against the dark page | 1.00:1 | 1.07:1 surface **plus** a 1.31:1 border |
| focus ring, previously gold on a light page | 2.28:1 | **16.12:1** via new `--focus-ring` |

Two honest notes:

- **The dark card fix is real but small.** Contrast ratios compress at the dark
  end, so no pair of near-blacks reaches 3:1. What changed is that a card now has
  *two* cues (surface and border) where it had one, and the surface is no longer
  literally identical to the page. Gaining more means lifting the page off
  `#0a0a0a`, which is a design decision, not a defect fix. The test says so.
- **`Button` was not the whole story.** Thirteen hand-rolled gold buttons across
  the app bypass the component entirely. Fixing the primitive fixed one of
  fourteen; the mechanical guard in `conventions.test.ts` is what found the rest,
  and is why gold-as-text cannot come back unnoticed.

Six gold usages remain and are allowlisted in that guard: five decorative icons
sitting beside their own text labels, and `StarRating`'s filled star. Each is a
glyph nobody has to read.

## Deferred, in the order I would take them

1. **`CoverImage` with a typeset fallback.** Covers are 100% hotlinked from Open
   Library and often missing. The spec is right that this is correctness rather
   than polish.
2. **Type scale and the mono-numerals rule** — DM Serif Display / DM Sans /
   JetBrains Mono, and "every number in the product is tabular mono". Cheap per
   component, touches nearly all of them, and changes the whole feel of the app.
3. **Map scoping — "your library plotted".** The best idea in the handoff: it
   fixes discoverability and the sparse-data problem at once, because a reader's
   own 128 books are dense where 6.9M works are not. Needs real work:
   `getMappedWorkLocations()` currently takes no arguments and returns
   everything, and the spec wants URL-serialisable scope, viewport and drawer
   state.
4. **Screen rebuilds** — `/map`, `/work/[olKey]`, `/`, `/search`. Worth doing one
   at a time with review between.
5. **A book club** — see PRD §5b. Not deferred so much as not yet a product.

## Open questions the handoff raises for you

Its own list, worth answering before the screen rebuilds:

1. Home order: still-reading first, or map first? It suggests an A/B.
2. `/work` header: the one-line `Set in Haworth Moor · 2 places` as built, or a
   map thumbnail beside the cover? The thumbnail converts better but pushes the
   community rating below the fold.
3. Dark map tiles: the CSS `invert` filter as prototyped, or a real dark tile
   provider (cost, licence)? The filter inverts labels too.
4. Does `Wrapped` keep a permanent entry point, or become a seasonal feed card?

One I would add: the handoff is mobile-first — eight of nine artboards are
390pt — and proposes replacing the mobile hamburger with a five-item bottom tab
bar. That is a real IA change for a codebase that is currently desktop-first, and
it is not costed anywhere in the package.
