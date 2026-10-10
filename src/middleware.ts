// Security middleware (spec §30-33, §75): CSP with per-request nonce, standard
// security headers, CSRF origin assertions for state-changing API calls, and
// no-store caching for API responses carrying sensitive data.
import { NextRequest, NextResponse } from "next/server";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function cspFor(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    // strict-dynamic: nonced bootstrap may load further scripts; dev needs eval for HMR.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // React/framer-motion/recharts inject inline <style> and style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

export function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = cspFor(nonce, isDev);

  // ── CSRF / origin assertions on state-changing API calls ──────────────────
  // SameSite=Lax cookies are the primary control; this is defense in depth.
  // Non-browser clients (curl, server-to-server) send neither header and pass.
  if (request.nextUrl.pathname.startsWith("/api/") && UNSAFE_METHODS.has(request.method)) {
    const site = request.headers.get("sec-fetch-site");
    if (site === "cross-site") {
      return NextResponse.json(
        { error: { code: "cross_site_blocked", message: "Cross-site state-changing requests are not allowed." } },
        { status: 403 },
      );
    }
    const origin = request.headers.get("origin");
    if (origin) {
      const host = request.headers.get("host");
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = "";
      }
      if (!host || originHost !== host) {
        return NextResponse.json(
          { error: { code: "origin_mismatch", message: "Request origin does not match the application host." } },
          { status: 403 },
        );
      }
    }
  }

  // Forward the nonce to the app so server components can nonce inline scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // ── Response security headers ─────────────────────────────────────────────
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (!isDev) {
    // HSTS only outside dev (no TLS on the dev loopback).
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // Sensitive API responses must never live in shared caches.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }

  return response;
}

export const config = {
  // Skip static assets; everything else (pages + API) gets the headers.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
