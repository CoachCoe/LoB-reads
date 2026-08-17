/**
 * Twenty well-known titles, used for the M2 search acceptance check: a title
 * search for each must return it in the top three results.
 *
 * They are chosen to be adversarial rather than easy. Several share a first
 * word with a sequel or a namesake ("Dune" / "Dune Messiah", "Foundation" /
 * "Foundation and Empire"), several carry accents, and several are short
 * common words that appear inside other titles ("It", "Emma"). A ranking that
 * only sorts by ts_rank will get these wrong.
 */
export interface KnownBook {
  workKey: string;
  title: string;
  author: string;
  authorKey: string;
  year: number;
  subjects: string[];
  /** Titles that should NOT outrank it, present in the fixture as distractors. */
  distractors?: string[];
}

export const KNOWN_BOOKS: KnownBook[] = [
  { workKey: "OLK001W", title: "Dune", author: "Frank Herbert", authorKey: "OLA001A", year: 1965,
    subjects: ["Science Fiction", "Desert"], distractors: ["Dune Messiah", "Children of Dune", "The Dune Encyclopedia"] },
  { workKey: "OLK002W", title: "The Hobbit", author: "J. R. R. Tolkien", authorKey: "OLA002A", year: 1937,
    subjects: ["Fantasy", "Adventure"], distractors: ["The Annotated Hobbit", "The Hobbit: An Unexpected Journey"] },
  { workKey: "OLK003W", title: "One Hundred Years of Solitude", author: "Gabriel García Márquez", authorKey: "OLA003A", year: 1967,
    subjects: ["Magical Realism"] },
  { workKey: "OLK004W", title: "Foundation", author: "Isaac Asimov", authorKey: "OLA004A", year: 1951,
    subjects: ["Science Fiction"], distractors: ["Foundation and Empire", "Second Foundation", "Foundation's Edge"] },
  { workKey: "OLK005W", title: "It", author: "Stephen King", authorKey: "OLA005A", year: 1986,
    subjects: ["Horror"], distractors: ["It Ends with Us", "It Can't Happen Here"] },
  { workKey: "OLK006W", title: "Emma", author: "Jane Austen", authorKey: "OLA006A", year: 1815,
    subjects: ["Classic Literature"], distractors: ["Emma Brown", "The Emma Chase Collection"] },
  { workKey: "OLK007W", title: "Beloved", author: "Toni Morrison", authorKey: "OLA007A", year: 1987,
    subjects: ["Historical Fiction"] },
  { workKey: "OLK008W", title: "Les Misérables", author: "Victor Hugo", authorKey: "OLA008A", year: 1862,
    subjects: ["Classic Literature", "France"] },
  { workKey: "OLK009W", title: "Nineteen Eighty-Four", author: "George Orwell", authorKey: "OLA009A", year: 1949,
    subjects: ["Dystopian"] },
  { workKey: "OLK010W", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", authorKey: "OLA010A", year: 1969,
    subjects: ["Science Fiction"] },
  { workKey: "OLK011W", title: "Things Fall Apart", author: "Chinua Achebe", authorKey: "OLA011A", year: 1958,
    subjects: ["Historical Fiction", "Nigeria"] },
  { workKey: "OLK012W", title: "Neuromancer", author: "William Gibson", authorKey: "OLA012A", year: 1984,
    subjects: ["Cyberpunk"] },
  { workKey: "OLK013W", title: "The Remains of the Day", author: "Kazuo Ishiguro", authorKey: "OLA013A", year: 1989,
    subjects: ["Literary Fiction"] },
  { workKey: "OLK014W", title: "Wolf Hall", author: "Hilary Mantel", authorKey: "OLA014A", year: 2009,
    subjects: ["Historical Fiction"] },
  { workKey: "OLK015W", title: "The Handmaid's Tale", author: "Margaret Atwood", authorKey: "OLA015A", year: 1985,
    subjects: ["Dystopian"], distractors: ["The Handmaid's Tale: The Graphic Novel"] },
  { workKey: "OLK016W", title: "Kindred", author: "Octavia E. Butler", authorKey: "OLA016A", year: 1979,
    subjects: ["Science Fiction"] },
  { workKey: "OLK017W", title: "Crime and Punishment", author: "Fyodor Dostoevsky", authorKey: "OLA017A", year: 1866,
    subjects: ["Classic Literature", "Russia"] },
  { workKey: "OLK018W", title: "The Name of the Rose", author: "Umberto Eco", authorKey: "OLA018A", year: 1980,
    subjects: ["Historical Mystery"] },
  { workKey: "OLK019W", title: "Pachinko", author: "Min Jin Lee", authorKey: "OLA019A", year: 2017,
    subjects: ["Historical Fiction", "Korea"] },
  { workKey: "OLK020W", title: "Piranesi", author: "Susanna Clarke", authorKey: "OLA020A", year: 2020,
    subjects: ["Fantasy"] },
];
