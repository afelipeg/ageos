import { NextResponse, type NextRequest } from "next/server"

import { REQUESTED_PATH_HEADER } from "@/server/auth/requested-path"

// Server Components cannot read the request URL, so requireAgency could not
// keep the query string in the sign-in `next` redirect. This hands them the
// path + query (always overwriting any client-sent value).
export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone()
  if (url.searchParams.has("_rsc")) url.searchParams.delete("_rsc")
  const headers = new Headers(request.headers)
  headers.set(REQUESTED_PATH_HEADER, url.pathname + url.search)
  return NextResponse.next({ request: { headers } })
}

export const config = { matcher: "/a/:path*" }
