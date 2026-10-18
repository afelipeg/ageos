// Canonical JSON compatible with the source ERP contract
// `python-json-sorted-v1`: json.dumps(payload, sort_keys=True,
// separators=(",", ":"), ensure_ascii=False, allow_nan=False).
//
// Parity rules (verified by shared vectors in tests):
// - object keys sorted by Unicode code point (Python sorts str by code point);
// - integers only (floats are rejected: Python and JS print them differently);
// - strings escaped like Python with ensure_ascii=False: \" \\ \n \r \t \b \f,
//   other C0 controls as \u00XX lowercase hex, everything else raw UTF-8;
// - lone surrogates rejected (Python would fail to encode them);
// - bigint serialized as a JSON integer.

export type CanonicalValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue }

export class CanonicalJsonError extends Error {}

function escapeString(s: string): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CanonicalJsonError("lone surrogate")
      out += s[i] + s[i + 1]
      i++
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) throw new CanonicalJsonError("lone surrogate")
    const ch = s[i]
    switch (ch) {
      case '"':
        out += '\\"'
        break
      case "\\":
        out += "\\\\"
        break
      case "\n":
        out += "\\n"
        break
      case "\r":
        out += "\\r"
        break
      case "\t":
        out += "\\t"
        break
      case "\b":
        out += "\\b"
        break
      case "\f":
        out += "\\f"
        break
      default:
        out += code < 0x20 ? "\\u" + code.toString(16).padStart(4, "0") : ch
    }
  }
  return out + '"'
}

function compareCodePoints(a: string, b: string): number {
  const aa = Array.from(a)
  const bb = Array.from(b)
  const n = Math.min(aa.length, bb.length)
  for (let i = 0; i < n; i++) {
    const d = aa[i]!.codePointAt(0)! - bb[i]!.codePointAt(0)!
    if (d !== 0) return d
  }
  return aa.length - bb.length
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null"
  if (value === true) return "true"
  if (value === false) return "false"
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalJsonError("non-finite number")
    if (!Number.isInteger(value)) throw new CanonicalJsonError("floats are not canonical; use integer minor units or bps")
    if (!Number.isSafeInteger(value)) throw new CanonicalJsonError("unsafe integer; use bigint")
    return String(value)
  }
  if (typeof value === "string") return escapeString(value)
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalJson(v)).join(",") + "]"
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined
    )
    entries.sort(([a], [b]) => compareCodePoints(a, b))
    return (
      "{" +
      entries.map(([k, v]) => escapeString(k) + ":" + canonicalJson(v)).join(",") +
      "}"
    )
  }
  throw new CanonicalJsonError(`unsupported type ${typeof value}`)
}

export const CANONICALIZATION = "python-json-sorted-v1" as const
