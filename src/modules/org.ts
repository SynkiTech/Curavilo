// Organization & onboarding module (spec §10, §128 Phase 1)
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getProfile, SERVICE_PROFILES } from "@/lib/service-profiles";
import { AppError } from "@/lib/api";
import { audit } from "@/lib/audit";

export const registerSchema = z.object({
  organization: z.object({
    name: z.string().min(2).max(120),
    currency: z.string().min(3).max(3).default("NGN"),
    timezone: z.string().min(2).max(60).default("Africa/Lagos"),
  }),
  facility: z.object({
    name: z.string().min(2).max(120),
    type: z.string().min(2).max(40).default("CLINIC"),
    serviceProfileKey: z.string().refine((k) => k in SERVICE_PROFILES, "Unknown service profile"),
    address: z.string().max(300).optional().nullable(),
    phone: z.string().max(30).optional().nullable(),
    email: z.string().email().max(120).optional().nullable().or(z.literal("")),
    logoData: z.string().max(400_000).optional().nullable(),
    reportFooter: z.string().max(300).optional().nullable(),
    receiptFooter: z.string().max(300).optional().nullable(),
    brandColor: z.string().max(20).optional().nullable(),
  }),
  admin: z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(8).max(100),
  }),
});

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
}

export async function registerOrganization(input: z.infer<typeof registerSchema>) {
  const email = input.admin.email.toLowerCase();
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new AppError(409, "email_taken", "An account with this email already exists. Please sign in.");
  }
  const baseSlug = slugify(input.organization.name);
  const slugTaken = await db.organization.findUnique({ where: { slug: baseSlug } });
  const slug = slugTaken ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;

  const profile = getProfile(input.facility.serviceProfileKey);

  const org = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.organization.name,
        slug,
        currency: input.organization.currency,
        timezone: input.organization.timezone,
      },
    });
    const user = await tx.user.create({
      data: {
        email,
        name: input.admin.name,
        passwordHash: hashPassword(input.admin.password),
      },
    });
    await tx.membership.create({
      data: { userId: user.id, orgId: org.id, role: "OWNER" },
    });
    const facility = await tx.facility.create({
      data: {
        orgId: org.id,
        name: input.facility.name,
        type: input.facility.type,
        serviceProfileKey: profile.key,
        address: input.facility.address || null,
        phone: input.facility.phone || null,
        email: input.facility.email || null,
        logoData: input.facility.logoData || null,
        reportFooter: input.facility.reportFooter || `Thank you for choosing ${input.facility.name}.`,
        receiptFooter: input.facility.receiptFooter || `Thank you for your visit - get well soon!`,
        brandColor: input.facility.brandColor || null,
      },
    });
    // Seed the starter service catalogue for this profile
    await tx.serviceItem.createMany({
      data: profile.catalogue.map((c) => ({
        orgId: org.id,
        code: c.code,
        name: c.name,
        category: c.category,
        priceMinor: c.priceMinor,
        currency: input.organization.currency,
      })),
    });
    return { org, user, facility };
  });

  await audit({
    orgId: org.org.id,
    facilityId: org.facility.id,
    actorUserId: org.user.id,
    actorLabel: org.user.name,
    action: "organization.registered",
    entityType: "Organization",
    entityId: org.org.id,
    summary: `Organization ${org.org.name} registered with facility ${org.facility.name} (${profile.name}).`,
  });

  return { orgId: org.org.id, userId: org.user.id, facilityId: org.facility.id };
}
