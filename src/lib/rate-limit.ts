// In-memory sliding-window rate limiter for sensitive endpoints.
// Single-instance dev/sandbox guard; production swaps for a shared store (same interface).
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return true;
}

/**
 * Best-effort client identity for rate limiting.
 * Trust model: in this deployment Caddy terminates the proxy and OVERWRITES
 * x-forwarded-for with the real client address, so the first XFF hop is
 * trustworthy there. When the app is exposed directly (dev, or a misconfigured
 * edge), XFF is client-spoofable - which is why login/gate brute-force ALSO
 * has server-side DB lockouts (staff account lock + org gate lock) that do not
 * depend on this value at all. Horizontal deployments must move to a shared
 * store keyed on real client IP.
 */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}
