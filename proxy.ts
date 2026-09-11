import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const cookieName = process.env.SESSION_COOKIE_NAME || "inventory_demo_session";
  if (!request.cookies.has(cookieName)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/operations/:path*",
    "/settings/:path*",
    "/catalog/:path*",
    "/suppliers/:path*",
    "/inventory/:path*",
    "/reports/:path*",
  ],
};
