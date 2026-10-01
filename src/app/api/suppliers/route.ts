// Suppliers API - list, create, update (archive/reactivate)
import { ok, fail, requireAuth, parseBody, parseQuery } from "@/lib/api";
import { z } from "zod";
import { listSuppliers, createSupplier, supplierSchema, updateSupplier } from "@/modules/inventory";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("inventory:read");
    const query = parseQuery(request, z.object({
      includeInactive: z.enum(["true", "false"]).optional(),
    }));
    const suppliers = await listSuppliers(ctx, { includeInactive: query.includeInactive === "true" });
    return ok({ suppliers });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("inventory:write");
    const input = await parseBody(request, supplierSchema);
    const supplier = await createSupplier(ctx, input);
    return ok({ supplier }, 201);
  } catch (error) {
    return fail(error);
  }
}

const patchSchema = z.object({
  supplierId: z.string().min(5),
  name: z.string().min(2).max(120).optional(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().max(120).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  notes: z.string().max(300).optional().nullable(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth("inventory:write");
    const { supplierId, ...patch } = await parseBody(request, patchSchema);
    const supplier = await updateSupplier(ctx, supplierId, patch);
    return ok({ supplier });
  } catch (error) {
    return fail(error);
  }
}
