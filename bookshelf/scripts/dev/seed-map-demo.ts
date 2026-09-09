/**
 * Put a browsable set of real books on /map.
 *
 *   npm run demo:map -- --dry-run   # resolve against the catalog, write nothing
 *   npm run demo:map                # replace the demo pins
 *
 * `prisma/seed.ts` cannot do this. It seeds a fixture catalog of its own so a
 * fresh clone works with no ingest, which means its pins point at OLK*W keys —
 * and a real ingest replaces catalog.* wholesale, so those keys are gone and
 * every pin renders "a book no longer in the catalog". This script goes the
 * other way: it requires a populated catalog and resolves each curated title to
 * a real work key, so a pin's popup shows a title and links to a page that
 * exists.
 *
 * The books are curated rather than derived. `subject_places` in the Open
 * Library dumps looked like a shortcut, but its top values are "United States",
 * "China", "Great Britain" — cataloguing subject headings, not settings, and a
 * country is not a point. A hand-built list of well-known books with a known
 * real-world setting is what makes the map worth clicking.
 *
 * Machine-derived pins would need a provenance column before they went in here:
 * PRD section 6 measures "works with a reader-contributed location", and that
 * signal is worth nothing if this script's rows are counted in it. These are
 * attributed to the demo accounts, which is the same reason they are safe to
 * delete on re-run.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import "../enrich/env";
import prisma from "@/lib/prisma";

interface DemoPin {
  title: string;
  author: string;
  place: string;
  lat: number;
  lng: number;
  type: "setting" | "mentioned" | "inspired_by";
  note?: string;
  /**
   * Pin this exact catalog work instead of matching on title and author.
   *
   * Open Library files a translated work under its original-language title, so
   * an English title either misses ("Season of Migration to the North" is
   * "Mawsim al-hijrah ilá al-shamāl") or, worse, trigram-matches a different
   * book: "The House of the Spirits" scored 0.58 against "The House of Happy
   * Spirits", and "The Vegetarian" against a cookbook called "The vegetarians".
   * Where that happens the key is fixed here, verified against the catalog by
   * hand, and the popup shows the original title — which is accurate, and much
   * better than confidently showing the wrong book.
   */
  workKey?: string;
}

/**
 * Title and author are scored separately, and both must clear their own bar.
 *
 * `findCandidates` in the import path is the wrong tool here, and reusing it
 * put five wrong books on the map. It ranks by a *blend*
 * (0.7 * title + 0.3 * author), so a junk one-edition record whose title
 * matches exactly scores 0.7 on the title alone and outranks the canonical
 * work — which usually carries a subtitle and therefore scores lower. It
 * resolved "The Name of the Rose" to "Name of the Rosé" by Christine E. Blum,
 * and "The Magic Mountain" to a book by an economist. Blending hides a
 * zero-similarity author behind a perfect title; two independent thresholds
 * cannot.
 *
 * That blend is right for its own job — it decides what to *offer a reader* for
 * confirmation, and a human catches the absurd ones. Nothing confirms these.
 */
const MIN_TITLE_SCORE = 0.5;
const MIN_AUTHOR_SCORE = 0.35;

/**
 * The author's surname must also appear as a whole word.
 *
 * Trigram similarity alone cannot separate "Thomas Mann" from "Thomas B.
 * Dozeman" or "Umberto Eco" from "Umberto Estrobes" — a shared forename is
 * most of a short string — and both of those reached the map as "God on the
 * mountain" and "Gnome of the Rose". A whole-word surname test is the cheap
 * discriminator the score cannot be.
 *
 * It fails closed: where the catalog spells a surname differently
 * (Dostoyevsky/Dostoevsky) the book is skipped rather than guessed at, and the
 * fix is a `workKey` above.
 */
function surname(author: string): string {
  const words = author.trim().split(/\s+/);
  return words[words.length - 1].toLowerCase();
}

const DEMO_PINS: DemoPin[] = [
  // British Isles
  { title: "Mrs Dalloway", author: "Virginia Woolf", place: "Westminster, London", lat: 51.4995, lng: -0.1248, type: "setting", note: "One June day's walk across the city." },
  { title: "Oliver Twist", author: "Charles Dickens", place: "Clerkenwell, London", lat: 51.5225, lng: -0.1057, type: "setting" },
  { title: "The Adventures of Sherlock Holmes", author: "Arthur Conan Doyle", place: "Baker Street, London", lat: 51.5237, lng: -0.1585, type: "setting" },
  { title: "Pride and Prejudice", author: "Jane Austen", place: "Hertfordshire", lat: 51.8098, lng: -0.2377, type: "setting" },
  { title: "Wuthering Heights", author: "Emily Bronte", place: "The West Yorkshire moors", lat: 53.8329, lng: -1.9569, type: "setting" },
  { title: "Jane Eyre", author: "Charlotte Bronte", place: "The Derbyshire Peak", lat: 53.2514, lng: -1.6203, type: "inspired_by", note: "Thornfield Hall's likely model." },
  { title: "Brideshead Revisited", author: "Evelyn Waugh", place: "Oxford", lat: 51.7520, lng: -1.2577, type: "setting" },
  { title: "Trainspotting", author: "Irvine Welsh", place: "Leith, Edinburgh", lat: 55.9750, lng: -3.1690, type: "setting" },
  { title: "Under Milk Wood", author: "Dylan Thomas", place: "Laugharne, Wales", lat: 51.7717, lng: -4.4636, type: "inspired_by", workKey: "OL1358969W", },
  { title: "Ulysses", author: "James Joyce", place: "Dublin", lat: 53.3498, lng: -6.2603, type: "setting", note: "16 June 1904, end to end." },
  { title: "Dubliners", author: "James Joyce", place: "Dublin", lat: 53.3441, lng: -6.2675, type: "setting" },
  { title: "Angela's Ashes", author: "Frank McCourt", place: "Limerick", lat: 52.6638, lng: -8.6267, type: "setting" },

  // France, Iberia, Italy
  { title: "Les Miserables", author: "Victor Hugo", place: "Paris", lat: 48.8566, lng: 2.3522, type: "setting" },
  { title: "The Hunchback of Notre Dame", author: "Victor Hugo", place: "Notre-Dame, Paris", lat: 48.8530, lng: 2.3499, type: "setting" },
  { title: "Madame Bovary", author: "Gustave Flaubert", place: "Rouen", lat: 49.4432, lng: 1.0993, type: "setting" },
  { title: "The Count of Monte Cristo", author: "Alexandre Dumas", place: "Marseille", lat: 43.2965, lng: 5.3698, type: "setting", workKey: "OL36287W", },
  { title: "A Moveable Feast", author: "Ernest Hemingway", place: "Montparnasse, Paris", lat: 48.8422, lng: 2.3250, type: "setting" },
  { title: "Perfume", author: "Patrick Suskind", place: "Grasse", lat: 43.6584, lng: 6.9225, type: "setting", workKey: "OL10834W", },
  { title: "Don Quixote", author: "Miguel de Cervantes", place: "La Mancha", lat: 39.2796, lng: -3.1004, type: "setting", workKey: "OL503666W", },
  { title: "The Shadow of the Wind", author: "Carlos Ruiz Zafon", place: "Barcelona", lat: 41.3851, lng: 2.1734, type: "setting", workKey: "OL278437W", },
  { title: "The Sun Also Rises", author: "Ernest Hemingway", place: "Pamplona", lat: 42.8125, lng: -1.6458, type: "setting" },
  { title: "For Whom the Bell Tolls", author: "Ernest Hemingway", place: "Sierra de Guadarrama", lat: 40.7906, lng: -3.9628, type: "setting" },
  { title: "The Name of the Rose", author: "Umberto Eco", place: "Piedmont", lat: 44.7000, lng: 8.0000, type: "setting", workKey: "OL8996439W", },
  { title: "Death in Venice", author: "Thomas Mann", place: "Venice", lat: 45.4408, lng: 12.3155, type: "setting", workKey: "OL16246083W", },
  { title: "The Leopard", author: "Giuseppe Tomasi di Lampedusa", place: "Palermo", lat: 38.1157, lng: 13.3615, type: "setting", workKey: "OL2386322W", },
  { title: "My Brilliant Friend", author: "Elena Ferrante", place: "Naples", lat: 40.8518, lng: 14.2681, type: "setting", workKey: "OL16520879W" },

  // Central and northern Europe
  { title: "Berlin Alexanderplatz", author: "Alfred Doblin", place: "Alexanderplatz, Berlin", lat: 52.5219, lng: 13.4132, type: "setting" },
  { title: "The Trial", author: "Franz Kafka", place: "Prague", lat: 50.0755, lng: 14.4378, type: "inspired_by", workKey: "OL498463W", },
  { title: "The Tin Drum", author: "Gunter Grass", place: "Gdansk", lat: 54.3520, lng: 18.6466, type: "setting", workKey: "OL67334W", },
  { title: "The Magic Mountain", author: "Thomas Mann", place: "Davos", lat: 46.8043, lng: 9.8370, type: "setting", workKey: "OL14866824W", },
  { title: "All Quiet on the Western Front", author: "Erich Maria Remarque", place: "The Western Front", lat: 50.4500, lng: 2.8300, type: "setting", workKey: "OL1209288W", },
  { title: "The Diary of a Young Girl", author: "Anne Frank", place: "Prinsengracht, Amsterdam", lat: 52.3752, lng: 4.8840, type: "setting" },
  { title: "Smilla's Sense of Snow", author: "Peter Hoeg", place: "Copenhagen", lat: 55.6761, lng: 12.5683, type: "setting", workKey: "OL258333W", },
  { title: "The Girl with the Dragon Tattoo", author: "Stieg Larsson", place: "Stockholm", lat: 59.3293, lng: 18.0686, type: "setting", workKey: "OL5784622W", },
  { title: "Kristin Lavransdatter", author: "Sigrid Undset", place: "Gudbrandsdalen", lat: 61.5000, lng: 9.5000, type: "setting" },
  { title: "Independent People", author: "Halldor Laxness", place: "The Icelandic highlands", lat: 64.9631, lng: -19.0208, type: "setting", workKey: "OL757983W", },

  // Russia and the east
  { title: "Crime and Punishment", author: "Fyodor Dostoevsky", place: "Saint Petersburg", lat: 59.9311, lng: 30.3609, type: "setting", workKey: "OL166894W", },
  { title: "Anna Karenina", author: "Leo Tolstoy", place: "Moscow", lat: 55.7558, lng: 37.6173, type: "setting", workKey: "OL267096W", },
  { title: "War and Peace", author: "Leo Tolstoy", place: "Borodino", lat: 55.5203, lng: 35.8206, type: "setting", workKey: "OL267171W", },
  { title: "Doctor Zhivago", author: "Boris Pasternak", place: "The Urals", lat: 58.0000, lng: 59.0000, type: "setting", workKey: "OL258301W", },
  { title: "The Master and Margarita", author: "Mikhail Bulgakov", place: "Patriarch's Ponds, Moscow", lat: 55.7639, lng: 37.5966, type: "setting", workKey: "OL676009W", },
  { title: "One Day in the Life of Ivan Denisovich", author: "Aleksandr Solzhenitsyn", place: "Vorkuta", lat: 67.4939, lng: 64.0361, type: "inspired_by", workKey: "OL258329W", },
  { title: "Zorba the Greek", author: "Nikos Kazantzakis", place: "Crete", lat: 35.2401, lng: 24.8093, type: "setting", workKey: "OL85509W", },
  { title: "The Odyssey", author: "Homer", place: "Ithaca", lat: 38.4194, lng: 20.6716, type: "setting", workKey: "OL61982W", },
  { title: "My Name Is Red", author: "Orhan Pamuk", place: "Istanbul", lat: 41.0082, lng: 28.9784, type: "setting", workKey: "OL1019598W" },

  // Africa
  { title: "Things Fall Apart", author: "Chinua Achebe", place: "Southeastern Nigeria", lat: 6.2000, lng: 7.0700, type: "setting" },
  { title: "Half of a Yellow Sun", author: "Chimamanda Ngozi Adichie", place: "Nsukka", lat: 6.8567, lng: 7.3958, type: "setting" },
  { title: "Cry, the Beloved Country", author: "Alan Paton", place: "Johannesburg", lat: -26.2041, lng: 28.0473, type: "setting" },
  { title: "Disgrace", author: "J. M. Coetzee", place: "Cape Town", lat: -33.9249, lng: 18.4241, type: "setting" },
  { title: "Out of Africa", author: "Isak Dinesen", place: "Ngong Hills, Nairobi", lat: -1.4000, lng: 36.6500, type: "setting" },
  { title: "The Yacoubian Building", author: "Alaa Al Aswany", place: "Downtown Cairo", lat: 30.0555, lng: 31.2394, type: "setting" },
  { title: "Season of Migration to the North", author: "Tayeb Salih", place: "The Nile north of Khartoum", lat: 18.5000, lng: 31.8000, type: "setting", workKey: "OL2970107W" },
  { title: "A Grain of Wheat", author: "Ngugi wa Thiong'o", place: "Central Kenya", lat: -0.4000, lng: 36.9500, type: "setting" },
  { title: "The Sheltering Sky", author: "Paul Bowles", place: "The Algerian Sahara", lat: 27.8700, lng: 5.0000, type: "setting" },

  // Middle East and South Asia
  { title: "The Kite Runner", author: "Khaled Hosseini", place: "Kabul", lat: 34.5553, lng: 69.2075, type: "setting" },
  { title: "A Thousand Splendid Suns", author: "Khaled Hosseini", place: "Herat", lat: 34.3529, lng: 62.2040, type: "setting" },
  { title: "Persepolis", author: "Marjane Satrapi", place: "Tehran", lat: 35.6892, lng: 51.3890, type: "setting" },
  { title: "Reading Lolita in Tehran", author: "Azar Nafisi", place: "Tehran", lat: 35.7219, lng: 51.3347, type: "setting" },
  { title: "Midnight's Children", author: "Salman Rushdie", place: "Bombay", lat: 19.0760, lng: 72.8777, type: "setting" },
  { title: "The God of Small Things", author: "Arundhati Roy", place: "Kerala", lat: 9.9312, lng: 76.2673, type: "setting" },
  { title: "A Fine Balance", author: "Rohinton Mistry", place: "Bombay", lat: 18.9388, lng: 72.8354, type: "setting" },
  { title: "The White Tiger", author: "Aravind Adiga", place: "Bangalore", lat: 12.9716, lng: 77.5946, type: "setting" },
  { title: "Train to Pakistan", author: "Khushwant Singh", place: "The Punjab border", lat: 31.1471, lng: 74.8700, type: "setting" },
  { title: "The Shadow Lines", author: "Amitav Ghosh", place: "Calcutta", lat: 22.5726, lng: 88.3639, type: "setting" },
  { title: "A Suitable Boy", author: "Vikram Seth", place: "The Ganges plain", lat: 26.4499, lng: 80.3319, type: "inspired_by" },
  { title: "Life of Pi", author: "Yann Martel", place: "Pondicherry", lat: 11.9416, lng: 79.8083, type: "setting" },

  // East and Southeast Asia
  { title: "Norwegian Wood", author: "Haruki Murakami", place: "Tokyo", lat: 35.6762, lng: 139.6503, type: "setting", workKey: "OL2625457W", },
  { title: "Snow Country", author: "Yasunari Kawabata", place: "Yuzawa, Niigata", lat: 36.9370, lng: 138.8100, type: "setting", workKey: "OL2045111W", },
  { title: "Memoirs of a Geisha", author: "Arthur Golden", place: "Gion, Kyoto", lat: 35.0037, lng: 135.7788, type: "setting" },
  { title: "Silence", author: "Shusaku Endo", place: "Nagasaki", lat: 32.7503, lng: 129.8779, type: "setting" },
  { title: "Wild Swans", author: "Jung Chang", place: "Chengdu", lat: 30.5728, lng: 104.0668, type: "setting" },
  { title: "Red Sorghum", author: "Mo Yan", place: "Shandong", lat: 36.3000, lng: 118.5000, type: "setting" },
  { title: "The Vegetarian", author: "Han Kang", place: "Seoul", lat: 37.5172, lng: 127.0473, type: "setting", workKey: "OL17334243W" },
  { title: "The Quiet American", author: "Graham Greene", place: "Saigon", lat: 10.8231, lng: 106.6297, type: "setting" },
  { title: "Burmese Days", author: "George Orwell", place: "Katha, Burma", lat: 24.1833, lng: 96.3500, type: "inspired_by" },
  { title: "The Year of Living Dangerously", author: "Christopher Koch", place: "Jakarta", lat: -6.2088, lng: 106.8456, type: "setting" },

  // Oceania
  { title: "Picnic at Hanging Rock", author: "Joan Lindsay", place: "Hanging Rock, Victoria", lat: -37.3000, lng: 144.5800, type: "setting" },
  { title: "Cloudstreet", author: "Tim Winton", place: "Perth", lat: -31.9523, lng: 115.8613, type: "setting" },
  { title: "The Bone People", author: "Keri Hulme", place: "The West Coast, New Zealand", lat: -43.5000, lng: 170.2000, type: "setting" },
  { title: "The Luminaries", author: "Eleanor Catton", place: "Hokitika", lat: -42.7167, lng: 170.9667, type: "setting" },

  // United States and Canada
  { title: "The Great Gatsby", author: "F. Scott Fitzgerald", place: "The North Shore, Long Island", lat: 40.8000, lng: -73.5000, type: "setting" },
  { title: "To Kill a Mockingbird", author: "Harper Lee", place: "Monroeville, Alabama", lat: 31.5274, lng: -87.3247, type: "inspired_by", note: "Maycomb's model, and the author's home town." },
  { title: "Moby Dick", author: "Herman Melville", place: "Nantucket", lat: 41.2835, lng: -70.0995, type: "setting" },
  { title: "The Grapes of Wrath", author: "John Steinbeck", place: "Bakersfield, California", lat: 35.3733, lng: -119.0187, type: "setting" },
  { title: "Cannery Row", author: "John Steinbeck", place: "Monterey", lat: 36.6177, lng: -121.9016, type: "setting" },
  { title: "On the Road", author: "Jack Kerouac", place: "Denver", lat: 39.7392, lng: -104.9903, type: "setting" },
  { title: "The Catcher in the Rye", author: "J. D. Salinger", place: "Manhattan", lat: 40.7812, lng: -73.9665, type: "setting" },
  { title: "Beloved", author: "Toni Morrison", place: "Cincinnati", lat: 39.1031, lng: -84.5120, type: "setting" },
  { title: "Their Eyes Were Watching God", author: "Zora Neale Hurston", place: "Eatonville, Florida", lat: 28.6144, lng: -81.3819, type: "setting" },
  { title: "A Confederacy of Dunces", author: "John Kennedy Toole", place: "New Orleans", lat: 29.9511, lng: -90.0715, type: "setting" },
  { title: "The Shipping News", author: "Annie Proulx", place: "Newfoundland", lat: 49.0000, lng: -55.0000, type: "setting" },
  { title: "Housekeeping", author: "Marilynne Robinson", place: "Northern Idaho", lat: 47.6000, lng: -116.8000, type: "setting" },
  { title: "Middlesex", author: "Jeffrey Eugenides", place: "Detroit", lat: 42.3314, lng: -83.0458, type: "setting" },
  { title: "Lonesome Dove", author: "Larry McMurtry", place: "The Rio Grande, Texas", lat: 29.3600, lng: -100.9000, type: "setting" },
  { title: "Angle of Repose", author: "Wallace Stegner", place: "Grass Valley, California", lat: 39.2191, lng: -121.0611, type: "setting" },
  { title: "Empire Falls", author: "Richard Russo", place: "Central Maine", lat: 44.5000, lng: -69.6000, type: "setting" },
  { title: "Rabbit, Run", author: "John Updike", place: "Reading, Pennsylvania", lat: 40.3356, lng: -75.9269, type: "inspired_by" },
  { title: "Anne of Green Gables", author: "L. M. Montgomery", place: "Prince Edward Island", lat: 46.4874, lng: -63.3865, type: "setting" },
  { title: "The Stone Angel", author: "Margaret Laurence", place: "Southern Manitoba", lat: 50.0000, lng: -98.3000, type: "setting" },

  // Latin America
  { title: "One Hundred Years of Solitude", author: "Gabriel Garcia Marquez", place: "Aracataca", lat: 10.5917, lng: -74.1936, type: "inspired_by", note: "The town Macondo was built from.", workKey: "OL274505W", },
  { title: "Love in the Time of Cholera", author: "Gabriel Garcia Marquez", place: "Cartagena", lat: 10.3910, lng: -75.4794, type: "inspired_by", workKey: "OL274518W" },
  { title: "The House of the Spirits", author: "Isabel Allende", place: "Santiago", lat: -33.4489, lng: -70.6693, type: "setting", workKey: "OL1905255W" },
  { title: "Pedro Paramo", author: "Juan Rulfo", place: "Comala, Colima", lat: 19.3239, lng: -103.7583, type: "setting" },
  { title: "The Death of Artemio Cruz", author: "Carlos Fuentes", place: "Mexico City", lat: 19.4326, lng: -99.1332, type: "setting", workKey: "OL872220W", },
  { title: "Hopscotch", author: "Julio Cortazar", place: "Buenos Aires", lat: -34.6037, lng: -58.3816, type: "setting", workKey: "OL14860424W", },
  { title: "Captains of the Sands", author: "Jorge Amado", place: "Salvador, Bahia", lat: -12.9777, lng: -38.5016, type: "setting", workKey: "OL1248157W" },
];

/**
 * Author places, keyed by catalog author rather than by name.
 *
 * `prisma/seed.ts` points these at its fixture keys (OLA001A, OLA002A), which a
 * real ingest removes — so both pins rendered "an author no longer in the
 * catalog", and worse than the work case: the popup links
 * `/author/<name>`, so a missing author has no link to give.
 */
interface AuthorPin {
  authorKey: string;
  /** For the log only; the name shown comes from the catalog. */
  who: string;
  place: string;
  lat: number;
  lng: number;
  type: string;
  yearStart?: number;
  yearEnd?: number;
}

const AUTHOR_PINS: AuthorPin[] = [
  { authorKey: "OL26320A", who: "J.R.R. Tolkien", place: "Oxford, UK", lat: 51.752, lng: -1.2577,
    type: "residence", yearStart: 1925, yearEnd: 1968 },
  { authorKey: "OL79034A", who: "Frank Herbert", place: "Tacoma, Washington", lat: 47.2529,
    lng: -122.4443, type: "birthplace" },
];

/**
 * Fictional places, which are pinned to a world rather than a coordinate.
 *
 * They deliberately carry no lat/lng: `getMappedWorkLocations` filters them out
 * of the dot layer, and they surface in the FictionalWorldsPanel instead. The
 * panel's per-world work count comes from these rows — not from
 * `work_fictional_worlds` — so a world with no fictional location reads as
 * empty however many maps it has, which is why Middle-earth needs these and not
 * just the image.
 */
interface WorldSeed {
  world: string;
  description: string;
  /**
   * Served from `public/`, so it renders with no object storage configured.
   *
   * Deliberately not committed — the images that suit these worlds are
   * published artwork, and this repo is a candidate for open-sourcing. So the
   * path is treated as optional: drop a file at `public/<file>` and the world
   * gets its map, leave it absent and the world is seeded without one.
   */
  image?: { file: string; title: string; description: string };
  places: { name: string; workKey: string }[];
}

const DEMO_WORLDS: WorldSeed[] = [
  {
    world: "Middle-earth",
    description: "Hobbits, and worse.",
    image: {
      file: "/fictional-worlds/middle-earth.webp",
      title: "Middle-earth, West of the Sea",
      description:
        "Eriador and Rhovanion down to Gondor and Mordor, with the Shire in the northwest.",
    },
    places: [
      { name: "The Shire", workKey: "OL27482W" },
      { name: "Rivendell", workKey: "OL27482W" },
      { name: "Minas Tirith", workKey: "OL27455W" },
      { name: "Mordor", workKey: "OL27479W" },
      { name: "Moria", workKey: "OL27513W" },
    ],
  },
  {
    world: "Arrakis",
    description: "The desert planet.",
    places: [{ name: "Arrakeen", workKey: "OL893414W" }],
  },
];

interface Resolved extends DemoPin {
  workKey: string;
  catalogTitle: string;
  catalogAuthor: string | null;
  editionCount: number;
  /** Null for a pinned key, which was matched by hand rather than scored. */
  score: number | null;
}

interface CatalogRow {
  title: string;
  authorNames: string | null;
  editionCount: number;
}

async function catalogRow(workKey: string): Promise<CatalogRow | null> {
  const rows = await prisma.$queryRaw<CatalogRow[]>`
    SELECT title, author_names AS "authorNames", edition_count AS "editionCount"
    FROM catalog.works WHERE ol_key = ${workKey}
  `;
  return rows[0] ?? null;
}

async function resolve(pin: DemoPin): Promise<Resolved | null> {
  if (pin.workKey) {
    // Still checked rather than trusted: a rebuilt catalog can drop a key, and
    // a pin at a key that is gone is the "no longer in the catalog" popup this
    // script exists to get rid of.
    const row = await catalogRow(pin.workKey);
    if (!row) return null;
    return {
      ...pin,
      workKey: pin.workKey,
      catalogTitle: row.title,
      catalogAuthor: row.authorNames,
      editionCount: row.editionCount,
      score: null,
    };
  }

  // Ordered by edition count, not by similarity: among works that are plausibly
  // this book, the one with the most editions is the one a reader means, and the
  // one most likely to have a cover. Similarity only decides who is eligible.
  //
  // `title_norm % q.tq` rather than a similarity() predicate so the trigram
  // index is usable — same reason as the note in catalog.ts.
  const rows = await prisma.$queryRaw<
    (CatalogRow & { workKey: string; titleScore: number; authorScore: number })[]
  >`
    WITH q AS (
      SELECT lower(unaccent(${pin.title})) AS tq,
             lower(unaccent(${pin.author})) AS aq
    )
    SELECT w.ol_key AS "workKey",
           w.title,
           w.author_names AS "authorNames",
           w.edition_count AS "editionCount",
           similarity(w.title_norm, q.tq)::double precision AS "titleScore",
           similarity(coalesce(w.author_names_norm, ''), q.aq)::double precision AS "authorScore"
    FROM catalog.works w
    CROSS JOIN q
    WHERE w.title_norm % q.tq
      AND similarity(w.title_norm, q.tq) >= ${MIN_TITLE_SCORE}
      AND similarity(coalesce(w.author_names_norm, ''), q.aq) >= ${MIN_AUTHOR_SCORE}
      AND coalesce(w.author_names_norm, '') ~ ${`\\y${surname(pin.author)}\\y`}
    ORDER BY w.edition_count DESC, similarity(w.title_norm, q.tq) DESC, w.ol_key
    LIMIT 1
  `;

  const best = rows[0];
  if (!best) return null;
  return {
    ...pin,
    workKey: best.workKey,
    catalogTitle: best.title,
    catalogAuthor: best.authorNames,
    editionCount: best.editionCount,
    score: best.titleScore,
  };
}

/**
 * Attach each world's image and fictional places.
 *
 * The image is a path under `public/` rather than an upload. The real
 * contribution path posts to `/api/fictional-worlds/[worldId]/upload`, which
 * needs object storage — and its blob URL would also have to be added to
 * `next.config.ts` `remotePatterns` before `next/image` would render it, then
 * would die with the Azurite container. A static asset needs none of that and
 * survives a restart, which is what a demo wants. Uploading through the API
 * remains the way to test the upload path; `npm run storage:smoke` covers it.
 */
async function seedWorlds(demoUserIds: string[]): Promise<void> {
  for (const [i, seed] of DEMO_WORLDS.entries()) {
    const addedById = demoUserIds[i % demoUserIds.length];

    const world =
      (await prisma.fictionalWorld.findFirst({ where: { name: seed.world } })) ??
      (await prisma.fictionalWorld.create({
        data: { name: seed.world, description: seed.description },
      }));

    // Absent is a normal state, not a failure: the image is gitignored, so a
    // fresh clone has none until someone supplies one.
    const image =
      seed.image && existsSync(path.join("public", seed.image.file)) ? seed.image : null;

    if (image) {
      // Replaced rather than added to, so re-running does not stack duplicates
      // of the same map. Only this world's maps are touched.
      await prisma.fictionalWorldMap.deleteMany({ where: { fictionalWorldId: world.id } });
      await prisma.fictionalWorldMap.create({
        data: {
          fictionalWorldId: world.id,
          imageUrl: image.file,
          title: image.title,
          description: image.description,
          addedById,
        },
      });
    }

    await prisma.workLocation.deleteMany({
      where: { isFictional: true, fictionalWorldId: world.id },
    });
    await prisma.workLocation.createMany({
      data: seed.places.map((place) => ({
        workKey: place.workKey,
        addedById,
        name: place.name,
        type: "setting",
        isFictional: true,
        fictionalWorldId: world.id,
      })),
    });

    const places = seed.places.length;
    const mapNote = image
      ? `, map "${image.title}"`
      : seed.image
        ? `, no map (public${seed.image.file} not present)`
        : "";
    console.log(`  ${seed.world}: ${places} place${places === 1 ? "" : "s"}${mapNote}`);
  }
}

/** Author places, skipping any whose author the current catalog lacks. */
async function seedAuthorPins(demoUserIds: string[]): Promise<void> {
  const present = await prisma.$queryRaw<{ olKey: string; name: string }[]>`
    SELECT ol_key AS "olKey", name FROM catalog.authors
    WHERE ol_key = ANY(${AUTHOR_PINS.map((p) => p.authorKey)})
  `;
  const nameByKey = new Map(present.map((row) => [row.olKey, row.name]));

  await prisma.authorLocation.deleteMany({
    where: { addedById: { in: demoUserIds } },
  });

  const usable = AUTHOR_PINS.filter((pin) => nameByKey.has(pin.authorKey));
  await prisma.authorLocation.createMany({
    data: usable.map((pin, i) => ({
      authorKey: pin.authorKey,
      addedById: demoUserIds[i % demoUserIds.length],
      name: pin.place,
      type: pin.type,
      lat: pin.lat,
      lng: pin.lng,
      yearStart: pin.yearStart ?? null,
      yearEnd: pin.yearEnd ?? null,
    })),
  });

  for (const pin of usable) {
    console.log(`  ${nameByKey.get(pin.authorKey)} — ${pin.place}`);
  }
  for (const pin of AUTHOR_PINS.filter((p) => !nameByKey.has(p.authorKey))) {
    console.log(`  skipped, not in catalog: ${pin.who}`);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const demoUsers = await prisma.user.findMany({
    where: { email: { in: ["alice@example.com", "bob@example.com", "carol@example.com"] } },
    select: { id: true, name: true },
    orderBy: { email: "asc" },
  });
  if (demoUsers.length === 0) {
    throw new Error("No demo accounts found. Run `npm run db:seed` first.");
  }

  const resolved: Resolved[] = [];
  const unresolved: DemoPin[] = [];
  for (const pin of DEMO_PINS) {
    const match = await resolve(pin);
    if (match) resolved.push(match);
    else unresolved.push(pin);
  }

  for (const pin of resolved) {
    const how = pin.score === null ? "pinned" : pin.score.toFixed(2);
    const drift =
      pin.catalogTitle.toLowerCase() === pin.title.toLowerCase()
        ? ""
        : ` (catalog: "${pin.catalogTitle}")`;
    console.log(
      `  ${how.padStart(6)}  ${pin.workKey.padEnd(12)} ${String(pin.editionCount).padStart(3)}ed  ` +
        `${pin.title}${drift} / ${pin.catalogAuthor ?? "?"} — ${pin.place}`
    );
  }
  if (unresolved.length > 0) {
    console.log(`\nNot in this catalog slice, skipped:`);
    for (const pin of unresolved) console.log(`  ${pin.title} / ${pin.author}`);
  }
  console.log(
    `\n${resolved.length}/${DEMO_PINS.length} resolved, ${unresolved.length} skipped`
  );

  if (dryRun) {
    console.log("\n--dry-run: nothing written");
    await prisma.$disconnect();
    return;
  }

  // Only the demo accounts' real-world pins. A genuine contribution from any
  // other account is left alone, and so is the seed's fictional Arrakeen pin,
  // which belongs to a world rather than a coordinate.
  const removed = await prisma.workLocation.deleteMany({
    where: { isFictional: false, addedById: { in: demoUsers.map((u) => u.id) } },
  });

  await prisma.workLocation.createMany({
    data: resolved.map((pin, i) => ({
      workKey: pin.workKey,
      addedById: demoUsers[i % demoUsers.length].id,
      name: pin.place,
      type: pin.type,
      description: pin.note ?? null,
      lat: pin.lat,
      lng: pin.lng,
      isFictional: false,
    })),
  });

  console.log(`\nReplaced ${removed.count} demo pins with ${resolved.length}.`);

  console.log("\nFictional worlds:");
  await seedWorlds(demoUsers.map((u) => u.id));

  console.log("\nAuthor places:");
  await seedAuthorPins(demoUsers.map((u) => u.id));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
