// Secret box - AES-256-GCM encryption for values the server must later read
// back (e.g. webhook signing secrets) but must never store in plaintext.
// Standard library crypto only; key material comes from the environment
// (CURAVILO_SECRET_KEY). Without a dedicated key a dev-only fallback key is
// derived from DATABASE_URL so the sandbox works - production deployments MUST
// set CURAVILO_SECRET_KEY (see .env.example, security-exceptions.md).

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";

const FALLBACK_SALT = "curavilo-secret-box-v1";

function key(): Buffer {
  const explicit = process.env.CURAVILO_SECRET_KEY;
  if (explicit && /^[0-9a-fA-F]{64}$/.test(explicit)) return Buffer.from(explicit, "hex");
  // Deterministic dev fallback (documented exception; never used when the env key is set).
  return scryptSync(process.env.DATABASE_URL ?? "curavilo-dev", FALLBACK_SALT, 32);
}

/** Encrypt to a compact `v1:<iv>:<tag>:<ciphertext>` base64url envelope. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

/** Decrypt a `v1:...` envelope. Returns null on any tamper/format failure. */
export function decryptSecret(envelope: string | null | undefined): string | null {
  if (!envelope) return null;
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const data = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Short fingerprint for verifying a supplied secret without decrypting (legacy check). */
export function secretFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
