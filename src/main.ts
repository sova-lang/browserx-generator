// browserx generator entry. Loads the W3C WebIDL catalog from @webref/idl, filters down to
// the curated subset, emits one Sova file per interface group, and writes the hand-authored
// strix-aligned facade alongside.
//
// Usage:
//   bun run src/main.ts                       # writes to ./out
//   bun run src/main.ts --out ../browserx/src # writes into the sibling browserx package
//
// The generator is purely a build-time tool: production browserx Sova source is committed
// without re-running this on consumer machines.

import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadCatalog } from "./loader";
import { emit } from "./emit";
import { emitFacade } from "./facade";
import { loadDocIndex } from "./docs";

function parseArgs(argv: string[]): { out: string; keepExisting: boolean } {
  let out = "./out";
  let keepExisting = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && i + 1 < argv.length) {
      out = argv[++i]!;
    } else if (argv[i] === "--keep") {
      keepExisting = true;
    }
  }
  return { out: resolve(out), keepExisting };
}

const { out, keepExisting } = parseArgs(Bun.argv.slice(2));

console.log(`browserx-generator: target = ${out}`);

console.log("loading WebIDL catalog (@webref/idl)...");
const catalog = await loadCatalog();
console.log(`  loaded ${catalog.specs.length} specs, ${catalog.interfaces.size} interfaces after subset filtering`);

console.log("loading MDN docs from typescript lib.dom.d.ts...");
const docs = loadDocIndex();

const generatedDir = join(out, "generated");
if (!keepExisting && existsSync(generatedDir)) {
  rmSync(generatedDir, { recursive: true, force: true });
}

const files = [...emit(catalog, docs), ...emitFacade()];
mkdirSync(out, { recursive: true });
for (const f of files) {
  const fullPath = join(out, f.path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, f.content);
}

console.log(`wrote ${files.length} files`);
const generatedCount = files.filter((f) => f.path.startsWith("generated/")).length;
const facadeCount = files.length - generatedCount;
console.log(`  ${generatedCount} generated, ${facadeCount} facade`);
