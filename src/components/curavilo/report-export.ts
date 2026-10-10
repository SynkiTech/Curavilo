"use client";

// Report export helpers: CSV serialization + download (reports stay deterministic).
// csvEscape also neutralizes spreadsheet formula injection (OWASP): values
// starting with = + - @ tab or CR get a leading apostrophe so Excel/Sheets
// treat them as text instead of executing formulas.
export function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\ufeff" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ReportData = Record<string, unknown>;

export type ReportType = "revenue" | "volume" | "pharmacy" | "inventory" | "expenses" | "people";

/** Build a CSV document for a report. Money is exported in major units with 2 decimals. */
export function buildReportCsv(type: ReportType, data: ReportData, currency: string, period: string, timezone: string): string {
  const head: unknown[][] = [
    ["Curavilo report", type],
    ["Period", period],
    ["Currency", currency],
    ["Timezone", timezone],
    ["Generated at", new Date().toISOString()],
    [],
  ];

  if (type === "revenue") {
    const d = data as { totalMinor: number; paymentCount: number; invoicesIssued: number; outstandingMinor: number; byMethod: Record<string, number>; payments: { id: string; number: string; method: string; amountMinor: number; createdAt: string; invoiceNumber?: string; patient?: string | null }[] };
    const rows: unknown[][] = [
      ...head,
      ["Summary"],
      ["Revenue collected", (d.totalMinor / 100).toFixed(2)],
      ["Payments", d.paymentCount],
      ["Invoices issued", d.invoicesIssued],
      ["Outstanding", (d.outstandingMinor / 100).toFixed(2)],
      [],
      ["By payment method"],
      ...Object.entries(d.byMethod).map(([m, v]) => [m, (v / 100).toFixed(2)]),
      [],
      ["Payments detail"],
      ["Receipt", "Patient", "Method", "Date", `Amount (${currency})`],
      ...d.payments.map((p) => [p.number, p.patient ?? "", p.method, p.createdAt, (p.amountMinor / 100).toFixed(2)]),
    ];
    return toCsv(rows);
  }

  if (type === "volume") {
    const d = data as { total: number; byDay: { date: string; count: number }[]; bySex: { MALE: number; FEMALE: number }; avgEncounterMinutes: number };
    const busiest = d.byDay.length ? [...d.byDay].sort((a, b) => b.count - a.count)[0] : null;
    return toCsv([
      ...head,
      ["Summary"],
      ["Encounters", d.total],
      ["Female", d.bySex.FEMALE],
      ["Male", d.bySex.MALE],
      ["Average encounter duration (minutes)", d.avgEncounterMinutes],
      ["Busiest day", busiest ? busiest.date : ""],
      ["Busiest day encounters", busiest ? busiest.count : 0],
      [],
      ["Encounters per day"],
      ["Date", "Encounters"],
      ...d.byDay.map((r) => [r.date, r.count]),
    ]);
  }

  if (type === "inventory") return inventoryCsv(data, currency, head);
  if (type === "expenses") return expensesCsv(data, currency, head);
  if (type === "people") return peopleCsv(data, head);

  const d = data as { totalMinor: number; salesCount: number; byDay: { date: string; total: number }[]; topItems: { name: string; qty: number; totalMinor: number }[] };
  return toCsv([
    ...head,
    ["Summary"],
    ["Sales total", (d.totalMinor / 100).toFixed(2)],
    ["Transactions", d.salesCount],
    [],
    ["Top items"],
    ["Item", "Units sold", `Revenue (${currency})`],
    ...d.topItems.map((i) => [i.name, i.qty, (i.totalMinor / 100).toFixed(2)]),
    [],
    ["Sales per day"],
    ["Date", `Total (${currency})`],
    ...d.byDay.map((r) => [r.date, (r.total / 100).toFixed(2)]),
  ]);
}

/** Inventory valuation report CSV. */
function inventoryCsv(data: ReportData, currency: string, head: unknown[][]): string {
  const d = data as { items: { sku: string; name: string; category: string; onHand: number; reorderLevel: number; low: boolean; valueMinor: number; expiringLots: number }[]; totalValueMinor: number; lowStockCount: number; expiringCount: number; itemCount: number };
  return toCsv([
    ...head,
    ["Summary"],
    ["Items", d.itemCount],
    ["Total stock value", (d.totalValueMinor / 100).toFixed(2)],
    ["Low stock items", d.lowStockCount],
    ["Lots expiring in 30 days", d.expiringCount],
    [],
    ["Stock detail"],
    ["SKU", "Item", "Category", "On hand", "Reorder level", "Low", "Expiring lots", `Stock value (${currency})`],
    ...d.items.map((i) => [i.sku, i.name, i.category, i.onHand, i.reorderLevel, i.low ? "YES" : "no", i.expiringLots, (i.valueMinor / 100).toFixed(2)]),
  ]);
}

/** Expense ledger report CSV. */
function expensesCsv(data: ReportData, currency: string, head: unknown[][]): string {
  const d = data as { expenses: { date: string; category: string; description: string; vendor: string | null; method: string; status: string; amountMinor: number }[]; totalMinor: number; byCategory: Record<string, number>; pendingCount: number; pendingMinor: number };
  return toCsv([
    ...head,
    ["Summary"],
    ["Total booked", (d.totalMinor / 100).toFixed(2)],
    ["Pending approvals", d.pendingCount],
    ["Pending amount", (d.pendingMinor / 100).toFixed(2)],
    [],
    ["By category"],
    ...Object.entries(d.byCategory).map(([k, v]) => [k, (v / 100).toFixed(2)]),
    [],
    ["Expense detail"],
    ["Date", "Category", "Description", "Vendor", "Method", "Status", `Amount (${currency})`],
    ...d.expenses.map((e) => [e.date, e.category, e.description, e.vendor ?? "", e.method, e.status, (e.amountMinor / 100).toFixed(2)]),
  ]);
}

/** People (HR) report CSV. */
function peopleCsv(data: ReportData, head: unknown[][]): string {
  const d = data as {
    headcount: number; activeCount: number; byDesignation: Record<string, number>;
    staff: { name: string; designation: string; department: string | null; active: boolean }[];
    pendingLeave: number; onLeaveToday: number;
    certificationsExpiring: { staff: string; name: string; expiresAt: string }[];
    attendanceToday: { present: number; late: number; absent: number; leave: number };
  };
  return toCsv([
    ...head,
    ["Summary"],
    ["Headcount", d.headcount],
    ["Active", d.activeCount],
    ["Pending leave requests", d.pendingLeave],
    ["On leave today", d.onLeaveToday],
    ["Attendance today (present/late/absent/leave)", `${d.attendanceToday.present}/${d.attendanceToday.late}/${d.attendanceToday.absent}/${d.attendanceToday.leave}`],
    [],
    ["By designation"],
    ...Object.entries(d.byDesignation).map(([k, v]) => [k, v]),
    [],
    ["Staff directory"],
    ["Name", "Designation", "Department", "Status"],
    ...d.staff.map((s) => [s.name, s.designation, s.department ?? "", s.active ? "ACTIVE" : "INACTIVE"]),
    [],
    ["Certifications expiring within 30 days"],
    ["Staff", "Certification", "Expires"],
    ...d.certificationsExpiring.map((c) => [c.staff, c.name, c.expiresAt]),
  ]);
}
