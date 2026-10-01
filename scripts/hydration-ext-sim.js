/* Simulate the user's browser extension: it stamps bis_* / __processed_*__
 * attributes on <body> and EVERY element between HTML arrival and React
 * hydration, causing hydration mismatches. We A/B test:
 *   - no-fix  : inline cleanup script disabled -> hydration errors expected
 *   - with-fix: cleanup script active        -> console must be clean
 */
import { createRequire } from "module";
const require2 = createRequire(import.meta.url);
const { chromium } = require2("/home/z/.npm-global/lib/node_modules/playwright");

const BASE = "http://localhost:3000";

// Init script mimicking the extension: on every mutation, tag elements.
const EXT_SIM = `
  (() => {
    const tag = (el) => {
      try {
        if (el.nodeType !== 1) return;
        el.setAttribute("bis_size", JSON.stringify({x:0,y:0,w:835,h:616,abs_x:684,abs_y:109}));
        el.setAttribute("bis_status", "ok");
        el.setAttribute("bis_frame_id", "261");
        el.setAttribute("__processed_0cac9f37-45de-4e85-971a-002d7ec1ee2f__", "true");
      } catch (e) {}
    };
    const tagAll = () => { document.querySelectorAll("*").forEach(tag); };
    tagAll();
    const obs = new MutationObserver(() => tagAll());
    document.addEventListener("DOMContentLoaded", () => {
      tagAll();
      obs.observe(document.documentElement, { attributes: false, childList: true, subtree: true });
    });
  })();
`;

async function run(label, disableFix) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  if (disableFix) {
    // Neutralize the inline cleanup: make isBad() always false.
    await context.route("**/localhost:3000/**", async (route) => {
      const resp = await route.fetch();
      const type = resp.headers()["content-type"] || "";
      if (type.includes("text/html")) {
        let html = await resp.text();
        html = html.split('name.indexOf("bis_") === 0').join("false");
        html = html.split('name.indexOf("__processed_") === 0').join("false");
        await route.fulfill({ response: resp, body: html });
      } else {
        await route.fulfill({ response: resp });
      }
    });
  }
  await context.addInitScript(EXT_SIM);
  const page = await context.newPage();
  const issues = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.toLowerCase().includes("hydrat") && text.toLowerCase().includes("match")) {
      issues.push(`[console.${msg.type()}] ${text.slice(0, 160)}`);
    }
  });
  page.on("pageerror", (err) => {
    if (String(err).toLowerCase().includes("hydrat")) issues.push(`[pageerror] ${String(err).slice(0, 160)}`);
  });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(6000); // let React hydrate + splash resolve
  const bodyAttrs = await page.evaluate(() => ({
    bis: document.body.getAttribute("bis_status"),
    processed: Array.from(document.body.attributes).filter((a) => a.name.startsWith("__processed_")).length,
    anyBisInDom: document.querySelectorAll("[bis_size],[bis_status]").length,
  }));
  console.log(`--- ${label} ---`);
  console.log("hydration issues:", issues.length);
  issues.slice(0, 3).forEach((l) => console.log("  ", l));
  console.log("body bis_status attr:", bodyAttrs.bis, "| __processed__ attrs:", bodyAttrs.processed, "| bis-tagged elements in DOM:", bodyAttrs.anyBisInDom);
  await browser.close();
  return issues.length;
}

(async () => {
  const noFix = await run("NO-FIX (cleanup disabled, like user's browser)", true);
  const withFix = await run("WITH-FIX (cleanup script active)", false);
  console.log("\nRESULT:", noFix > 0 ? `reproduced ${noFix} issue(s) without fix` : "WARNING: sim did not reproduce", "|", withFix === 0 ? "FIX VERIFIED: clean hydration with fix" : `FAIL: ${withFix} issue(s) remain`);
  process.exit(withFix === 0 ? 0 : 1);
})();
