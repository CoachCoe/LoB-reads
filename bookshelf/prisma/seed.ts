import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Development seed.
 *
 * User data references catalog works by key, so this needs a populated
 * catalog. Rather than depend on one having been ingested, it inserts a small
 * set of works itself — enough for shelves, ratings and the map to have
 * something to point at on a fresh clone.
 *
 * A real ingest TRUNCATEs and rebuilds catalog.*, which will remove these. That
 * is expected: there is no foreign key from app into catalog precisely so a
 * rebuild cannot cascade into user data. Shelf entries whose work has gone are
 * rendered as "not in the current catalog" rather than disappearing.
 *
 *   npm run ingest && npm run db:seed    # realistic
 *   npm run db:seed                      # standalone, still works
 */

const SEED_AUTHORS = [
  { olKey: "OLA001A", name: "Frank Herbert" },
  { olKey: "OLA002A", name: "J. R. R. Tolkien" },
  { olKey: "OLA003A", name: "Gabriel García Márquez" },
  { olKey: "OLA009A", name: "George Orwell" },
  { olKey: "OLA015A", name: "Margaret Atwood" },
  { olKey: "OLA016A", name: "Octavia E. Butler" },
];

/** Keys match scripts/ingest/known-books.ts, so a later ingest lines up. */
const SEED_WORKS = [
  { olKey: "OLK001W", title: "Dune", authorKey: "OLA001A", year: 1965, pages: 412,
    subjects: ["Science Fiction", "Desert"] },
  { olKey: "OLK002W", title: "The Hobbit", authorKey: "OLA002A", year: 1937, pages: 304,
    subjects: ["Fantasy", "Adventure"] },
  { olKey: "OLK003W", title: "One Hundred Years of Solitude", authorKey: "OLA003A", year: 1967, pages: 417,
    subjects: ["Magical Realism"] },
  { olKey: "OLK009W", title: "Nineteen Eighty-Four", authorKey: "OLA009A", year: 1949, pages: 328,
    subjects: ["Dystopian"] },
  { olKey: "OLK015W", title: "The Handmaid's Tale", authorKey: "OLA015A", year: 1985, pages: 311,
    subjects: ["Dystopian"] },
  { olKey: "OLK016W", title: "Kindred", authorKey: "OLA016A", year: 1979, pages: 264,
    subjects: ["Science Fiction"] },
];

// Same list as src/server/shelves.ts. Not imported: prisma/seed.ts runs through
// tsx outside the Next module graph, so the "@/" alias is not resolved here.
// Kept adjacent to registration.test.ts, which asserts the three names.
const DEFAULT_SHELVES = ["Want to Read", "Currently Reading", "Read"];

async function seedCatalog() {
  for (const author of SEED_AUTHORS) {
    await prisma.$executeRaw`
      INSERT INTO catalog.authors (ol_key, name) VALUES (${author.olKey}, ${author.name})
      ON CONFLICT (ol_key) DO NOTHING`;
  }

  for (const work of SEED_WORKS) {
    const author = SEED_AUTHORS.find((a) => a.olKey === work.authorKey)!;
    await prisma.$executeRaw`
      INSERT INTO catalog.works
        (ol_key, title, author_names, subjects, first_publish_year,
         edition_count, cover_edition_key)
      VALUES (${work.olKey}, ${work.title}, ${author.name}, ${work.subjects},
              ${work.year}, 1, ${work.olKey + "E"})
      ON CONFLICT (ol_key) DO NOTHING`;

    await prisma.$executeRaw`
      INSERT INTO catalog.work_authors (work_key, author_key, position)
      VALUES (${work.olKey}, ${work.authorKey}, 0)
      ON CONFLICT DO NOTHING`;

    await prisma.$executeRaw`
      INSERT INTO catalog.editions
        (ol_key, work_key, title, publish_year, number_of_pages, languages)
      VALUES (${work.olKey + "E"}, ${work.olKey}, ${work.title},
              ${work.year}, ${work.pages}, ARRAY['eng'])
      ON CONFLICT (ol_key) DO NOTHING`;
  }
}

async function main() {
  console.log("🌱 Seeding…");

  // User data only. The catalog is left alone: it may hold a real ingest.
  await prisma.readingSession.deleteMany();
  await prisma.review.deleteMany();
  await prisma.shelfItem.deleteMany();
  await prisma.workLocation.deleteMany();
  await prisma.authorLocation.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.shelf.deleteMany();
  await prisma.fictionalWorldMap.deleteMany();
  await prisma.workFictionalWorld.deleteMany();
  await prisma.fictionalWorld.deleteMany();
  await prisma.user.deleteMany();

  await seedCatalog();
  console.log(`📚 Catalog: ${SEED_WORKS.length} works available`);

  const passwordHash = await bcrypt.hash("password123", 10);

  const [alice, bob, carol] = await Promise.all(
    [
      { email: "alice@example.com", name: "Alice Reader", bio: "Science fiction and long walks." },
      { email: "bob@example.com", name: "Bob Bookworm", bio: "Reading my way through the classics." },
      { email: "carol@example.com", name: "Carol Chapters", bio: "Dystopias, mostly." },
    ].map((user) =>
      prisma.user.create({
        data: {
          ...user,
          passwordHash,
          avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.name)}`,
          shelves: {
            create: DEFAULT_SHELVES.map((name) => ({ name, isDefault: true })),
          },
        },
        include: { shelves: true },
      })
    )
  );
  console.log("👤 3 users with default shelves");

  const shelfOf = (
    user: (typeof alice) | (typeof bob) | (typeof carol),
    name: string
  ) => user.shelves.find((s) => s.name === name)!.id;

  // Alice: finished Dune, reading The Hobbit, wants Kindred.
  await prisma.shelfItem.create({
    data: { shelfId: shelfOf(alice, "Read"), workKey: "OLK001W", userId: alice.id },
  });
  await prisma.shelfItem.create({
    data: { shelfId: shelfOf(alice, "Currently Reading"), workKey: "OLK002W", userId: alice.id },
  });
  await prisma.shelfItem.create({
    data: { shelfId: shelfOf(alice, "Want to Read"), workKey: "OLK016W", userId: alice.id },
  });

  // Bob: two finished.
  await prisma.shelfItem.create({
    data: { shelfId: shelfOf(bob, "Read"), workKey: "OLK009W", userId: bob.id },
  });
  await prisma.shelfItem.create({
    data: { shelfId: shelfOf(bob, "Read"), workKey: "OLK003W", userId: bob.id },
  });

  // Carol: one finished, one in progress.
  await prisma.shelfItem.create({
    data: { shelfId: shelfOf(carol, "Read"), workKey: "OLK015W", userId: carol.id },
  });
  await prisma.shelfItem.create({
    data: { shelfId: shelfOf(carol, "Currently Reading"), workKey: "OLK001W", userId: carol.id },
  });

  // A custom, non-exclusive shelf — a work may sit here and on an exclusive one.
  const favourites = await prisma.shelf.create({
    data: { userId: alice.id, name: "Favourites", isDefault: false },
  });
  await prisma.shelfItem.create({
    data: { shelfId: favourites.id, workKey: "OLK001W", userId: alice.id },
  });
  console.log("📖 Shelves populated");

  await prisma.review.createMany({
    data: [
      { userId: alice.id, workKey: "OLK001W", rating: 5, content: "The desert planet has never felt so real." },
      { userId: bob.id, workKey: "OLK009W", rating: 5, content: "Bleaker every year." },
      { userId: bob.id, workKey: "OLK003W", rating: 4, content: "Generations blur beautifully." },
      { userId: carol.id, workKey: "OLK015W", rating: 5, content: "Read it in one sitting." },
      { userId: carol.id, workKey: "OLK001W", rating: 4 },
    ],
  });
  console.log("⭐ Reviews written");

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  await prisma.readingSession.createMany({
    data: [
      { userId: alice.id, workKey: "OLK001W", editionKey: "OLK001WE", pageCount: 412,
        currentPage: 412, startedAt: daysAgo(40), finishedAt: daysAgo(20) },
      { userId: alice.id, workKey: "OLK002W", editionKey: "OLK002WE", pageCount: 304,
        currentPage: 120, startedAt: daysAgo(5) },
      { userId: bob.id, workKey: "OLK009W", editionKey: "OLK009WE", pageCount: 328,
        currentPage: 328, startedAt: daysAgo(60), finishedAt: daysAgo(45) },
      { userId: carol.id, workKey: "OLK015W", editionKey: "OLK015WE", pageCount: 311,
        currentPage: 311, startedAt: daysAgo(15), finishedAt: daysAgo(10) },
      { userId: carol.id, workKey: "OLK001W", editionKey: "OLK001WE", pageCount: 412,
        currentPage: 88, startedAt: daysAgo(3) },
    ],
  });
  console.log("📈 Reading sessions recorded");

  await prisma.follow.createMany({
    data: [
      { followerId: alice.id, followingId: bob.id },
      { followerId: alice.id, followingId: carol.id },
      { followerId: bob.id, followingId: alice.id },
      { followerId: carol.id, followingId: alice.id },
    ],
  });
  console.log("👥 Follows created");

  const arrakis = await prisma.fictionalWorld.create({
    data: { name: "Arrakis", description: "The desert planet." },
  });
  const middleEarth = await prisma.fictionalWorld.create({
    data: { name: "Middle-earth", description: "Hobbits, and worse." },
  });

  await prisma.workFictionalWorld.createMany({
    data: [
      { workKey: "OLK001W", worldId: arrakis.id, addedById: alice.id },
      { workKey: "OLK002W", worldId: middleEarth.id, addedById: alice.id },
    ],
  });

  await prisma.workLocation.createMany({
    data: [
      { workKey: "OLK003W", addedById: bob.id, name: "Cartagena, Colombia",
        type: "inspired_by", lat: 10.391, lng: -75.4794 },
      { workKey: "OLK009W", addedById: bob.id, name: "London",
        type: "setting", lat: 51.5074, lng: -0.1278 },
      { workKey: "OLK001W", addedById: alice.id, name: "Arrakeen",
        type: "setting", isFictional: true, fictionalWorldId: arrakis.id },
    ],
  });

  await prisma.authorLocation.createMany({
    data: [
      { authorKey: "OLA002A", addedById: alice.id, name: "Oxford, UK",
        type: "residence", lat: 51.752, lng: -1.2577, yearStart: 1925, yearEnd: 1968 },
      { authorKey: "OLA001A", addedById: alice.id, name: "Tacoma, Washington",
        type: "birthplace", lat: 47.2529, lng: -122.4443 },
    ],
  });
  console.log("🗺️  Worlds and map locations added");

  console.log("\n🎉 Seed complete\n");
  console.log("   Email:    alice@example.com");
  console.log("   Password: password123\n");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
