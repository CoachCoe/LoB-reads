# Life on Books

A modern reading tracker for book lovers. Track your library, discover new stories, connect with readers, and visualize your reading journey.

## Features

### Core Reading Features
- **Personal Bookshelves** - Organize with default shelves (Want to Read, Currently Reading, Read) plus unlimited custom shelves
- **Reading Progress Tracking** - Track your progress page by page through each book
- **Book Search** - Search millions of titles via Open Library API
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
- **Storage**: Vercel Blob
- **External APIs**: Open Library
- **Testing**: Jest with React Testing Library

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/life-on-books.git
   cd life-on-books/bookshelf
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```

   Required environment variables:
   ```env
   DATABASE_URL="postgresql://..."
   NEXTAUTH_SECRET="your-secret"
   NEXTAUTH_URL="http://localhost:3000"
   BLOB_READ_WRITE_TOKEN="your-vercel-blob-token"  # For avatar and map uploads
   ```

4. **Set up the database**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

5. **Seed the database (optional)**
   ```bash
   npm run db:seed
   ```

6. **Start the development server**
   ```bash
   npm run dev
   ```

   Visit [http://localhost:3000](http://localhost:3000)

## Demo Account

For testing purposes:
- Email: `alice@example.com`
- Password: `password123`

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (main)/            # Main app routes (with navbar/footer)
│   │   ├── about/         # About page
│   │   ├── author/        # Author pages
│   │   ├── book/          # Book detail pages
│   │   ├── map/           # Interactive map
│   │   ├── my-books/      # User's library
│   │   ├── search/        # Book search
│   │   ├── settings/      # User settings
│   │   ├── shelf/         # Shelf pages
│   │   ├── user/          # User profiles
│   │   └── wrapped/       # Year in review & projections
│   ├── api/               # API routes
│   ├── login/             # Login page
│   └── register/          # Registration page
├── components/            # React components
│   ├── layout/           # Navbar, Footer
│   ├── providers/        # Context providers (Theme)
│   └── ui/               # Reusable UI components
├── lib/                   # Utilities and configurations
├── server/               # Server-side functions
└── types/                # TypeScript types
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run db:push` - Push schema to database
- `npm run db:seed` - Seed database with sample data

## API Routes

### Authentication
- `POST /api/auth/register` - Register new user
- `GET/POST /api/auth/[...nextauth]` - NextAuth.js handlers

### Books
- `GET /api/books` - Search books
- `GET /api/books/[bookId]` - Get book details
- `POST /api/books/[bookId]/shelves` - Add book to shelf
- `GET/POST/DELETE /api/books/[bookId]/locations` - Crowdsourced book locations

### Authors
- `GET/POST/DELETE /api/authors/[authorName]/locations` - Crowdsourced author locations

### Shelves
- `GET/POST /api/shelves` - List/create shelves
- `GET/PUT/DELETE /api/shelves/[shelfId]` - Manage shelf
- `DELETE /api/shelves/[shelfId]/books` - Remove book from shelf

### Reviews
- `GET/POST /api/reviews` - List/create reviews
- `PUT/DELETE /api/reviews/[reviewId]` - Update/delete review

### Users
- `GET/PUT /api/users/[userId]` - Get/update user profile
- `POST /api/users/[userId]/avatar` - Upload avatar
- `POST /api/users/[userId]/follow` - Follow/unfollow user
- `GET /api/users/feed` - Get activity feed

### Progress
- `POST /api/progress` - Update reading progress

### Import
- `POST /api/import/goodreads` - Import Goodreads CSV

### Fictional Worlds
- `GET/POST /api/fictional-worlds` - List/create worlds
- `GET /api/fictional-worlds/[worldId]` - Get world details
- `POST /api/fictional-worlds/[worldId]/upload` - Upload world map (with title and description)
- `DELETE/PATCH /api/fictional-worlds/maps/[mapId]` - Delete or update map details

## Data Models

- **User** - Profile info, authentication, avatar
- **Book** - Metadata, Open Library integration, location fields
- **Shelf** - User bookshelves (default + custom)
- **ShelfItem** - Book-shelf relationships
- **Review** - Ratings and text reviews
- **ReadingProgress** - Page tracking, start/finish dates
- **Follow** - User relationships
- **BookLocation** - Crowdsourced book setting locations (supports both real and fictional locations)
- **AuthorLocation** - Crowdsourced author birthplace/residence data
- **Author** - Author metadata and Open Library integration
- **FictionalWorld** - Fictional universes (Middle-earth, Westeros, etc.)
- **FictionalWorldMap** - Map images for fictional worlds with title and description

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

---

Built with Next.js and deployed on Vercel.
