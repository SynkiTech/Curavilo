// API helpers - consistent responses, typed errors, auth+permission guard (spec §71, §84, §87).
import { NextResponse } from "next/server";
import { ZodError, ZodSchema } from "zod";
import { getAuth, type AuthContext } from "@/lib/auth";

export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const Unauthorized = () => new AppError(401, "unauthorized", "Authentication required.");
export const Forbidden = (msg = "You do not have permission to perform this action.") =>
  new AppError(403, "forbidden", msg);
export const NotFound = (msg = "Record not found.") => new AppError(404, "not_found", msg);
export const BadRequest = (msg = "Invalid request.") => new AppError(400, "bad_request", msg);

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data as object, { status });
}

function prismaCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^P\d{4}$/.test(code)) return code;
  }
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** SQLite write contention / transaction timeouts: retryable, tell the user plainly. */
function isTransientWriteError(error: unknown): boolean {
  const code = prismaCode(error);
  if (code === "P2024" || code === "P2034" || code === "P2010") return true;
  const msg = messageOf(error);
  return (
    msg.includes("Socket timeout") ||
    msg.includes("database is locked") ||
    msg.includes("Timed out fetching a new connection")
  );
}

export function fail(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  // Schema-level validation failures (e.g. registerSchema.parse outside parseBody)
  // must surface as a helpful 400, never a generic 500.
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.",
        },
      },
      { status: 400 }
    );
  }
  if (isTransientWriteError(error)) {
    console.error("[api:busy]", messageOf(error));
    return NextResponse.json(
      { error: { code: "server_busy", message: "The server is busy saving another transaction. Please try again." } },
      { status: 503 }
    );
  }
  const code = prismaCode(error);
  if (code === "P2002") {
    return NextResponse.json(
      { error: { code: "duplicate", message: "That record already exists." } },
      { status: 409 }
    );
  }
  console.error("[api]", error);
  return NextResponse.json(
    { error: { code: "internal", message: "Something went wrong. Please try again." } },
    { status: 500 }
  );
}

/** Authenticate + authorize + tenant scope. Throws before the handler runs. */
export async function requireAuth(permission?: string): Promise<AuthContext> {
  const ctx = await getAuth();
  if (!ctx) throw Unauthorized();
  // Owner-created temporary passwords must be changed before any other API use.
  if (ctx.mustChangePassword) {
    throw new AppError(403, "must_change_password", "Change your password to continue.");
  }
  if (permission && !ctx.permissions.includes(permission as never)) {
    throw Forbidden();
  }
  return ctx;
}

export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw BadRequest("Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw BadRequest(first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid request.");
  }
  return result.data;
}

export function parseQuery<T>(request: Request, schema: ZodSchema<T>): T {
  const url = new URL(request.url);
  const obj: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  const result = schema.safeParse(obj);
  if (!result.success) {
    const first = result.error.issues[0];
    throw BadRequest(first ? `${first.path.join(".") || "query"}: ${first.message}` : "Invalid query.");
  }
  return result.data;
}
