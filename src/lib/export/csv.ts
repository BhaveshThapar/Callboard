/**
 * RFC 4180. A field is quoted when it contains a delimiter, a quote, or a line break, and an
 * embedded quote is doubled. Rows are joined with CRLF, which is what the spec says and what
 * Excel expects; Sheets and every other reader accept it.
 *
 * Pure: takes data, returns a string. Nothing here touches the database or the filesystem.
 */
const NEEDS_QUOTING = /[",\r\n]/;

const field = (value: string): string =>
  NEEDS_QUOTING.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export const toCsv = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string => [headers, ...rows].map((row) => row.map(field).join(",")).join("\r\n");
