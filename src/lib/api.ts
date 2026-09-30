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
