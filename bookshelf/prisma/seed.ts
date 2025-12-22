import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed...");

  // Clear existing data
  await prisma.follow.deleteMany();
  await prisma.readingProgress.deleteMany();
  await prisma.review.deleteMany();
  await prisma.shelfItem.deleteMany();
  await prisma.shelf.deleteMany();
  await prisma.book.deleteMany();
  await prisma.fictionalWorld.deleteMany();
  await prisma.user.deleteMany();

  console.log("🌍 Creating fictional worlds...");

  // Create fictional worlds
  const fictionalWorlds = await Promise.all([
    prisma.fictionalWorld.create({
      data: {
        name: "Middle-earth",
        description: "The fantasy world created by J.R.R. Tolkien, home to hobbits, elves, dwarves, and the epic struggle against Sauron.",
      },
    }),
    prisma.fictionalWorld.create({
      data: {
        name: "Arrakis",
        description: "The desert planet from Frank Herbert's Dune, also known as Dune. The only source of the spice melange.",
      },
    }),
    prisma.fictionalWorld.create({
      data: {
        name: "Macondo",
        description: "The fictional town in Colombia from Gabriel García Márquez's One Hundred Years of Solitude.",
      },
    }),
  ]);

  const middleEarth = fictionalWorlds[0];
  const arrakis = fictionalWorlds[1];
  const macondo = fictionalWorlds[2];

  console.log(`✅ Created ${fictionalWorlds.length} fictional worlds`);

  console.log("📚 Creating books...");

  // Create sample books
  const books = await Promise.all([
    prisma.book.create({
      data: {
        title: "1984",
        author: "George Orwell",
        isbn: "9780451524935",
        description:
          "A dystopian novel set in a totalitarian society ruled by Big Brother. Winston Smith works for the Ministry of Truth, rewriting history. When he begins a forbidden love affair and starts questioning the Party, he discovers the true nature of his world.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780451524935-L.jpg",
        pageCount: 328,
        publishedDate: "1949",
        genres: ["Dystopian", "Science Fiction", "Political Fiction"],
        openLibraryId: "/works/OL1168083W",
        settingLocation: "London, England",
        settingCoordinates: '{"lat": 51.5074, "lng": -0.1278}',
        authorOrigin: "Motihari, India",
        authorOriginCoordinates: '{"lat": 26.6597, "lng": 84.9167}',
      },
    }),
    prisma.book.create({
      data: {
        title: "To Kill a Mockingbird",
        author: "Harper Lee",
        isbn: "9780061120084",
        description:
          "Through the eyes of young Scout Finch, this novel explores themes of racial injustice and moral growth in the American South during the 1930s, as her father Atticus defends a Black man falsely accused of a crime.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780061120084-L.jpg",
        pageCount: 336,
        publishedDate: "1960",
        genres: ["Southern Gothic", "Coming-of-age", "Legal Drama"],
        openLibraryId: "/works/OL4397551W",
        settingLocation: "Maycomb, Alabama (fictional)",
        settingCoordinates: '{"lat": 31.2619, "lng": -85.4808}',
        authorOrigin: "Monroeville, Alabama",
        authorOriginCoordinates: '{"lat": 31.5274, "lng": -87.3247}',
      },
    }),
    prisma.book.create({
      data: {
        title: "The Great Gatsby",
        author: "F. Scott Fitzgerald",
        isbn: "9780743273565",
        description:
          "A tale of wealth, love, and the American Dream set in the Jazz Age. Narrator Nick Carraway becomes entangled in the world of his mysterious millionaire neighbor Jay Gatsby and his obsession with the beautiful Daisy Buchanan.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780743273565-L.jpg",
        pageCount: 180,
        publishedDate: "1925",
        genres: ["Literary Fiction", "Tragedy", "Jazz Age"],
        openLibraryId: "/works/OL468431W",
        settingLocation: "Long Island, New York",
        settingCoordinates: '{"lat": 40.7891, "lng": -73.1350}',
        authorOrigin: "St. Paul, Minnesota",
        authorOriginCoordinates: '{"lat": 44.9537, "lng": -93.0900}',
      },
    }),
    prisma.book.create({
      data: {
        title: "Pride and Prejudice",
        author: "Jane Austen",
        isbn: "9780141439518",
        description:
          "The story follows Elizabeth Bennet as she navigates issues of manners, morality, education, and marriage in early 19th-century England, particularly her relationship with the proud Mr. Darcy.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg",
        pageCount: 432,
        publishedDate: "1813",
        genres: ["Romance", "Classic Literature", "Social Commentary"],
        openLibraryId: "/works/OL66554W",
        settingLocation: "Hertfordshire, England",
        settingCoordinates: '{"lat": 51.8098, "lng": -0.2377}',
        authorOrigin: "Steventon, Hampshire, England",
        authorOriginCoordinates: '{"lat": 51.2545, "lng": -1.2350}',
      },
    }),
    prisma.book.create({
      data: {
        title: "The Hobbit",
        author: "J.R.R. Tolkien",
        isbn: "9780547928227",
        description:
          "Bilbo Baggins, a comfortable hobbit, is swept into an epic quest to reclaim the Dwarf Kingdom of Erebor from the fearsome dragon Smaug, discovering courage and a powerful ring along the way.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780547928227-L.jpg",
        pageCount: 366,
        publishedDate: "1937",
        genres: ["Fantasy", "Adventure", "Children's Literature"],
        openLibraryId: "/works/OL262758W",
        settingLocation: "The Shire, Middle-earth",
        authorOrigin: "Bloemfontein, South Africa",
        authorOriginCoordinates: '{"lat": -29.0852, "lng": 26.1596}',
        isFictional: true,
        fictionalWorldId: middleEarth.id,
      },
    }),
    prisma.book.create({
      data: {
        title: "Dune",
        author: "Frank Herbert",
        isbn: "9780441172719",
        description:
          "Set in the distant future, young Paul Atreides and his family are thrust into a war for control of the desert planet Arrakis, the only source of the most valuable substance in the universe.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg",
        pageCount: 688,
        publishedDate: "1965",
        genres: ["Science Fiction", "Space Opera", "Political Fiction"],
        openLibraryId: "/works/OL893415W",
        settingLocation: "Arrakeen, Arrakis",
        authorOrigin: "Tacoma, Washington",
        authorOriginCoordinates: '{"lat": 47.2529, "lng": -122.4443}',
        isFictional: true,
        fictionalWorldId: arrakis.id,
      },
    }),
    prisma.book.create({
      data: {
        title: "The Catcher in the Rye",
        author: "J.D. Salinger",
        isbn: "9780316769488",
        description:
          "Holden Caulfield, a teenager expelled from prep school, wanders New York City over a few days, grappling with alienation, loss of innocence, and the phoniness of the adult world.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780316769488-L.jpg",
        pageCount: 277,
        publishedDate: "1951",
        genres: ["Coming-of-age", "Literary Fiction", "Realistic Fiction"],
        openLibraryId: "/works/OL5845689W",
        settingLocation: "New York City, New York",
        settingCoordinates: '{"lat": 40.7128, "lng": -74.0060}',
        authorOrigin: "Manhattan, New York",
        authorOriginCoordinates: '{"lat": 40.7831, "lng": -73.9712}',
      },
    }),
    prisma.book.create({
      data: {
        title: "One Hundred Years of Solitude",
        author: "Gabriel García Márquez",
        isbn: "9780060883287",
        description:
          "The multi-generational story of the Buendía family in the fictional town of Macondo, blending the everyday with the magical in a landmark of magical realism.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780060883287-L.jpg",
        pageCount: 417,
        publishedDate: "1967",
        genres: ["Magical Realism", "Literary Fiction", "Family Saga"],
        openLibraryId: "/works/OL59856W",
        settingLocation: "Macondo",
        authorOrigin: "Aracataca, Colombia",
        authorOriginCoordinates: '{"lat": 10.5919, "lng": -74.1897}',
        isFictional: true,
        fictionalWorldId: macondo.id,
      },
    }),
    prisma.book.create({
      data: {
        title: "Brave New World",
        author: "Aldous Huxley",
        isbn: "9780060850524",
        description:
          "A futuristic World State where citizens are genetically modified and socially conditioned to serve a ruling order. When a savage from outside this society enters, he challenges everything.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780060850524-L.jpg",
        pageCount: 288,
        publishedDate: "1932",
        genres: ["Dystopian", "Science Fiction", "Philosophical Fiction"],
        openLibraryId: "/works/OL59929W",
        settingLocation: "London, World State",
        settingCoordinates: '{"lat": 51.5074, "lng": -0.1278}',
        authorOrigin: "Godalming, Surrey, England",
        authorOriginCoordinates: '{"lat": 51.1859, "lng": -0.6206}',
      },
    }),
    prisma.book.create({
      data: {
        title: "The Lord of the Rings",
        author: "J.R.R. Tolkien",
        isbn: "9780618640157",
        description:
          "The epic tale of Frodo Baggins and the Fellowship as they journey to destroy the One Ring and defeat the Dark Lord Sauron, saving Middle-earth from darkness.",
        coverUrl: "https://covers.openlibrary.org/b/isbn/9780618640157-L.jpg",
        pageCount: 1178,
        publishedDate: "1954",
        genres: ["Fantasy", "Adventure", "Epic"],
        openLibraryId: "/works/OL27448W",
        settingLocation: "Middle-earth",
        authorOrigin: "Bloemfontein, South Africa",
        authorOriginCoordinates: '{"lat": -29.0852, "lng": 26.1596}',
        isFictional: true,
        fictionalWorldId: middleEarth.id,
      },
    }),
  ]);

  console.log(`✅ Created ${books.length} books`);

  console.log("👤 Creating users...");

  // Create sample users
  const passwordHash = await bcrypt.hash("password123", 10);

  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: "alice@example.com",
        passwordHash,
        name: "Alice Reader",
        bio: "Avid reader of classic literature and sci-fi. Always looking for my next great read!",
        avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
      },
    }),
    prisma.user.create({
      data: {
        email: "bob@example.com",
        passwordHash,
        name: "Bob Bookworm",
        bio: "Fantasy enthusiast and aspiring writer. Let's discuss our favorite worlds!",
        avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Bob",
      },
    }),
    prisma.user.create({
      data: {
        email: "carol@example.com",
        passwordHash,
        name: "Carol Chapter",
        bio: "Reading is my superpower. Dystopian fiction is my guilty pleasure.",
        avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Carol",
      },
    }),
  ]);

  console.log(`✅ Created ${users.length} users`);

  console.log("📖 Creating default shelves...");

  // Create default shelves for each user
  const defaultShelfNames = ["Want to Read", "Currently Reading", "Read"];

  for (const user of users) {
    for (const shelfName of defaultShelfNames) {
      await prisma.shelf.create({
        data: {
          userId: user.id,
          name: shelfName,
          isDefault: true,
        },
      });
    }
  }

  console.log("✅ Created default shelves for all users");

  // Get shelves for adding books
  const aliceShelves = await prisma.shelf.findMany({
    where: { userId: users[0].id },
  });
  const bobShelves = await prisma.shelf.findMany({
    where: { userId: users[1].id },
  });
  const carolShelves = await prisma.shelf.findMany({
    where: { userId: users[2].id },
  });

  console.log("📚 Adding books to shelves...");

  // Alice's shelf items
  const aliceReadShelf = aliceShelves.find((s) => s.name === "Read")!;
  const aliceReadingShelf = aliceShelves.find((s) => s.name === "Currently Reading")!;
  const aliceWantShelf = aliceShelves.find((s) => s.name === "Want to Read")!;

  await prisma.shelfItem.createMany({
    data: [
      { shelfId: aliceReadShelf.id, bookId: books[0].id }, // 1984
      { shelfId: aliceReadShelf.id, bookId: books[1].id }, // To Kill a Mockingbird
      { shelfId: aliceReadShelf.id, bookId: books[2].id }, // Great Gatsby
      { shelfId: aliceReadingShelf.id, bookId: books[5].id }, // Dune
      { shelfId: aliceWantShelf.id, bookId: books[4].id }, // The Hobbit
      { shelfId: aliceWantShelf.id, bookId: books[9].id }, // LOTR
    ],
  });

  // Bob's shelf items
  const bobReadShelf = bobShelves.find((s) => s.name === "Read")!;
  const bobReadingShelf = bobShelves.find((s) => s.name === "Currently Reading")!;
  const bobWantShelf = bobShelves.find((s) => s.name === "Want to Read")!;

  await prisma.shelfItem.createMany({
    data: [
      { shelfId: bobReadShelf.id, bookId: books[4].id }, // The Hobbit
      { shelfId: bobReadShelf.id, bookId: books[9].id }, // LOTR
      { shelfId: bobReadingShelf.id, bookId: books[3].id }, // Pride and Prejudice
      { shelfId: bobWantShelf.id, bookId: books[0].id }, // 1984
      { shelfId: bobWantShelf.id, bookId: books[5].id }, // Dune
    ],
  });

  // Carol's shelf items
  const carolReadShelf = carolShelves.find((s) => s.name === "Read")!;
  const carolReadingShelf = carolShelves.find((s) => s.name === "Currently Reading")!;
  const carolWantShelf = carolShelves.find((s) => s.name === "Want to Read")!;

  await prisma.shelfItem.createMany({
    data: [
      { shelfId: carolReadShelf.id, bookId: books[0].id }, // 1984
      { shelfId: carolReadShelf.id, bookId: books[8].id }, // Brave New World
      { shelfId: carolReadingShelf.id, bookId: books[7].id }, // 100 Years of Solitude
      { shelfId: carolWantShelf.id, bookId: books[6].id }, // Catcher in the Rye
    ],
  });

  console.log("✅ Added books to shelves");

  console.log("⭐ Creating reviews...");

  // Create reviews
  await prisma.review.createMany({
    data: [
      {
        userId: users[0].id,
        bookId: books[0].id,
        rating: 5,
        content:
          "A masterpiece of dystopian fiction. Orwell's vision is terrifyingly prescient. The way he explores surveillance, truth, and power is more relevant than ever.",
      },
      {
        userId: users[0].id,
        bookId: books[1].id,
        rating: 5,
        content:
          "A beautifully written story about justice, morality, and growing up. Atticus Finch remains one of literature's greatest heroes.",
      },
      {
        userId: users[0].id,
        bookId: books[2].id,
        rating: 4,
        content:
          "Fitzgerald's prose is absolutely gorgeous. The tragedy of Gatsby's dream is both heartbreaking and thought-provoking.",
      },
      {
        userId: users[1].id,
        bookId: books[4].id,
        rating: 5,
        content:
          "The book that started my love of fantasy! Bilbo's journey from comfort to courage is timeless. A perfect adventure story.",
      },
      {
        userId: users[1].id,
        bookId: books[9].id,
        rating: 5,
        content:
          "The greatest fantasy epic ever written. Tolkien created an entire world with its own languages, history, and mythology. Absolutely incredible.",
      },
      {
        userId: users[2].id,
        bookId: books[0].id,
        rating: 5,
        content:
          "Chilling and unforgettable. Every page drips with dread. The ending left me thinking for days.",
      },
      {
        userId: users[2].id,
        bookId: books[8].id,
        rating: 4,
        content:
          "A different kind of dystopia - controlled by pleasure rather than pain. Huxley's vision is equally terrifying in its own way.",
      },
    ],
  });

  console.log("✅ Created reviews");

  console.log("📈 Creating reading progress...");

  // Create reading progress
  await prisma.readingProgress.createMany({
    data: [
      {
        userId: users[0].id,
        bookId: books[5].id, // Dune
        currentPage: 245,
        startedAt: new Date("2024-01-15"),
      },
      {
        userId: users[1].id,
        bookId: books[3].id, // Pride and Prejudice
        currentPage: 128,
        startedAt: new Date("2024-02-01"),
      },
      {
        userId: users[2].id,
        bookId: books[7].id, // 100 Years of Solitude
        currentPage: 189,
        startedAt: new Date("2024-01-20"),
      },
    ],
  });

  console.log("✅ Created reading progress");

  console.log("👥 Creating follows...");

  // Create follows
  await prisma.follow.createMany({
    data: [
      { followerId: users[0].id, followingId: users[1].id },
      { followerId: users[0].id, followingId: users[2].id },
      { followerId: users[1].id, followingId: users[0].id },
      { followerId: users[2].id, followingId: users[0].id },
      { followerId: users[2].id, followingId: users[1].id },
    ],
  });

  console.log("✅ Created follows");

  console.log("🎉 Seed completed successfully!");
  console.log("\n📋 Sample Login Credentials:");
  console.log("   Email: alice@example.com");
  console.log("   Password: password123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
