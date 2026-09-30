// Inpatient API - wards, beds, admissions, discharge, referrals (spec §137)
import { z } from "zod";
import { ok, fail, parseBody, parseQuery, requireAuth } from "@/lib/api";
import {
  createWard, listWards, setBedStatus, admitPatient, dischargePatient, listAdmissions,
  createReferral, listReferrals, updateReferralStatus,
  wardSchema, admitSchema, dischargeSchema, referralSchema,
} from "@/modules/inpatient";

const query = z.object({
  status: z.string().max(20).optional(),
  scope: z.enum(["WARDS", "ADMISSIONS", "REFERRALS"]).default("WARDS"),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth("inpatient:manage");
    const q = parseQuery(request, query);
    if (q.scope === "ADMISSIONS") return ok({ admissions: await listAdmissions(ctx, q) });
    if (q.scope === "REFERRALS") return ok({ referrals: await listReferrals(ctx, q.status) });
    return ok({ wards: await listWards(ctx) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth("inpatient:manage");
    const body = await parseBody(request, z.object({
      action: z.enum(["CREATE_WARD", "SET_BED", "ADMIT", "DISCHARGE", "CREATE_REFERRAL", "UPDATE_REFERRAL"]),
      ward: wardSchema.optional(),
      bedId: z.string().min(5).optional(),
      bedStatus: z.enum(["FREE", "MAINTENANCE"]).optional(),
      admission: admitSchema.optional(),
      admissionId: z.string().min(5).optional(),
      discharge: dischargeSchema.optional(),
      referral: referralSchema.optional(),
      referralId: z.string().min(5).optional(),
      referralStatus: z.enum(["ACCEPTED", "COMPLETED", "CANCELLED"]).optional(),
    }));
    switch (body.action) {
      case "CREATE_WARD": {
        if (!body.ward) return ok({ error: "ward is required." }, 400);
        return ok({ ward: await createWard(ctx, body.ward) }, 201);
      }
      case "SET_BED": {
        if (!body.bedId || !body.bedStatus) return ok({ error: "bedId and bedStatus are required." }, 400);
        return ok({ bed: await setBedStatus(ctx, body.bedId, body.bedStatus) });
      }
      case "ADMIT": {
        if (!body.admission) return ok({ error: "admission is required." }, 400);
        return ok({ admission: await admitPatient(ctx, body.admission) }, 201);
      }
      case "DISCHARGE": {
        if (!body.admissionId || !body.discharge) return ok({ error: "admissionId and discharge are required." }, 400);
        return ok({ admission: await dischargePatient(ctx, body.admissionId, body.discharge) });
      }
      case "CREATE_REFERRAL": {
        if (!body.referral) return ok({ error: "referral is required." }, 400);
        return ok({ referral: await createReferral(ctx, body.referral) }, 201);
      }
      case "UPDATE_REFERRAL": {
        if (!body.referralId || !body.referralStatus) return ok({ error: "referralId and referralStatus are required." }, 400);
        return ok({ referral: await updateReferralStatus(ctx, body.referralId, body.referralStatus) });
      }
    }
  } catch (error) {
    return fail(error);
  }
}
