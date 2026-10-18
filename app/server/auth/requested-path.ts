export const REQUESTED_PATH_HEADER = "x-ageos-requested-path"

// Same character set the sign-in action accepts for `next`, restricted to the
// agency area: a same-origin path under /a/, never an absolute URL or "..".
const APP_PATH = /^\/a\/(?!.*\.\.)[A-Za-z0-9/_\-?=&.%]*$/

const valid = (p: string) => p.length <= 300 && APP_PATH.test(p)

/** The requested path+query if safe; else the path alone (a query the sign-in
 *  action would reject, e.g. a space); else null. */
export function safeAppPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (valid(raw)) return raw
  const path = raw.split("?")[0]!
  return valid(path) ? path : null
}
