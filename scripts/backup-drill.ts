// Backup/restore drill (spec §142) — proves backups are restorable, not just taken.
// 1. Backs up the SQLite database file.
// 2. Restores it to a scratch database.
// 3. Asserts core row counts match the live DB.
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { PrismaClient } from "@prisma/client";

const LIVE = "file:/home/z/my-project/db/custom.db";
const DIR = "/home/z/my-project/download/backups";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const LIVE_PATH = "/home/z/my-project/db/custom.db";
const BACKUP = `${DIR}/curavilo-${STAMP}.db`;
const SCRATCH = `${DIR}/scratch-${STAMP}.db`;

function main() {
  if (!existsSync(LIVE_PATH)) throw new Error("Live database not found at db/custom.db");
  mkdirSync(DIR, { recursive: true });

  console.log("1. Backing up…");
  execSync(`cp "${LIVE_PATH}" "${BACKUP}"`);

  console.log("2. Restoring to scratch…");
  execSync(`cp "${BACKUP}" "${SCRATCH}"`);

  console.log("3. Verifying restored integrity + row counts…");
  execSync(`bunx prisma db push --skip-generate`, { env: { ...process.env, DATABASE_URL: `file:${SCRATCH}` }, stdio: "pipe" });
  const scratch = new PrismaClient({ datasources: { db: { url: `file:${SCRATCH}` } } });

  const live = new PrismaClient({ datasources: { db: { url: LIVE } } });
  const tables = ["organization", "facility", "patient", "encounter", "invoice", "payment", "auditEvent"] as const;

  (async () => {
    let ok = true;
    for (const table of tables) {
      const [liveCount, scratchCount] = await Promise.all([
        (live as unknown as Record<string, { count: () => Promise<number> }>)[table].count(),
        (scratch as unknown as Record<string, { count: () => Promise<number> }>)[table].count(),
      ]);
      const match = liveCount === scratchCount;
      ok = ok && match;
      console.log(`   ${table}: live=${liveCount} restored=${scratchCount} ${match ? "✓" : "✗"}`);
    }
    await Promise.all([live.$disconnect(), scratch.$disconnect()]);
    rmSync(SCRATCH);
    console.log(ok ? `DRILL PASSED — backup at ${BACKUP}` : "DRILL FAILED — counts diverge");
    if (!ok) process.exit(1);
  })();
}

main();
void readFileSync;
