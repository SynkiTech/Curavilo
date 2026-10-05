"use client";

// Report export helpers: CSV serialization + download (reports stay deterministic).
export function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
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

/** Build a CSV document for a report. Money is exported in major units with 2 decimals. */
export function buildReportCsv(type: "revenue" | "volume" | "pharmacy", data: ReportData, currency: string, period: string, timezone: string): string {
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
