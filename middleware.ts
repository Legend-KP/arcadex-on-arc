import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_HOST = (process.env.NEXT_PUBLIC_ADMIN_HOST ?? "")
  .replace(/^https?:\/\//, "")
  .split("/")[0]
  .toLowerCase()
  .trim();

function normalizeHost(value: string | null | undefined): string {
  return (value ?? "")
    .split(",")[0]
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();
}

function requestHosts(request: NextRequest): string[] {
  return [
    normalizeHost(request.headers.get("x-forwarded-host")),
    normalizeHost(request.headers.get("host")),
    normalizeHost(request.nextUrl.hostname),
    normalizeHost(request.nextUrl.host),
  ].filter(Boolean);
}

function isAdminHost(request: NextRequest): boolean {
  const hosts = requestHosts(request);
  if (ADMIN_HOST && hosts.some((host) => host === ADMIN_HOST)) {
    return true;
  }
  return hosts.some(
    (host) => host.startsWith("admin.") && host.endsWith(".trenchverse.com")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const onAdminHost = isAdminHost(request);

  // Always allow /admin (host detection is unreliable behind OpenNext/CF).
  if (pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  if (onAdminHost) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/admin", "/admin/:path*", "/game/:path*"],
};
