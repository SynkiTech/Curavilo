// Invoices API - list, create, detail, payments, void
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { createInvoice, invoiceCreateSchema, listInvoices, getInvoice, recordPayment, paymentSchema, voidPayment, voidInvoice } from "@/modules/billing";

const listQuery = z.object({
  status: z.string().max(20).optional(),
  patientId: z.string().optional(),
  q: z.string().max(40).optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("billing:read");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id) {
      const invoice = await getInvoice(ctx, id);
      return ok({ invoice });
    }
    const query = parseQuery(request, listQuery);
    const invoices = await listInvoices(ctx, query);
    return ok({ invoices });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("billing:write");
    const input = await parseBody(request, invoiceCreateSchema);
    const invoice = await createInvoice(ctx, input);
    return ok({ invoice }, 201);
  } catch (error) {
    return fail(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("PAY"),
    amountMinor: z.number().int().min(1),
    method: z.enum(["CASH", "TRANSFER", "CARD", "MOBILE"]).default("CASH"),
    reference: z.string().max(80).optional().nullable(),
    idempotencyKey: z.string().min(8).max(80).optional().nullable(),
  }),
  z.object({ action: z.literal("VOID_PAYMENT"), paymentId: z.string().min(5), reason: z.string().min(3).max(200) }),
  z.object({ action: z.literal("VOID"), reason: z.string().min(3).max(200) }),
]);

export async function PATCH(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const invoiceId = searchParams.get("id") ?? "";
    const body = await parseBody(request, actionSchema);

    if (body.action === "PAY") {
      const ctx = await requireAuth("payments:record");
      const result = await recordPayment(ctx, invoiceId, {
        amountMinor: body.amountMinor,
        method: body.method,
        reference: body.reference ?? null,
        idempotencyKey: body.idempotencyKey ?? null,
      });
      return ok(result);
    }
    if (body.action === "VOID_PAYMENT") {
      const ctx = await requireAuth("billing:write");
      const payment = await voidPayment(ctx, body.paymentId, body.reason);
      return ok({ payment });
    }
    const ctx = await requireAuth("billing:write");
    const invoice = await voidInvoice(ctx, invoiceId, body.reason);
    return ok({ invoice });
  } catch (error) {
    return fail(error);
  }
}
