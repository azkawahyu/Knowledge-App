// .pipeline/p3/probe/live-proof.mjs — A-5 live proof driver.
// Uses the REAL web/src/lib/api.ts module (api.library.list) against the live API on :4000.
// Prints page 1, page 2 via next_cursor, the limit clamp, garbage cursor -> page 1,
// and scans every JSON body for the substring "source_path".
//
//   node --import ./server/node_modules/tsx/dist/loader.mjs .pipeline/p3/probe/live-proof.mjs

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MODULE_PATH = path.resolve("web/src/lib/api.ts");
const TOKEN = fs.readFileSync(path.resolve(".pipeline/p3/f3a-token.txt"), "utf8").trim();

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };

const mod = await import(pathToFileURL(MODULE_PATH).href);
const api = mod.api;
mod.setToken(TOKEN);

const seen = [];
function scan(label, page, rawText) {
  seen.push({ label, rawText });
}
const names = (p) => p.results.map((r) => r.name);

// ---- page 1 -----------------------------------------------------------------
const p1 = await api.library.list({ limit: 2 });
const raw1 = JSON.stringify(p1);
scan("page1", p1, raw1);
console.log("=== PAGE 1  api.library.list({limit:2}) ===");
console.log("keys            :", JSON.stringify(Object.keys(p1)));
console.log("limit           :", p1.limit);
console.log("total           :", p1.total);
console.log("results.length  :", p1.results.length);
console.log("names           :", JSON.stringify(names(p1)));
console.log("next_cursor     :", p1.next_cursor ? `<${p1.next_cursor.length} chars>` : null);
console.log("row keys        :", JSON.stringify(Object.keys(p1.results[0] ?? {})));
console.log("chunk_counts    :", JSON.stringify(p1.results.map((r) => r.chunk_count)));
console.log("size_bytes/types:", JSON.stringify(p1.results.map((r) => [r.size_bytes, typeof r.size_bytes])));
console.log("created_at      :", JSON.stringify(p1.results.map((r) => r.created_at)));
console.log("has source_path :", raw1.includes("source_path"));

// ---- page 2 via the cursor --------------------------------------------------
const p2 = await api.library.list({ limit: 2, cursor: p1.next_cursor });
const raw2 = JSON.stringify(p2);
scan("page2", p2, raw2);
console.log("\n=== PAGE 2  api.library.list({limit:2, cursor:<page1.next_cursor>}) ===");
console.log("names           :", JSON.stringify(names(p2)));
console.log("results.length  :", p2.results.length);
console.log("total           :", p2.total);
console.log("next_cursor     :", p2.next_cursor === null ? null : `<${p2.next_cursor.length} chars>`);
console.log("has source_path :", raw2.includes("source_path"));

const ids1 = p1.results.map((r) => r.id);
const ids2 = p2.results.map((r) => r.id);
console.log("overlap page1∩page2:", JSON.stringify(ids1.filter((x) => ids2.includes(x))));

// ---- limit clamp ------------------------------------------------------------
console.log("\n=== LIMIT CLAMP (never 400) ===");
for (const v of [0, -5, 1000, 100, 99999]) {
  const p = await api.library.list({ limit: v });
  const raw = JSON.stringify(p);
  scan(`limit=${v}`, p, raw);
  console.log(
    `requested limit=${String(v).padEnd(6)} -> echoed limit=${String(p.limit).padEnd(4)}` +
    ` results.length=${String(p.results.length).padEnd(3)} total=${p.total}` +
    ` source_path=${raw.includes("source_path")}`
  );
}

// ---- garbage cursor -> page 1 ----------------------------------------------
console.log("\n=== GARBAGE CURSOR -> PAGE 1 ===");
const base = await api.library.list({ limit: 2 });
const baseRaw = JSON.stringify(base);
for (const g of ["garbage", "!!!not-base64url!!!", "eyJ2IjoyfQ"]) {
  const p = await api.library.list({ limit: 2, cursor: g });
  const raw = JSON.stringify(p);
  scan(`cursor=${g}`, p, raw);
  console.log(
    `cursor=${JSON.stringify(g).padEnd(22)} -> page1_identical=${raw === baseRaw}` +
    ` names=${JSON.stringify(names(p))} source_path=${raw.includes("source_path")}`
  );
}

// ---- the whole-JSON source_path sweep --------------------------------------
console.log("\n=== source_path SWEEP over every live JSON body captured above ===");
const hits = seen.filter((s) => s.rawText.includes("source_path"));
console.log(`bodies scanned: ${seen.length}; bodies containing "source_path": ${hits.length}`);
console.log(`any body containing "should-never-appear": ${seen.some((s) => s.rawText.includes("should-never-appear"))}`);
console.log(`any body containing '"offset"': ${seen.some((s) => s.rawText.includes('"offset"'))}`);
process.exit(hits.length === 0 ? 0 : 1);
