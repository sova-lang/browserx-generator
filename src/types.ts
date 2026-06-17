import type * as webidl from "webidl2";

export type IDLTypeNode = webidl.IDLTypeDescription;

export type SovaTypeMapping = {
  sovaType: string;
  needsHandleWrap?: string;
  isAsync?: boolean;
};

const PRIMITIVE_MAP: Record<string, string> = {
  boolean: "bool",

  byte: "int",
  octet: "int",
  short: "int",
  "unsigned short": "int",
  long: "int",
  "unsigned long": "int",
  "long long": "int",
  "unsigned long long": "int",

  float: "float",
  double: "float",
  "unrestricted float": "float",
  "unrestricted double": "float",

  DOMString: "string",
  USVString: "string",
  ByteString: "string",
  CSSOMString: "string",

  any: "any",
  object: "any",

  undefined: "",
  void: "",

  bigint: "int",
};

export type DocLookup = {
  interfaceDoc(name: string): string | undefined;
  memberDoc(iface: string, member: string): string | undefined;
  staticDoc(iface: string, member: string): string | undefined;
};

export type MapperContext = {
  wrappable: Set<string>;
  dictionaries: Map<string, webidl.DictionaryType>;
  enums: Set<string>;
  callbacks: Map<string, webidl.CallbackType>;
  typedefs: Map<string, webidl.TypedefType>;
  docs?: DocLookup;
};

export type NameSets = MapperContext;

export function translateType(node: IDLTypeNode, ctx: MapperContext): SovaTypeMapping {
  if (node.union) {
    return { sovaType: "any" };
  }

  if (node.generic) {
    const inner = node.idlType as IDLTypeNode[];
    switch (node.generic) {
      case "sequence":
      case "FrozenArray":
      case "ObservableArray": {
        if (inner.length === 1) {
          const elem = translateType(inner[0]!, ctx);
          const t = elem.sovaType || "any";
          return wrapNullable(node, `[]${t}`);
        }
        return wrapNullable(node, "[]any");
      }
      case "record": {
        if (inner.length === 2) {
          const k = translateType(inner[0]!, ctx).sovaType || "string";
          const v = translateType(inner[1]!, ctx).sovaType || "any";
          const padded = v.endsWith(">") ? `${v} ` : v;
          return wrapNullable(node, `map<${k}, ${padded}>`);
        }
        return wrapNullable(node, "map<string, any>");
      }
      case "Promise": {
        // Sova auto-async via pass_propagate_async: drop the Promise wrapper from the type
        // annotation and surface T as if synchronous, but flag the result so the emitter
        // knows to mark the extern `async`. The propagate pass then lifts asyncness through
        // wrapper methods + their callers without users needing to write `await` themselves.
        if (inner.length === 1) {
          const inner0 = translateType(inner[0]!, ctx);
          return { ...inner0, isAsync: true };
        }
        return { sovaType: "any", isAsync: true };
      }
      default:
        return wrapNullable(node, "any");
    }
  }

  const leaf = node.idlType as string;
  if (typeof leaf !== "string") {
    return wrapNullable(node, "any");
  }

  if (leaf in PRIMITIVE_MAP) {
    const mapped = PRIMITIVE_MAP[leaf]!;
    if (mapped === "") return { sovaType: "" }; // void return
    return wrapNullable(node, mapped);
  }

  if (ctx.wrappable.has(leaf)) {
    return wrapNullable(node, leaf, leaf);
  }

  if (ctx.enums.has(leaf)) {
    return wrapNullable(node, leaf, undefined);
  }

  if (ctx.dictionaries.has(leaf)) {
    return wrapNullable(node, leaf, undefined);
  }

  const cbk = ctx.callbacks.get(leaf);
  if (cbk) {
    const sig = callbackSignature(cbk, ctx);
    return wrapNullable(node, sig);
  }

  const td = ctx.typedefs.get(leaf);
  if (td) {
    return translateType(td.idlType, ctx);
  }

  // Unknown reference: degrade to `any` and rely on the JS engine to dispatch.
  return { sovaType: "any" };
}

// callbackSignature builds the Sova `func(arg: T, ...): R` type string for a WebIDL callback
// declaration. Used when a typedef alias resolves to a callback (the EventHandler case) and
// when a callback name is referenced directly. The returned string is suitable for embedding
// in a Sova type annotation slot.
function callbackSignature(cb: webidl.CallbackType, ctx: MapperContext): string {
  const params: string[] = [];
  let idx = 0;
  for (const arg of cb.arguments) {
    const mapped = translateType(arg.idlType, ctx);
    const sovaArg = sovaIdent(arg.name || `arg${idx}`);
    params.push(`${sovaArg}: ${mapped.sovaType || "any"}`);
    idx++;
  }
  const retMapping = translateType(cb.idlType, ctx);
  const retSig = retMapping.sovaType ? `: ${retMapping.sovaType}` : "";
  return `func(${params.join(", ")})${retSig}`;
}

function wrapNullable(node: IDLTypeNode, sovaType: string, needsHandleWrap?: string): SovaTypeMapping {
  if (node.nullable) {
    const inner = sovaType.endsWith(">") ? `${sovaType} ` : sovaType;
    return { sovaType: `option<${inner}>`, needsHandleWrap };
  }
  return { sovaType, needsHandleWrap };
}

// isVoidReturn is the canonical check for an operation that returns no value (Sova omits the
// return type annotation in that case).
export function isVoidReturn(node: IDLTypeNode): boolean {
  if (node.generic) return false;
  if (node.union) return false;
  return node.idlType === "undefined" || node.idlType === "void";
}

// sovaIdent maps a JS-style identifier to a Sova identifier that is guaranteed not to collide
// with Sova keywords, type names, or extern's leading-underscore convention. Most names pass
// through; collisions get suffixed.
const SOVA_KEYWORDS = new Set([
  // Control flow / declaration keywords.
  "if", "else", "for", "while", "return", "guard", "break", "continue", "when", "in", "step",
  "let", "const", "func", "type", "enum", "interface", "mixin", "extern", "new", "package",
  "import", "on", "using", "synth", "emit", "async", "go", "defer", "select", "case", "default",
  "private", "shared", "implements", "with", "wire", "ruleset", "true", "false", "none",
  "frontend", "backend", "this", "test", "as",
  // Built-in type names. Using one of these as an identifier (method or parameter) makes the
  // parser ambiguous between a type ref and a name ref.
  "int", "float", "bool", "string", "char", "any", "byte", "map", "option", "chan",
  // JS strict-mode reserved words. These don't conflict with the Sova parser but DO conflict
  // with the emitted JS - using `arguments` as a parameter name in an ES module triggers an
  // esbuild error (strict mode rejects rebinding `arguments`). Surfacing them in sovaIdent
  // means the suffixed `arguments_` lands in BOTH the Sova source and the JS extern body, so
  // the binding stays consistent.
  "arguments", "eval", "yield", "await", "static",
]);

export function sovaIdent(jsName: string): string {
  let name = jsName;
  while (name.startsWith("_")) name = name.slice(1);
  if (name === "") name = jsName;
  if (SOVA_KEYWORDS.has(name)) return name + "_";
  return name;
}
