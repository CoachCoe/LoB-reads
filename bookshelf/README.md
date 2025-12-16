# BookShelf

A Goodreads clone - a web application for tracking books, writing reviews, and connecting with other readers.

## Features

- **Authentication**: Email/password registration and login with NextAuth.js
- **Book Catalog**: Search books via Open Library API, import to local database, manual book entry
- **Bookshelves**: Default shelves (Want to Read, Currently Reading, Read) + custom shelves
- **Reviews & Ratings**: Star ratings (1-5) with optional text reviews
- **Reading Progress**: Track current page, progress bar, mark as finished
- **Social Features**: Follow/unfollow users, activity feed
- **Search & Discovery**: Search local database and Open Library, browse by genre

## Tech Stack

- **Frontend**: Next.js 14+ with App Router, React, TypeScript
- **Backend**: Next.js API routes
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: NextAuth.js with credentials provider
- **Styling**: Tailwind CSS
- **Book Data**: Open Library API

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   cd bookshelf
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**

   Copy `.env.example` to `.env` and update the values:
   ```bash
   cp .env.example .env
   ```

   Update `.env` with your database connection:
   ```env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bookshelf?schema=public"
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="your-secret-key-change-in-production"
   ```

4. **Set up the database**

   Create a PostgreSQL database named `bookshelf`:
   ```bash
   createdb bookshelf
   ```

   Run migrations and generate Prisma client:
   ```bash
   npm run db:push
   npm run db:generate
   ```

5. **Seed the database (optional)**

   Populate with sample data:
   ```bash
   npm run db:seed
   ```

6. **Start the development server**
   ```bash
   npm run dev
   ```

7. **Open the app**

   Visit [http://localhost:3000](http://localhost:3000)

### Sample Login

If you ran the seed script, you can log in with:
- Email: `alice@example.com`
- Password: `password123`

## Project Structure

```
/src
  /app                 # Next.js App Router pages
    /api               # API routes
    /(main)            # Main app pages (with navbar)
    /login             # Auth pages
    /register
  /components          # React components
    /ui                # Reusable UI components
    /books             # Book-related components
    /reviews           # Review components
    /social            # Social feature components
    /layout            # Layout components
  /lib                 # Utilities, API clients
  /server              # Server-side data fetching
  /types               # TypeScript types
/prisma                # Database schema and migrations
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:generate` - Generate Prisma client
- `npm run db:migrate` - Run database migrations
- `npm run db:push` - Push schema to database
- `npm run db:seed` - Seed database with sample data
- `npm run db:reset` - Reset database

## API Routes

- `/api/auth/*` - Authentication (NextAuth)
- `/api/books/*` - Book search, create, get
- `/api/shelves/*` - Shelf CRUD, add/remove books
- `/api/reviews/*` - Review CRUD
- `/api/progress/*` - Reading progress
- `/api/users/*` - User profiles, follow/unfollow, feed

## Data Models

- **User**: Profile info, authentication
- **Book**: Metadata, Open Library integration, V3 location fields
- **Shelf**: User bookshelves (default + custom)
- **ShelfItem**: Book-shelf relationships
- **Review**: Ratings and text reviews
- **ReadingProgress**: Page tracking
- **Follow**: User relationships

## Future Features (V2/V3)

- **V2**: Reading challenges, discussion forums, year-in-review stats
- **V3**: Map view of book settings/author origins

## License

MIT
