// SSRF-safe outbound URL validation (spec §55, §57).
// Outbound webhook destinations are user-registered, so they are hostile until
// proven otherwise: scheme-allowlisted, credential-free, and never aimed at
// loopback, private/link-local ranges or cloud metadata endpoints.

import { lookup } from "dns/promises";
import { isIP } from "net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback",
  "metadata", "metadata.google.internal", "instance-data", "instance-data.internal",
]);

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv6Blocked(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // link-local + ULA
  if (v.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:10.0.0.1)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return ipv4Blocked(mapped[1]);
  return false;
}

function ipBlocked(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return ipv4Blocked(ip);
  if (fam === 6) return ipv6Blocked(ip);
  return true; // unparseable -> fail closed
}

export interface UrlGuardOptions {
  /** Allow plain http (sandbox/dev only). Production requires https. */
  allowHttp?: boolean;
}

export type UrlGuardResult =
  | { ok: true; host: string; port: number }
  | { ok: false; reason: string };

/**
 * Validate an outbound URL. Throws nothing; returns a reason on rejection.
 * Scheme + authority are checked synchronously; DNS is resolved and every
 * returned address must be public (anti DNS-rebinding measure).
 */
export async function validateOutboundUrl(raw: string, opts: UrlGuardOptions = {}): Promise<UrlGuardResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL is not parseable." };
  }
  const isHttps = url.protocol === "https:";
  const isHttp = url.protocol === "http:";
  if (!isHttps && !(isHttp && opts.allowHttp)) {
    return { ok: false, reason: "Only https URLs are allowed." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed." };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return { ok: false, reason: "This host is not allowed." };
  }
  // Reject hostnames that embed blocked addresses by another name.
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) && ipBlocked(bare)) {
    return { ok: false, reason: "IP-literal targets on private networks are not allowed." };
  }
  // Resolve DNS and check every address (A + AAAA).
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    if (records.length === 0) return { ok: false, reason: "Host does not resolve." };
    for (const r of records) {
      if (ipBlocked(r.address)) {
        return { ok: false, reason: "Host resolves to a private or protected address." };
      }
    }
  } catch {
    return { ok: false, reason: "Host does not resolve." };
  }
  return { ok: true, host, port: Number(url.port) || (isHttps ? 443 : 80) };
}
