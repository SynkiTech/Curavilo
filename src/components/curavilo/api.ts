"use client";

// Client API helpers + shared types
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  orgId: string;
  orgName: string;
  facilityId: string;
  facilityName: string;
  serviceProfileKey: string;
  currency: string;
  timezone: string;
  permissions: string[];
}

export interface FacilityOption {
  id: string;
  name: string;
  serviceProfileKey: string;
  type: string;
}

export interface SessionInfo {
  authenticated: boolean;
  user?: SessionUser;
  facilities?: FacilityOption[];
  branding?: {
    logoData?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    reportFooter?: string | null;
    receiptFooter?: string | null;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return {} as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(res.status, err.code ?? "error", err.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  return handle<T>(res);
}

export async function apiSend<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

/**
 * Fetch the session with short retries. The dev server / preview proxy can
 * briefly drop requests (restarts, cold compiles) - a bare fetch there used to
 * surface as an unhelpful "Could not sign in". Retries smooth over those gaps.
 */
export async function fetchSessionWithRetry(attempts = 3): Promise<SessionInfo | null> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch("/api/auth", { cache: "no-store", credentials: "same-origin" });
      if (res.ok) return (await res.json()) as SessionInfo;
      lastError = new ApiError(res.status, "error", `Session request failed (${res.status})`);
    } catch (e) {
      lastError = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  if (lastError !== null) throw lastError;
  return null;
}

// ─── Shared view types ──────────────────────────────────────────────────────

export interface Patient {
  id: string; mrn: string; firstName: string; lastName: string; phone: string; email?: string | null;
  sex: string; dateOfBirth?: string | null; address?: string | null; allergies?: string | null;
  nextOfKinName?: string | null; nextOfKinPhone?: string | null; bloodGroup?: string | null;
  createdAt: string;
}

export interface Appointment {
  id: string; patientId: string; scheduledAt: string; durationMin: number; status: string; notes?: string | null;
  patient?: Patient;
  staffMember?: { id: string; name: string } | null;
  serviceItem?: { id: string; name: string; priceMinor: number } | null;
}

export interface QueueEntry {
  id: string; patientId: string; appointmentId?: string | null; department: string; number: number;
  status: string; checkedInAt: string; patient?: Patient;
}

export interface Encounter {
  id: string; patientId: string; staffMemberId?: string | null; serviceLine: string; formKey: string;
  status: string; formData: string; diagnosis?: string | null; plan?: string | null;
  startedAt: string; completedAt?: string | null;
  patient?: Patient;
  staffMember?: { id: string; name: string; designation: string } | null;
  invoice?: Invoice | null;
}

export interface InvoiceItem {
  id: string; name: string; quantity: number; unitPriceMinor: number; totalMinor: number; serviceItemId?: string | null;
}

export interface Invoice {
  id: string; number: string; patientId: string; encounterId?: string | null; status: string;
  subtotalMinor: number; discountMinor: number; totalMinor: number; amountPaidMinor: number;
  currency: string; createdAt: string; issuedAt?: string | null;
  items?: InvoiceItem[];
  patient?: Patient;
  payments?: Payment[];
}

export interface Payment {
  id: string; invoiceId: string; number: string; method: string; amountMinor: number; currency: string;
  reference?: string | null; voidedAt?: string | null; voidReason?: string | null; createdAt: string;
  invoice?: Invoice;
}

export interface InventoryItem {
  id: string; category: string; sku: string; barcode?: string | null; name: string;
  genericName?: string | null; dosageForm?: string | null; unit: string;
  purchasePriceMinor: number; sellingPriceMinor: number; currency: string; reorderLevel: number;
  stockOnHand?: number; nextExpiry?: string | null;
  lots?: { id: string; batchNo: string; expiresAt?: string | null; qtyReceived: number; qtyRemaining: number }[];
}

export interface Sale {
  id: string; number: string; customerName?: string | null; status: string;
  subtotalMinor: number; discountMinor: number; totalMinor: number; method: string;
  createdAt: string; items?: { id: string; name: string; quantity: number; unitPriceMinor: number; totalMinor: number }[];
}

export interface ServiceItem {
  id: string; code: string; name: string; category: string; priceMinor: number; currency: string;
}

export interface StaffMember {
  id: string; name: string; designation: string; department?: string | null; active: boolean;
}

export interface FollowUp {
  id: string; patientId: string; title: string; dueAt: string; status: string;
  patient?: { mrn: string; firstName: string; lastName: string };
}

export function formatMoney(minor: number, currency = "NGN"): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

export function formatDateTime(iso: string | null | undefined, timezone = "Africa/Lagos"): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("en-GB", { timeZone: timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function formatDate(iso: string | null | undefined, timezone = "Africa/Lagos"): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { timeZone: timezone, day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

export function ageFrom(dob: string | null | undefined): string {
  if (!dob) return "-";
  const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
  return years >= 0 ? `${years}y` : "-";
}
