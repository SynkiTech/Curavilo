// One-off: replace em dashes in every TEXT column of the SQLite dev database.
// Covers seeded demo content (facility names, footers, diagnoses, workflow bodies).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const tables = await db.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'"
  );
  let total = 0;
  for (const t of tables) {
    const cols = await db.$queryRawUnsafe<{ name: string; type: string }[]>(`PRAGMA table_info("${t.name}")`);
    const textCols = cols.filter((c) => c.type.toUpperCase() === "TEXT").map((c) => c.name);
    for (const col of textCols) {
      try {
        const n = await db.$executeRawUnsafe(
          `UPDATE "${t.name}" SET "${col}" = replace("${col}", '\u2014', '-') WHERE "${col}" LIKE '%\u2014%'`
        );
        if (n > 0) {
          total += n;
          console.log(`${t.name}.${col}: ${n} row(s) updated`);
        }
      } catch {
        // non-string content in a TEXT-declared column: skip
      }
    }
  }
  console.log(`Done. ${total} row(s) cleaned.`);
}

main().finally(() => db.$disconnect());
