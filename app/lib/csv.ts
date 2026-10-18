// Small RFC 4180 parser (quoted fields, escaped quotes, CRLF/LF) with an
// explicit delimiter. Used by imports and by the platform CSV incident, where
// the configured delimiter genuinely changes the parsed column count.

export type CsvParseResult = { headers: string[]; rows: string[][] }

export function parseCsv(text: string, delimiter: string): CsvParseResult {
  if (delimiter.length !== 1) throw new Error("Delimiter must be one character")
  const records: string[][] = []
  let field = ""
  let record: string[] = []
  let inQuotes = false
  const src = text.replace(/^﻿/, "")
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === "") inQuotes = true
    else if (ch === delimiter) {
      record.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      record.push(field)
      field = ""
      if (record.some((f) => f !== "") || record.length > 1) records.push(record)
      record = []
    } else field += ch
  }
  if (field !== "" || record.length) {
    record.push(field)
    records.push(record)
  }
  const [headers = [], ...rows] = records
  return { headers, rows }
}

/** Neutralizes spreadsheet formula injection when exporting user data. */
export function csvSafeCell(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
