// Removes all em dashes (—) from src/**/*.{ts,tsx}
// Rules:
//   " — " (spaced)  -> " - "  (hyphen, reads naturally in prose and comments)
//   "—" remaining   -> "-"    (lone placeholders, table cells, prefixes)
// User-visible date-range en dashes are handled separately in review.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project/src";
const EXT = new Set([".ts", ".tsx"]);
let files = 0, hits = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.has(name.slice(name.lastIndexOf(".")))) {
      const before = readFileSync(p, "utf8");
      let after = before.replaceAll("\u2014 - ", "- - "); // guard odd sequence
      after = after.replaceAll(" \u2014 ", " - ");
      after = after.replaceAll("\u2014", "-");
      if (after !== before) {
        writeFileSync(p, after);
        files++;
        hits += before.split("\u2014").length - 1;
        console.log("cleaned:", p);
      }
    }
  }
}
walk(ROOT);
console.log(`Done. ${hits} em dashes replaced across ${files} files.`);
