// Money — integer minor units only (kobo for NGN). No floats, ever. (ADR 0005)

export type Currency = string;

export function formatMoney(minor: number, currency: Currency = "NGN"): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

export function formatMoneyFull(minor: number, currency: Currency = "NGN"): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

/** Parse a user-entered major-unit string ("1500.50") into minor units (integer kobo). */
export function parseMajorToMinor(input: string | number): number {
  const s = String(input).replace(/[^0-9.]/g, "");
  if (!s) return 0;
  const parts = s.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(2, "0").slice(0, 2);
  return parseInt(whole, 10) * 100 + parseInt(frac || "0", 10);
}

export function sumMinor(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
