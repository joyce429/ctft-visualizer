export function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(headers, rows) {
  if (!Array.isArray(headers) || !Array.isArray(rows)) throw new TypeError("headers and rows must be arrays");
  const width = headers.length;
  if (rows.some((row) => !Array.isArray(row) || row.length !== width)) throw new RangeError("CSV row width must match headers");
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
