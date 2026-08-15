/**
 * A11's parser, pure. CSV in, a roster a board can read before anything is written.
 *
 * No `@/db` import, so it is testable without a database, and no network, so what a spreadsheet
 * means is decided by a function rather than by whatever Google returned that morning.
 *
 * **It never returns a team it is sure about.** Every row comes back as a candidate carrying its own
 * problems, because the product's whole claim is that a board decides and the record remembers --
 * an importer that silently dropped the rows it could not read would be the acceptance-doc-vs-Venmo
 * split arriving through a new door.
 */

/** What a column means to us, keyed by the header text a board might plausibly have typed. */
const HEADER_ALIASES: Record<string, readonly string[]> = {
  name: ["team", "team name", "name", "group", "group name"],
  school: ["school", "university", "college", "institution"],
  rosterSize: ["dancers", "roster", "roster size", "size", "# dancers", "num dancers", "count"],
  rooms: ["rooms", "hotel rooms", "room count", "# rooms"],
  contactName: ["captain", "captain name", "contact", "contact name", "primary contact"],
  contactEmail: ["email", "captain email", "contact email", "e-mail"],
};

export type ImportColumn = keyof typeof HEADER_ALIASES;

export type CandidateProblem =
  | { kind: "missing-name" }
  | { kind: "unreadable-number"; column: "rosterSize" | "rooms"; raw: string }
  | { kind: "unreadable-email"; raw: string }
  | { kind: "duplicate-name"; of: number };

export type TeamCandidate = {
  /** 1-based, and the row of the *spreadsheet* including its header, so a board can go look. */
  row: number;
  name: string;
  school: string | null;
  rosterSize: number | null;
  rooms: number | null;
  contactName: string | null;
  contactEmail: string | null;
  problems: CandidateProblem[];
};

export type ParsedRoster = {
  /** Which spreadsheet column we read each field from, so the preview can show its own reasoning. */
  mapping: Partial<Record<ImportColumn, string>>;
  unmappedHeaders: string[];
  candidates: TeamCandidate[];
};

/**
 * A parsed row and **the physical line it started on**.
 *
 * The line number is carried rather than inferred, because blank rows are dropped and a board's
 * spreadsheet is full of them. Numbering the survivors would make `TeamCandidate.row` — which
 * promises "the row of the spreadsheet, so a board can go look" — drift by one per spacer above it,
 * and take `duplicate-name.of` and the `sourceRow` written to `audit_log` with it. A row number that
 * points at the wrong row is worse than no row number, because a board acts on it.
 */
type NumberedRow = { line: number; cells: string[] };

/**
 * RFC 4180 enough for a spreadsheet export: quoted fields, embedded commas and newlines, and `""`
 * as an escaped quote. Hand-written because a CSV dependency for one importer is a sixth runtime
 * dependency, and because Google's own export is well-formed -- the messy input here is *human
 * column headers*, not exotic quoting.
 *
 * A record that spans physical lines (a quoted field with a newline in it) is reported at the line
 * it **started** on, which is the one a board would scroll to.
 */
const parseCsvLines = (input: string): NumberedRow[] => {
  const rows: NumberedRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  // Strip a UTF-8 BOM, which Sheets exports and which would otherwise become part of the first
  // header and stop it matching any alias.
  const text = input.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Treat CRLF as one break rather than two empty rows.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      cells.push(field);
      rows.push({ line: recordLine, cells });
      cells = [];
      field = "";
      line += 1;
      recordLine = line;
    } else {
      field += char;
    }
  }

  if (field !== "" || cells.length > 0) {
    cells.push(field);
    rows.push({ line: recordLine, cells });
  }

  // A trailing newline produces one empty row; a genuinely blank line in the middle is dropped too,
  // because a board's spreadsheet has spacer rows and none of them is a team. Their line numbers are
  // not reused -- that is the whole reason the line travels with the row.
  return rows.filter((r) => r.cells.some((cell) => cell.trim() !== ""));
};

export const parseCsv = (input: string): string[][] => parseCsvLines(input).map((r) => r.cells);

const normalizeHeader = (raw: string): string => raw.trim().toLowerCase().replace(/[_\s]+/g, " ");

const mapHeaders = (
  headers: string[],
): { mapping: Partial<Record<ImportColumn, number>>; unmapped: string[] } => {
  const mapping: Partial<Record<ImportColumn, number>> = {};
  const unmapped: string[] = [];

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    const hit = (Object.keys(HEADER_ALIASES) as ImportColumn[]).find(
      (column) => mapping[column] === undefined && HEADER_ALIASES[column]?.includes(normalized),
    );
    if (hit) mapping[hit] = index;
    else if (normalized !== "") unmapped.push(header.trim());
  });

  return { mapping, unmapped };
};

/**
 * Digits only, and blank stays blank.
 *
 * `Number("")` is 0 and a team with zero dancers is a bill of nothing, which is the same distinction
 * `rooms` and `roster_size_requested` draw. A value that is present but unreadable is a **problem on
 * the candidate** rather than a silent null: "12 (maybe 13?)" in a spreadsheet cell is a board's
 * uncertainty, and it should survive the import as a question rather than vanish.
 */
const parseCount = (
  raw: string | undefined,
  column: "rosterSize" | "rooms",
): { value: number | null; problem: CandidateProblem | null } => {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { value: null, problem: null };
  if (!/^\d+$/.test(trimmed) || Number(trimmed) > 999) {
    return { value: null, problem: { kind: "unreadable-number", column, raw: trimmed } };
  }
  return { value: Number(trimmed), problem: null };
};

/** Deliberately loose. This is not a validator; it is a flag a board reads before importing. */
const looksLikeEmail = (raw: string): boolean => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(raw);

export const parseRoster = (csv: string): ParsedRoster => {
  const rows = parseCsvLines(csv);
  if (rows.length === 0) return { mapping: {}, unmappedHeaders: [], candidates: [] };

  const headers = rows[0]?.cells ?? [];
  const { mapping, unmapped } = mapHeaders(headers);

  const named: Partial<Record<ImportColumn, string>> = {};
  (Object.keys(mapping) as ImportColumn[]).forEach((column) => {
    const index = mapping[column];
    if (index !== undefined) named[column] = (headers[index] ?? "").trim();
  });

  const at = (row: string[], column: ImportColumn): string | undefined => {
    const index = mapping[column];
    return index === undefined ? undefined : row[index];
  };

  const seen = new Map<string, number>();

  const candidates = rows.slice(1).map(({ line, cells: row }): TeamCandidate => {
    const problems: CandidateProblem[] = [];

    const name = (at(row, "name") ?? "").trim();
    if (name === "") problems.push({ kind: "missing-name" });

    const roster = parseCount(at(row, "rosterSize"), "rosterSize");
    if (roster.problem) problems.push(roster.problem);

    const rooms = parseCount(at(row, "rooms"), "rooms");
    if (rooms.problem) problems.push(rooms.problem);

    const emailRaw = (at(row, "contactEmail") ?? "").trim();
    let contactEmail: string | null = null;
    if (emailRaw !== "") {
      if (looksLikeEmail(emailRaw)) contactEmail = emailRaw.toLowerCase();
      else problems.push({ kind: "unreadable-email", raw: emailRaw });
    }

    // Two rows naming the same team is the single most common thing wrong with a season's
    // spreadsheet -- a team listed once per division, or pasted twice. Both are shown; neither is
    // resolved here, because which one is right is a board's question.
    const key = name.toLowerCase();
    const rowNumber = line;
    if (name !== "") {
      const first = seen.get(key);
      if (first !== undefined) problems.push({ kind: "duplicate-name", of: first });
      else seen.set(key, rowNumber);
    }

    const school = (at(row, "school") ?? "").trim();
    const contactName = (at(row, "contactName") ?? "").trim();

    return {
      row: rowNumber,
      name,
      school: school === "" ? null : school,
      rosterSize: roster.value,
      rooms: rooms.value,
      contactName: contactName === "" ? null : contactName,
      contactEmail,
      problems,
    };
  });

  return { mapping: named, unmappedHeaders: unmapped, candidates };
};

/** A candidate the product could actually insert. A board may still decline it. */
export const isImportable = (candidate: TeamCandidate): boolean =>
  candidate.name !== "" && !candidate.problems.some((p) => p.kind === "duplicate-name");
