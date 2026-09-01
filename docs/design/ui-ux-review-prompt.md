# Claude Design brief — UI/UX review

Written 2026-08-31. Everything below the divider is the prompt: copy from
"UI/UX review — Life on Books" to the end of the file.

**Before you use it:**

- **Attach screenshots if you can.** Claude Design cannot run the app, so
  without them it is working from this description alone. Per `STATUS.md` nobody
  has ever systematically looked at this UI — "the dark-mode sweep was verified
  by grep and a build, not by looking" — and there are no visual tests at all.
- **Critique only?** Delete section 2 of "What I'd like from you". Claude Design
  produces visual artboards by default; the review is sharper if you say which
  you want.
- **This describes `audit/2026-08-31`**, not `main`. Public `/map`, the
  signed-out navbar, the custom-shelf UI and shelf pagination all landed in that
  branch. Reviewing `main` means several of these screens do not exist yet.

The facts in the prompt — tokens, screen list, component inventory, the sparse
-data constraint — were read out of the code rather than remembered, so they are
worth re-checking if the UI moves on.

---

# UI/UX review — Life on Books

A reading tracker (Goodreads-shaped: shelves, ratings, reviews, progress, a
social feed) with two differentiators nothing else has: **reader-contributed
locations** — where a book is set, where its author lived — plotted on a map, and
**maps of fictional worlds** for invented settings.

I want a design review and concrete proposals. The product bet is that "where" is
an under-served way into a library; the current UI does not express that bet at
all, and that is the main thing I want you to attack.

## Audiences (in the product's own words)

- **The reader keeping a library.** Wants their Goodreads export in, wants to
  find a book in one search, wants to see what they read this year.
- **The contributor.** Adds locations and world maps. Editing is wiki-style —
  anyone signed in may edit; the uploader or a moderator may delete — because the
  data only exists if contributing is easy.
- **The browser.** Arrives with no account, follows a subject or an author. Must
  never hit a login wall to look at a book or a public shelf.

## Stack and existing design system — please work within it

- Next.js 16 App Router, React 19, **Tailwind v4**, `lucide-react` icons.
- Theming is CSS variables on `:root`, with dark mode toggled by a **`.dark`
  class on `<html>`** (not `data-theme`), persisted to `localStorage`.
- Tokens already in use — reuse these names rather than inventing a palette:

  | token | light | dark |
  |---|---|---|
  | `--background` | `#fafafa` | `#0a0a0a` |
  | `--background-secondary` | `#ffffff` | `#0a0a0a` |
  | `--foreground` | `#1d1d1f` | `#ffffff` |
  | `--foreground-secondary` | `#86868b` | `#a1a1a1` |
  | `--border` / `--border-light` | `#e5e5e7` / `#f5f5f7` | `#1a1a1a` / `#141414` |
  | `--card-bg` / `--card-border` | `#ffffff` / `#e5e5e7` | `#0a0a0a` / `#1f1f1f` |
  | `--input-bg` / `--input-border` | `#f5f5f7` / `#e5e5e7` | `#141414` / `#2a2a2a` |
  | `--color-primary` (accent) | `#D4A017` gold | same |

  Note the dark palette is nearly flat — `--background`,
  `--background-secondary` and `--card-bg` are all `#0a0a0a`, so cards are
  distinguished only by a 1px border. Tell me if that is a problem and what you'd
  do instead.

- Existing primitives: `Avatar`, `Badge`, `Button`, `Card`, `ConfirmDialog`,
  `Input`, `ProgressBar`, `StarRating`, `Textarea`. Say which are missing,
  redundant, or inconsistent. (`Badge` currently has no consumer at all.)

## Screens

**Priority — the differentiator and the core loop**

- `/map` — the whole feature. Leaflet map, plus a slide-over panel that does
  world list → world detail → map upload in one drawer.
- `/work/[olKey]` — the busiest page by far: cover, title, authors, community
  rating, add-to-shelf, reading progress, your review, subject chips, editions
  list, contributed locations, "readers also enjoyed", "more by this author".
- `/` home, `/search` (results + subject-chip browse), `/my-books`.

**Secondary**

- `/author/[authorName]`, `/shelf/[shelfId]`, `/user/[userId]`, `/feed`,
  `/import/[sessionId]` (a review queue for unmatched Goodreads rows),
  `/settings`, `/about`, `/login`, `/register`.
- `/wrapped` and `/wrapped/projections` — a year-in-review experience.

## Constraints that will bite if you design around them

1. **The data is sparse, and that is the normal case.** The catalog holds 6.9M
   works, but only ~8,600 have any rating or "readers also enjoyed" neighbours.
   Most works have **no rating, no recommendations, and no contributed
   locations**. Design the empty state as the default, not the exception — a work
   page that only looks good populated is a work page that usually looks broken.
2. **Covers are hotlinked from Open Library and many are missing.** The grid must
   survive a mix of present covers, missing covers, and wildly inconsistent
   aspect ratios.
3. **Public pages must render with no session** — `/`, `/search`,
   `/work/[olKey]`, `/author/[authorName]`, `/shelf/[shelfId]`, `/user/[userId]`,
   `/map`, `/about`. Show me the signed-out state of anything you redesign.
4. **Dark mode is required and has never actually been looked at** — it was
   verified by grepping the source and running a build. Assume it is wrong.
5. Ratings and recommendations carry a **CC BY-SA attribution line** that must
   stay visible where those numbers appear.

## What I'd like from you

1. **A critique first, ordered by impact.** Be blunt. The specific question I care
   most about: the location/map features are the product's whole differentiator
   and they are buried — locations sit far down work and author pages, and
   nothing on the home page points at the map. How should the information
   architecture change so "where" is a first-class way into a library rather
   than a tab nobody finds?
2. **Redesigned artboards** for `/map`, `/work/[olKey]`, `/` and `/search`, in
   light and dark, at desktop and mobile widths. Include the sparse-data state
   for the work page.
3. **A tightened design system**: type scale, spacing, the card treatment
   (especially in dark mode), and what to do with the gold accent — right now it
   is used for the logo, primary buttons, filled stars and the Wrapped link, and
   I am not sure that is coherent.
4. **Accessibility passes** on colour contrast against those tokens, focus
   states, and the map panel's keyboard behaviour.

Where a recommendation is a real trade-off rather than a clear improvement, say
so and give me the options instead of picking silently.
