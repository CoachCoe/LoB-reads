/**
 * The same 404 as the root one, for `notFound()` called inside this group.
 *
 * Both files are needed and they are not interchangeable, which took measuring
 * to establish:
 *
 * - `app/not-found.tsx` serves a URL that matches no route at all. A
 *   group-level file never sees those, because an unmatched path does not
 *   resolve into the group.
 * - `app/(main)/not-found.tsx` serves `notFound()` thrown by a page in this
 *   group — the work, author, shelf and profile pages. Without it those fall
 *   through to Next's built-in shell, which is what this finding was about.
 *
 * A re-export rather than a copy. It cannot be a re-export of the LAYOUT
 * though: Next's reference says a `not-found.js` "renders inside your root
 * layout", so neither file gets `(main)/layout.tsx` and the shared component
 * renders the navbar and footer itself.
 *
 * One limitation, measured rather than assumed, and stated because it is not
 * what you would expect. For a `notFound()` thrown by a DYNAMIC page in this
 * group, Next 16 delivers this UI in the RSC payload rather than in the
 * initial HTML — so the served body is empty and the page appears on
 * hydration. A segment-level `not-found.tsx` (the shape Next's own docs
 * demonstrate) behaves the same way; it was tried and removed because it added
 * nothing. A URL matching no route at all renders the root file fully
 * server-side, navbar and footer included.
 *
 * The trade-off that leaves: in a browser a reader now gets a styled page with
 * navigation instead of an unstyled "404: This page could not be found", and
 * without JavaScript they get an empty body instead of that plain line. The
 * status is 404 either way, which is what a crawler reads. Worth revisiting if
 * a later Next version renders this server-side.
 */
export { default } from "../not-found";
