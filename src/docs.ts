import ts from "typescript";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DocIndex = {
  interfaceDoc(name: string): string | undefined;
  memberDoc(iface: string, member: string): string | undefined;
  staticDoc(iface: string, member: string): string | undefined;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB_DOM_PATH = join(HERE, "..", "node_modules", "typescript", "lib", "lib.dom.d.ts");

export function loadDocIndex(): DocIndex {
  const source = readFileSync(LIB_DOM_PATH, "utf-8");
  const sf = ts.createSourceFile(LIB_DOM_PATH, source, ts.ScriptTarget.Latest, true);

  const ifaceDocs = new Map<string, string>();
  const memberDocs = new Map<string, string>();
  const staticDocs = new Map<string, string>();

  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      const name = stmt.name.text;
      const ifaceJsdoc = jsdocFor(stmt, source);
      if (ifaceJsdoc && !ifaceDocs.has(name)) ifaceDocs.set(name, ifaceJsdoc);
      for (const member of stmt.members) {
        const memberName = nameOf(member);
        if (!memberName) continue;
        const key = `${name}.${memberName}`;
        if (memberDocs.has(key)) continue;
        const doc = jsdocFor(member, source);
        if (doc) memberDocs.set(key, doc);
      }
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const ifaceName = decl.name.text;
        const type = decl.type;
        if (!type || !ts.isTypeLiteralNode(type)) continue;
        for (const member of type.members) {
          const memberName = nameOf(member);
          if (!memberName) continue;
          const key = `${ifaceName}.${memberName}`;
          if (staticDocs.has(key)) continue;
          const doc = jsdocFor(member, source);
          if (doc) staticDocs.set(key, doc);
        }
      }
    }
  }

  return {
    interfaceDoc: (n) => ifaceDocs.get(n),
    memberDoc: (i, m) => memberDocs.get(`${i}.${m}`),
    staticDoc: (i, m) => staticDocs.get(`${i}.${m}`),
  };
}

function nameOf(node: ts.Node): string | undefined {
  if ("name" in node) {
    const n = (node as { name: ts.Node }).name;
    if (n && ts.isIdentifier(n)) return n.text;
    if (n && ts.isStringLiteral(n)) return n.text;
  }
  return undefined;
}

function jsdocFor(node: ts.Node, source: string): string | undefined {
  const ranges = ts.getLeadingCommentRanges(source, node.pos) ?? [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]!;
    if (r.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const raw = source.slice(r.pos, r.end);
    if (!raw.startsWith("/**")) continue;
    return cleanJsdoc(raw);
  }
  return undefined;
}

function cleanJsdoc(raw: string): string {
  const inner = raw
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .filter((line, i, arr) => !(line === "" && (i === 0 || i === arr.length - 1)));
  while (inner.length > 0 && inner[0] === "") inner.shift();
  while (inner.length > 0 && inner[inner.length - 1] === "") inner.pop();
  return inner.join("\n");
}
