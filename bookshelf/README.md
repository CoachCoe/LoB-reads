# Life on Books

A modern reading tracker for book lovers. Track your library, discover new stories, connect with readers, and visualize your reading journey.

## Documents

- `STATUS.md` — what is built, what is measured, what is broken
- `PRD.md` — what to build next, and why
- `ARCHITECTURE.md` — how it works, and the reasoning behind it
- `DEPLOYMENT.md` — running it on Azure

## Features

### Core Reading Features
- **Personal Bookshelves** - Organize with default shelves (Want to Read, Currently Reading, Read) plus unlimited custom shelves
- **Reading Progress Tracking** - Track your progress page by page through each book
- **Book Search** - Full-text and fuzzy search over a local 6.9M-work catalog built from Open Library dumps, not live API calls
- **Reviews & Ratings** - Rate books (1-5 stars) and write detailed reviews

### Social Features
- **User Profiles** - Customizable profiles with avatar upload and reading statistics
- **Follow System** - Follow friends and fellow readers
- **Activity Feed** - See what people you follow are reading and reviewing
- **Author Pages** - Explore all books by your favorite authors

### Analytics & Insights
- **Wrapped (Year in Review)** - Beautiful slideshow of your reading year with stats on books read, pages, genres, and authors
- **Reading Projections** - Year-to-date progress with year-end projections and goal tracking (50/100 book goals)

### Discovery & Exploration
- **Interactive Map** - Explore where books are set on a world map with crowdsourced location data
- **Fictional Worlds** - Dedicated pages for fantasy/sci-fi universes with multiple map uploads (Middle-earth, Westeros, etc.), each with title and description

### Import & Settings
- **Goodreads Import** - Import your library via CSV export
- **Dark Mode** - Toggle between light and dark themes
- **Avatar Upload** - Personalize your profile with a photo

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript
- **UI**: React 19, Tailwind CSS v4
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth.js
- **Maps**: Leaflet.js with React-Leaflet
- **Storage**: Azure Blob Storage behind a CDN
- **Data**: Open Library dumps (catalog), Google Books (enrichment)
- **Testing**: Jest with React Testing Library

## Getting Started

### Prerequisites

- **Node.js 24** — the version the Dockerfile and CI use
- **PostgreSQL 14+** (16 matches CI and production)
- Docker, only for the container topology described further down

### Installation

1. **Install dependencies**

   ```bash
   cd bookshelf
   npm install
   ```

2. **Create `.env`**

   ```bash
   cp .env.example .env
   ```

   Copy it to `.env`, **not** `.env.local`. Next loads `.env.local` at higher
   precedence, and the Prisma CLI lets it override an inline variable — so a
   stray `.env.local` silently points every command at the wrong database while
   appearing to work.

   Then put a generated secret in `NEXTAUTH_SECRET`:

   ```bash
   openssl rand -base64 32
   ```

   `.env.example` documents the rest, including the values needed only for
   uploads. Locally `DATABASE_URL` and `DIRECT_URL`
   are the same value; in production they must differ — see
   [DEPLOYMENT.md](./DEPLOYMENT.md).

3. **Create the database and apply migrations**

   ```bash
   createdb bookshelf
   createdb bookshelf_test        # the integration tests need their own
   npx prisma generate
   npm run db:deploy              # migrate deploy, not migrate dev
   npm run db:deploy:test
   ```

4. **Seed the demo accounts**

   ```bash
   npm run db:seed
   ```

5. **Load a catalog** — the step that is easy to miss

   Migrations create an *empty* catalog, so search returns nothing until it is
   populated. For development, a fixture is enough and takes seconds:

   ```bash
   npm run ingest -- --fixture
   ```

   For the real catalog:

   ```bash
   npm run ingest:acquire         # ~16.5GB of Open Library dumps
   npm run ingest                 # normalize ~2h41m + ~20m staging; see DEPLOYMENT.md
   ```

   The full ingest produces 6.9M works in an 11GB database, and wants a
   `VACUUM FULL` afterwards — it transiently reaches 134GB. Read
   [DEPLOYMENT.md](./DEPLOYMENT.md#do-not-run-the-ingest-against-azure) before
   starting it.

6. **Start the development server**

   ```bash
   npm run dev
   ```

   Visit [http://localhost:3000](http://localhost:3000) and sign in with the
   demo account below.

### Running the deployed topology instead

`npm run dev` talks straight to a local Postgres, which is not what production
looks like. To run what Azure will actually run — Postgres 16, PgBouncer in
transaction mode, the app in its container, and Azurite standing in for Blob
Storage:

```bash
docker compose up -d

# Migrations use the direct connection, never the pooler.
DIRECT_URL="postgresql://bookshelf:bookshelf@127.0.0.1:5433/bookshelf" \
  scripts/db/migrate-deploy.sh

docker compose down              # add -v to discard the database volume too
```

The app container reaches Azurite on its own. To exercise object storage from
the host, uncomment `AZURE_STORAGE_CONNECTION_STRING` in `.env` — it holds
Azurite's published emulator credential, which works against nothing else — and
run:

```bash
npm run storage:smoke
```

This differs from `npm run dev` in three ways that have each hidden a real
failure: the runtime connection goes through a pooler while migrations do not,
Postgres is 16 rather than 14, and `shared_buffers` is off its default. It is
also the only way to catch container-only faults — a Prisma query engine that
cannot load looks like a perfectly healthy build.

Both bind port 3000, so stop one before starting the other.

## Demo accounts

Created by `npm run db:seed`, all with the password `password123`:

| Email | Name |
| --- | --- |
| `alice@example.com` | Alice Reader |
| `bob@example.com` | Bob Bookworm |
| `carol@example.com` | Carol Chapters |

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (main)/            # Main app routes (with navbar/footer)
│   │   ├── about/         # About page
│   │   ├── author/        # Author pages
│   │   ├── feed/          # Activity feed
│   │   ├── import/        # Goodreads import review queue
│   │   ├── map/           # Interactive map
│   │   ├── my-books/      # User's library
│   │   ├── search/        # Search and discover
│   │   ├── settings/      # User settings
│   │   ├── shelf/         # Shelf pages
│   │   ├── user/          # User profiles
│   │   ├── work/          # Work detail pages (was book/ before M3)
│   │   └── wrapped/       # Year in review & projections
│   ├── api/               # API routes
│   ├── login/             # Login page
│   └── register/          # Registration page
├── components/            # React components
│   ├── authors/ catalog/ import/ locations/ map/ reviews/ shelves/ social/
│   ├── layout/           # Navbar, Footer
│   ├── providers/        # Session, Theme, Toast
│   └── ui/               # Reusable UI components
├── lib/                   # Grouped by concern: auth/, http/, sources/, storage/
├── server/               # All database access lives here, never in a route
└── types/                # TypeScript types
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm test` - Unit tests only
- `npm run test:integration` - Integration tests, serially against real Postgres
- `npm run test:all` - Both suites. Integration **must** run serially: they
  share one database and truncate between tests
- `npm run test:coverage` - Run tests with coverage report
- `npm run db:deploy` - Apply pending migrations (use this in deployments)
- `npm run db:deploy:test` - Same, against the test database
- `npm run db:seed` - Seed database with sample data
- `npm run db:push` - Push schema without a migration. **Avoid**: it leaves the
  database with no migration history, which is how the test database ended up
  validating a schema the migration chain does not produce
- `npm run ingest:acquire` / `npm run ingest` - Build the catalog from Open
  Library dumps (`-- --fixture` for a small one)
- `npm run storage:smoke` - Verify object storage against a real blob endpoint
- `npm run deploy:verify` - Assert a deployment's invariants and exit non-zero
  if any fail, so it can gate a release. 21 checks over configuration and
  schema (23 when the pooled and direct URLs differ), plus eight more against
  the running app when `BASE_URL` is set

## API Routes

Generated from the routes that exist, not from memory — the `/api/books/*`
endpoints an earlier version of this file documented were removed in M3, when
shelves and reviews were repointed from `app.books` onto catalog work keys.

### Health
- `GET /api/health` - Liveness. Checks nothing, deliberately
- `GET /api/health/ready` - Readiness. Database reachable and catalog populated

### Authentication
- `POST /api/auth/register` - Register new user
- `GET/POST /api/auth/[...nextauth]` - NextAuth.js handlers

### Works
- `GET /api/works/[workKey]/editions` - Editions of a work
- `GET /api/works/[workKey]/shelves` - Which of your shelves hold this work
- `GET/POST/DELETE /api/works/[workKey]/locations` - Crowdsourced work locations

### Authors
- `GET/POST/DELETE /api/authors/[authorName]/locations` - Crowdsourced author locations

### Shelves
- `GET/POST /api/shelves` - List/create shelves
- `GET/DELETE /api/shelves/[shelfId]` - Read (public) or delete a shelf
- `POST/DELETE /api/shelves/[shelfId]/works` - Add/remove a work

### Reviews
- `GET/POST /api/reviews` - List/create reviews
- `DELETE /api/reviews/[reviewId]` - Delete review (a re-POST updates)

### Users
- `GET/PATCH /api/users/[userId]` - Get/update user profile
- `POST /api/users/[userId]/avatar` - Upload avatar
- `GET/POST/DELETE /api/users/[userId]/follow` - Follow status, follow, unfollow
- `GET /api/users/feed` - Get activity feed

### Progress
- `GET/POST /api/progress` - Read open sessions, or update reading progress

### Import
- `POST /api/import/goodreads` - Import Goodreads CSV
- `POST /api/import/rows/[rowId]/confirm` - Accept a fuzzy match
- `POST /api/import/rows/[rowId]/skip` - Discard a queued row

### Fictional Worlds
- `GET/POST /api/fictional-worlds` - List/create worlds
- `GET /api/fictional-worlds/[worldId]` - Get world details
- `POST /api/fictional-worlds/[worldId]/upload` - Upload world map
- `DELETE/PATCH /api/fictional-worlds/maps/[mapId]` - Delete or update map details

## Data Models

Three Postgres schemas, and the split is a licensing and lifecycle control
rather than tidiness:

| Schema | Contents | Lifecycle |
| --- | --- | --- |
| `catalog` | Works, editions, authors, subjects, ratings graph | Rebuilt wholesale from Open Library dumps; nothing irreplaceable |
| `app` | Users, shelves, reviews, progress, locations, imports | User-owned; survives every ingest |
| `seed` | Restricted-licence ratings corpus | Never served |

**No foreign keys point from `app` into `catalog`.** A bad ingest must not
cascade into anyone's shelves, so write paths check a work exists and read paths
tolerate its absence. This is the most load-bearing decision in the schema.

- **User** - Profile, authentication, avatar
- **Shelf** / **ShelfItem** - Bookshelves, keyed on catalog `work_key`
- **Review** - Ratings and text reviews
- **ReadingSession** - Page tracking, start/finish dates
- **Follow** - User relationships
- **WorkLocation** / **AuthorLocation** - Crowdsourced locations, real and fictional
- **FictionalWorld** / **FictionalWorldMap** / **WorkFictionalWorld** - Invented settings and their maps
- **ImportSession** / **ImportRow** - Goodreads import with a review queue for fuzzy matches
- **CatalogWork** / **CatalogEdition** / **CatalogAuthor** / **CatalogWorkAuthor** - The catalog proper
- **WorkRatingStats** / **WorkSimilarity** - Derived ratings and the recommendation graph

There is no longer a `Book` model. It was retired in M3 in favour of catalog
work keys.

## Social Links

- [YouTube](https://www.youtube.com/@Lifeonbooks)
- [TikTok](https://www.tiktok.com/@alifeonbooks)
- [Spotify Podcast](https://open.spotify.com/show/1wo2MlieosKEXQ59nnEg9B)
- [Patreon](https://www.patreon.com/cw/LifeonBooks)
- [Facebook](https://www.facebook.com/Yourlifeonbooks/)
- [X/Twitter](https://x.com/TheLifeonBooks)
- [Instagram](https://www.instagram.com/alifeonbooks/)

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the layer boundaries and the
three-schema layout. The `app.books` to catalog migration referred to by an
earlier version of this file is complete — `app.books` no longer exists.

## Deployment

Targets Azure: Container Apps for the app, Database for PostgreSQL Flexible
Server, Blob Storage behind Front Door for uploads. See
[DEPLOYMENT.md](./DEPLOYMENT.md) — note that `next build` needs ~2GB, more than
a burstable instance has, so CI builds the image and the host only runs it.

---

Built with Next.js.
