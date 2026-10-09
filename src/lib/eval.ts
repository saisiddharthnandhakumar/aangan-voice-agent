/** Helpers for `pnpm eval` (scripts/eval.ts). Pure, so they are unit-tested. */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** The sample enquiries are from September 2026. */
const YEAR = 2026;

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** "# T01 · Phone · 2 September · 10:23am · 4 min" → the enquiry's own time in IST. */
export function enquiryTime(markdown: string): Date {
  const heading = markdown.split("\n").find((l) => l.startsWith("# ")) ?? "";
  const date = heading.match(/(\d{1,2})(?:[–-]\d{1,2})?\s+([A-Za-z]+)/);
  const time = heading.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!date) throw new Error(`No date in heading: ${heading}`);
  const month = MONTHS.indexOf(date[2].toLowerCase());
  let hour = 12;
  let minute = 0;
  if (time) {
    hour = (Number(time[1]) % 12) + (time[3].toLowerCase() === "pm" ? 12 : 0);
    minute = Number(time[2]);
  }
  const iso = `${YEAR}-${String(month + 1).padStart(2, "0")}-${date[1].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`;
  return new Date(iso);
}

