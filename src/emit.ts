import type * as webidl from "webidl2";
import type { Catalog, CollectedInterface } from "./loader";
import { isVoidReturn, sovaIdent, translateType, type MapperContext } from "./types";

export type EmitFile = {
  path: string; // relative path under the output dir
  content: string;
};

// PackageGroup pins each interface to an output file. Groups are intentionally coarse so users
// import `browserx` and have everything; the file split is purely an organizational concern
// inside the generated package.
type PackageGroup = {
  file: string;
  members: string[];
};

const GROUPS: PackageGroup[] = [
  { file: "core.sova", members: [
    "EventTarget", "Node", "CharacterData", "Text", "Comment", "Document",
    "DocumentFragment", "Element", "Attr", "DOMTokenList", "NamedNodeMap",
    "NodeList", "HTMLCollection", "Range", "DOMImplementation", "DOMException",
    "DOMStringMap", "AbortController", "AbortSignal", "URL", "URLSearchParams",
  ] },
  { file: "events.sova", members: [
    "Event", "CustomEvent", "UIEvent", "MouseEvent", "KeyboardEvent",
    "InputEvent", "CompositionEvent", "FocusEvent", "WheelEvent",
    "PointerEvent", "TouchEvent", "Touch", "TouchList",
    // HTML/UI-spec event subclasses surfaced for typed handler attributes.
    "SubmitEvent", "BeforeUnloadEvent", "ErrorEvent", "HashChangeEvent",
    "PageTransitionEvent", "PopStateEvent", "PromiseRejectionEvent",
    "MessageEvent", "StorageEvent", "DragEvent",
  ] },
  { file: "html.sova", members: [
    "HTMLElement", "HTMLBodyElement", "HTMLHeadElement", "HTMLDivElement",
    "HTMLSpanElement", "HTMLParagraphElement", "HTMLAnchorElement",
    "HTMLImageElement", "HTMLInputElement", "HTMLButtonElement",
    "HTMLFormElement", "HTMLLabelElement", "HTMLSelectElement",
    "HTMLOptionElement", "HTMLOptGroupElement", "HTMLTextAreaElement",
    "HTMLUListElement", "HTMLOListElement", "HTMLLIElement",
    "HTMLHeadingElement", "HTMLTableElement", "HTMLTableRowElement",
    "HTMLTableCellElement", "HTMLTableSectionElement", "HTMLCanvasElement",
    "HTMLDialogElement", "HTMLDetailsElement", "HTMLTemplateElement",
    "HTMLScriptElement", "HTMLStyleElement", "HTMLLinkElement",
    "HTMLMetaElement", "HTMLTitleElement", "HTMLIFrameElement",
    "HTMLVideoElement", "HTMLAudioElement", "HTMLMediaElement",
    "HTMLSourceElement", "HTMLTrackElement", "ValidityState",
    "DataTransfer", "FormData",
  ] },
  { file: "window.sova", members: [
    "Window", "Location", "History", "Navigator", "Storage",
  ] },
  { file: "css.sova", members: [
    "CSSStyleDeclaration", "CSSStyleSheet", "CSSRule", "StyleSheet",
  ] },
  { file: "geometry.sova", members: [
    "DOMRect", "DOMRectReadOnly", "DOMPoint", "DOMPointReadOnly",
  ] },
  { file: "files.sova", members: [
    "File", "Blob", "FileList", "FileReader",
  ] },
  { file: "fetch.sova", members: [
    "Headers", "Request", "Response",
  ] },
  { file: "svg.sova", members: [
    "SVGElement", "SVGGraphicsElement", "SVGGeometryElement", "SVGSVGElement",
    "SVGGElement", "SVGPathElement", "SVGRectElement", "SVGCircleElement",
    "SVGEllipseElement", "SVGLineElement", "SVGPolygonElement", "SVGPolylineElement",
    "SVGTextElement", "SVGTSpanElement", "SVGTextPathElement", "SVGImageElement",
    "SVGUseElement", "SVGDefsElement", "SVGSymbolElement", "SVGMarkerElement",
    "SVGTitleElement", "SVGDescElement",
  ] },
];

// fileForInterface returns the group filename an interface belongs in. Interfaces not listed in
// any group land in "misc.sova" so we never silently drop something the loader pulled in
// transitively.
function fileForInterface(name: string): string {
  for (const g of GROUPS) {
    if (g.members.includes(name)) return g.file;
  }
  return "misc.sova";
}

export function emit(catalog: Catalog): EmitFile[] {
  const reachable = collectReachableNames(catalog);
  const ctx: MapperContext = {
    wrappable: new Set(catalog.interfaces.keys()),
    dictionaries: filterMap(catalog.dictionaries, reachable.dictionaries),
    enums: reachable.enums,
    callbacks: catalog.callbacks,
    typedefs: catalog.typedefs,
  };

  const byFile = new Map<string, string[]>();
  const ifaceOrder = sortedNames([...catalog.interfaces.keys()]);
  for (const name of ifaceOrder) {
    const ci = catalog.interfaces.get(name)!;
    const sova = emitInterface(name, ci, catalog, ctx);
    const file = fileForInterface(name);
    const arr = byFile.get(file) ?? [];
    arr.push(sova);
    byFile.set(file, arr);
  }

  const enumParts: string[] = [];
  for (const name of sortedNames([...reachable.enums])) {
    const decl = catalog.enums.get(name);
    if (!decl) continue;
    enumParts.push(emitEnum(name, decl));
  }
  if (enumParts.length > 0) {
    byFile.set("enums.sova", enumParts);
  }

  const dictParts: string[] = [];
  for (const name of sortedNames([...reachable.dictionaries])) {
    const decl = catalog.dictionaries.get(name);
    if (!decl) continue;
    dictParts.push(emitDictionary(name, decl, ctx));
  }
  if (dictParts.length > 0) {
    byFile.set("dictionaries.sova", dictParts);
  }

  const out: EmitFile[] = [];
  for (const [file, parts] of byFile) {
    const header = `package browserx on frontend\n\n`;
    out.push({ path: `generated/${file}`, content: header + parts.join("\n") });
  }
  return out;
}

// collectReachableNames walks every in-subset interface's signatures and harvests the enum /
// dictionary names they reference. We deliberately don't emit every enum/dict in the entire
// WebIDL universe because most of them belong to APIs (WebGL, WebRTC, MediaSession, ...) the
// user can't reach without the parent interfaces in subset. This keeps the generated output
// proportional to the subset rather than the full IDL surface.
function collectReachableNames(catalog: Catalog): { enums: Set<string>; dictionaries: Set<string> } {
  const enums = new Set<string>();
  const dictionaries = new Set<string>();

  function visit(node: webidl.IDLTypeDescription | null | undefined): void {
    if (!node) return;
    if (node.union) {
      for (const inner of node.idlType as webidl.IDLTypeDescription[]) visit(inner);
      return;
    }
    if (node.generic) {
      for (const inner of node.idlType as webidl.IDLTypeDescription[]) visit(inner);
      return;
    }
    const leaf = node.idlType as string;
    if (typeof leaf !== "string") return;
    if (catalog.enums.has(leaf)) enums.add(leaf);
    if (catalog.dictionaries.has(leaf)) dictionaries.add(leaf);
    const td = catalog.typedefs.get(leaf);
    if (td) visit(td.idlType);
  }

  for (const ci of catalog.interfaces.values()) {
    const members = [
      ...(ci.iface.members as webidl.IDLInterfaceMemberType[]),
      ...ci.mixins.flatMap((m) => m.members as webidl.IDLInterfaceMemberType[]),
    ];
    for (const m of members) {
      if (m.type === "attribute") {
        visit((m as webidl.AttributeMemberType).idlType);
      } else if (m.type === "operation") {
        const op = m as webidl.OperationMemberType;
        visit(op.idlType);
        for (const arg of op.arguments) visit(arg.idlType);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...dictionaries]) {
      const d = catalog.dictionaries.get(name);
      if (!d) continue;
      for (const member of d.members) {
        const before = dictionaries.size + enums.size;
        visit(member.idlType);
        if (dictionaries.size + enums.size !== before) changed = true;
      }
    }
  }

  return { enums, dictionaries };
}

function filterMap<K, V>(src: Map<K, V>, keep: Set<K>): Map<K, V> {
  const out = new Map<K, V>();
  for (const k of keep) {
    const v = src.get(k);
    if (v !== undefined) out.set(k, v);
  }
  return out;
}

function sortedNames(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

// emitInterface produces the Sova type declaration for one IDL interface. Members (attributes
// and operations) become struct methods that proxy into the underlying JS handle via
// per-member extern declarations. Inheritance is materialized as a Sova `mixin` include so
// inherited members appear on the subclass without us re-emitting them.
function emitInterface(
  name: string,
  ci: CollectedInterface,
  catalog: Catalog,
  ctx: MapperContext,
): string {
  const lines: string[] = [];
  const externLines: string[] = [];
  const seen = new Set<string>(); // dedupe attr/op names across mixins (last wins, IDL semantics)

  lines.push(`/// ${name} - generated WebIDL binding. From ${ci.spec} spec.`);
  lines.push(`type ${name} {`);
  lines.push(`    handle: any = none`);
  lines.push(`    private _iterCursor: int = 0`);
  lines.push(``);
  lines.push(`    new(handle: any) { this.handle = handle }`);

  const chain: CollectedInterface[] = [];
  let cursor: CollectedInterface | undefined = ci;
  while (cursor) {
    chain.push(cursor);
    const parentName = cursor.iface.inheritance;
    if (!parentName) break;
    cursor = catalog.interfaces.get(parentName);
  }
  
  chain.reverse();
  const allMembers: webidl.IDLInterfaceMemberType[] = [];
  for (const link of chain) {
    for (const m of link.iface.members as webidl.IDLInterfaceMemberType[]) {
      allMembers.push(m);
    }
    for (const mixin of link.mixins) {
      for (const m of mixin.members as webidl.IDLInterfaceMemberType[]) {
        allMembers.push(m);
      }
    }
  }

  const constantLines: string[] = [];
  const constructorLines: string[] = [];
  const ownConstructors = (ci.iface.members as webidl.IDLInterfaceMemberType[]).filter(
    (m) => m.type === "constructor",
  ) as webidl.ConstructorMemberType[];

  let indexedGetter: webidl.OperationMemberType | undefined;
  let namedGetter: webidl.OperationMemberType | undefined;
  let indexedSetter: webidl.OperationMemberType | undefined;
  let namedSetter: webidl.OperationMemberType | undefined;
  let iterableMember: webidl.IterableType | undefined;
  let maplikeMember: webidl.MaplikeType | undefined;
  let setlikeMember: webidl.SetlikeType | undefined;
  const staticOps: webidl.OperationMemberType[] = [];

  for (const member of allMembers) {
    if (member.type === "attribute") {
      const attr = member as webidl.AttributeMemberType;
      const key = `attr:${attr.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      emitAttribute(name, attr, lines, externLines, ctx);
    } else if (member.type === "operation") {
      const op = member as webidl.OperationMemberType;
      if (op.special === "static") {
        staticOps.push(op);
        continue;
      }
      
      if (op.special === "getter") {
        if (op.arguments[0]?.idlType?.idlType === "DOMString" || op.arguments[0]?.idlType?.idlType === "USVString") {
          if (!namedGetter) namedGetter = op;
        } else if (!indexedGetter) {
          indexedGetter = op;
        }
      } else if (op.special === "setter") {
        if (op.arguments[0]?.idlType?.idlType === "DOMString" || op.arguments[0]?.idlType?.idlType === "USVString") {
          if (!namedSetter) namedSetter = op;
        } else if (!indexedSetter) {
          indexedSetter = op;
        }
      }
      if (!op.name) continue; // unnamed special ops - the synthesis below handles them
      const key = `op:${op.name}:${op.arguments.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      emitOperation(name, op, lines, externLines, ctx, catalog);
    } else if (member.type === "iterable") {
      if (!iterableMember) iterableMember = member as webidl.IterableType;
    } else if (member.type === "maplike") {
      maplikeMember = member as webidl.MaplikeType;
    } else if (member.type === "setlike") {
      setlikeMember = member as webidl.SetlikeType;
    }
  }

  if (indexedGetter) {
    emitIndexedGetter(name, indexedGetter, lines, externLines, ctx);
  }
  if (namedGetter) {
    emitNamedGetter(name, namedGetter, lines, externLines, ctx);
  }
  if (indexedSetter) {
    emitIndexedSetter(name, indexedSetter, lines, externLines, ctx);
  }
  if (namedSetter) {
    emitNamedSetter(name, namedSetter, lines, externLines, ctx);
  }
  if (iterableMember) {
    emitIterable(name, iterableMember, lines, externLines, ctx);
  }
  if (maplikeMember) {
    emitMaplike(name, maplikeMember, lines, externLines, ctx);
  }
  if (setlikeMember) {
    emitSetlike(name, setlikeMember, lines, externLines, ctx);
  }

  for (const member of ci.iface.members as webidl.IDLInterfaceMemberType[]) {
    if (member.type !== "const") continue;
    const c = member as webidl.ConstantMemberType;
    emitConstant(name, c, constantLines, ctx);
  }

  for (let i = 0; i < ownConstructors.length; i++) {
    emitConstructor(name, ownConstructors[i]!, i, constructorLines, externLines, ctx);
  }

  const staticOpLines: string[] = [];
  const staticSeen = new Set<string>();
  for (const op of staticOps) {
    if (!op.name) continue;
    const key = `static:${op.name}:${op.arguments.length}`;
    if (staticSeen.has(key)) continue;
    staticSeen.add(key);
    emitStaticOperation(name, op, staticOpLines, externLines, ctx);
  }

  if (ci.iface.inheritance) {
    lines.splice(0, 0, `/// inherits ${ci.iface.inheritance}`);
  }

  lines.push(`}`);
  lines.push(``);

  if (constantLines.length > 0) {
    lines.push(...constantLines);
    lines.push(``);
  }

  if (constructorLines.length > 0) {
    lines.push(...constructorLines);
    lines.push(``);
  }

  if (staticOpLines.length > 0) {
    lines.push(...staticOpLines);
    lines.push(``);
  }

  if (externLines.length > 0) {
    lines.push(`extern {`);
    lines.push(...externLines.map((l) => `    ${l}`));
    lines.push(`}`);
    lines.push(``);
  }

  return lines.join("\n");
}

function emitAttribute(
  ifaceName: string,
  attr: webidl.AttributeMemberType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): string | undefined {
  const sovaName = sovaIdent(attr.name);
  let typ = translateType(attr.idlType, ctx);
  if (!typ.sovaType) return;
  if (attr.name.startsWith("on")) {
    const eventType = EVENT_HANDLER_TYPES[attr.name];
    if (eventType && ctx.wrappable.has(eventType)) {
      typ = { sovaType: `option<func(event: ${eventType}): any>` };
    }
  }

  const externGetName = `__bx_${ifaceName}_get_${sovaName}`;
  const externSetName = `__bx_${ifaceName}_set_${sovaName}`;

  lines.push(``);
  lines.push(`    /// IDL attribute ${attr.name}: ${attr.idlType.idlType}`);
  if (typ.needsHandleWrap) {
    lines.push(`    func ${sovaName}(): ${typ.sovaType} {`);
    lines.push(`        return new ${typ.needsHandleWrap}(${externGetName}(this.handle))`);
    lines.push(`    }`);
  } else {
    lines.push(`    func ${sovaName}(): ${typ.sovaType} {`);
    lines.push(`        return ${externGetName}(this.handle)`);
    lines.push(`    }`);
  }
  
  const asyncKw = typ.isAsync ? "async " : "";
  externLines.push(`${asyncKw}func ${externGetName}(h: any): ${typ.sovaType} = {`);
  externLines.push(`    frontend: "(h) => (h == null ? undefined : h.${attr.name})"`);
  externLines.push(`}`);

  if (!attr.readonly) {
    const setterName = "set" + sovaName.charAt(0).toUpperCase() + sovaName.slice(1);
    lines.push(``);
    lines.push(`    func ${setterName}(v: ${typ.sovaType}) {`);
    lines.push(`        ${externSetName}(this.handle, v)`);
    lines.push(`    }`);
    externLines.push(`func ${externSetName}(h: any, v: ${typ.sovaType}) = {`);
    externLines.push(`    frontend: "(h, v) => { if (h != null) h.${attr.name} = v; }"`);
    externLines.push(`}`);
  }
}

// EVENT_HANDLER_TYPES is the hard-coded `on*` attribute → event-class map the HTML/UI Events
// specs codify in prose rather than IDL. WebIDL types every handler attribute as the generic
// `EventHandler` (= `(Event) => any`), so without an override every `onclick` would surface as
// `func(event: Event)` and force users to cast inside the handler to read mouse coordinates.
// Coverage here is the ~95% of handlers user code touches; unmapped entries fall through to the
// generic Event-typed callback that the typedef path produces.
const EVENT_HANDLER_TYPES: Record<string, string> = {
  // Mouse events
  onclick: "MouseEvent",
  ondblclick: "MouseEvent",
  oncontextmenu: "MouseEvent",
  onauxclick: "MouseEvent",
  onmousedown: "MouseEvent",
  onmouseup: "MouseEvent",
  onmouseover: "MouseEvent",
  onmousemove: "MouseEvent",
  onmouseout: "MouseEvent",
  onmouseenter: "MouseEvent",
  onmouseleave: "MouseEvent",

  // Keyboard events
  onkeydown: "KeyboardEvent",
  onkeypress: "KeyboardEvent",
  onkeyup: "KeyboardEvent",

  // Input / composition / form events
  oninput: "InputEvent",
  onbeforeinput: "InputEvent",
  oncompositionstart: "CompositionEvent",
  oncompositionupdate: "CompositionEvent",
  oncompositionend: "CompositionEvent",

  // Focus events
  onfocus: "FocusEvent",
  onblur: "FocusEvent",
  onfocusin: "FocusEvent",
  onfocusout: "FocusEvent",

  // Pointer events
  onpointerdown: "PointerEvent",
  onpointerup: "PointerEvent",
  onpointermove: "PointerEvent",
  onpointercancel: "PointerEvent",
  onpointerover: "PointerEvent",
  onpointerout: "PointerEvent",
  onpointerenter: "PointerEvent",
  onpointerleave: "PointerEvent",
  ongotpointercapture: "PointerEvent",
  onlostpointercapture: "PointerEvent",

  // Touch events
  ontouchstart: "TouchEvent",
  ontouchend: "TouchEvent",
  ontouchmove: "TouchEvent",
  ontouchcancel: "TouchEvent",

  // Wheel
  onwheel: "WheelEvent",

  // UI events
  onresize: "UIEvent",

  // Form / submit
  onsubmit: "SubmitEvent",
  onformdata: "Event",
  onreset: "Event",
  onchange: "Event",
  oninvalid: "Event",
  onselect: "Event",
  oncancel: "Event",
  onclose: "Event",

  // Drag
  ondrag: "DragEvent",
  ondragstart: "DragEvent",
  ondragend: "DragEvent",
  ondragenter: "DragEvent",
  ondragleave: "DragEvent",
  ondragover: "DragEvent",
  ondrop: "DragEvent",

  // Error / lifecycle
  onerror: "ErrorEvent",
  onbeforeunload: "BeforeUnloadEvent",
  onpopstate: "PopStateEvent",
  onhashchange: "HashChangeEvent",
  onpagehide: "PageTransitionEvent",
  onpageshow: "PageTransitionEvent",
  onunhandledrejection: "PromiseRejectionEvent",
  onrejectionhandled: "PromiseRejectionEvent",

  // Messaging / storage
  onmessage: "MessageEvent",
  onmessageerror: "MessageEvent",
  onstorage: "StorageEvent",

  // Media (HTMLMediaElement events; payload is plain Event but typed for IDE recall)
  onloadstart: "Event",
  onloadeddata: "Event",
  onloadedmetadata: "Event",
  onplay: "Event",
  onplaying: "Event",
  onpause: "Event",
  onended: "Event",
  ontimeupdate: "Event",
  onvolumechange: "Event",
  onseeking: "Event",
  onseeked: "Event",
  oncanplay: "Event",
  oncanplaythrough: "Event",
  ondurationchange: "Event",
  onratechange: "Event",
  onsuspend: "Event",
  onstalled: "Event",
  onwaiting: "Event",
  onemptied: "Event",
  onabort: "Event",
};

function emitConstant(
  ifaceName: string,
  c: webidl.ConstantMemberType,
  lines: string[],
  ctx: MapperContext,
): void {
  const typ = translateType(c.idlType, ctx);
  const sovaType = typ.sovaType || "int";
  const sovaName = `${ifaceName}_${c.name}`;
  const valNode = c.value as { type: string; value: unknown };
  let valueStr: string;
  if (valNode.type === "boolean") {
    valueStr = String(valNode.value);
  } else if (valNode.type === "number") {
    valueStr = String(valNode.value);
  } else if (valNode.type === "null") {
    valueStr = "none";
  } else if (typeof valNode.value === "string") {
    valueStr = valNode.value;
  } else {
    return;
  }
  lines.push(`/// ${ifaceName}.${c.name} - WebIDL const`);
  lines.push(`const ${sovaName}: ${sovaType} = ${valueStr}`);
}

function emitConstructor(
  ifaceName: string,
  ctor: webidl.ConstructorMemberType,
  idx: number,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): void {
  const factoryName = idx === 0 ? `new${ifaceName}` : `new${ifaceName}_${idx}`;
  const externName = `__bx_${ifaceName}_construct${idx === 0 ? "" : `_${idx}`}`;

  const params: { name: string; sova: string; needsHandleWrap?: string }[] = [];
  let argIdx = 0;
  for (const arg of ctor.arguments) {
    const argMapping = translateType(arg.idlType, ctx);
    const sovaArgName = sovaIdent(arg.name || `arg${argIdx}`);
    params.push({
      name: sovaArgName,
      sova: argMapping.sovaType || "any",
      needsHandleWrap: argMapping.needsHandleWrap,
    });
    argIdx++;
  }

  const paramSig = params.map((p) => `${p.name}: ${p.sova}`).join(", ");
  const argList = params.map((p) => p.name).join(", ");

  lines.push(`/// ${ifaceName} factory - WebIDL constructor binding.`);
  lines.push(`func ${factoryName}(${paramSig}): ${ifaceName} {`);
  lines.push(`    return new ${ifaceName}(${externName}(${argList}))`);
  lines.push(`}`);

  const jsParams = params.map((p) => p.name);
  const jsArgs = params.map((p) => (p.needsHandleWrap ? `${p.name}.handle` : p.name)).join(", ");
  const externParams = params.map((p) => `${p.name}: ${p.sova}`).join(", ");
  externLines.push(`func ${externName}(${externParams}): any = {`);
  externLines.push(`    frontend: "(${jsParams.join(", ")}) => new ${ifaceName}(${jsArgs})"`);
  externLines.push(`}`);
}

function emitOperation(
  ifaceName: string,
  op: webidl.OperationMemberType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
  _catalog: Catalog,
): void {
  const sovaName = sovaIdent(op.name!);
  const externName = `__bx_${ifaceName}_${sovaName}`;
  const retInfo = translateType(op.idlType, ctx);
  const isVoid = isVoidReturn(op.idlType) || retInfo.sovaType === "";
  const params: { name: string; sova: string; needsHandleWrap?: string; optional: boolean }[] = [];

  let argIdx = 0;
  for (const arg of op.arguments) {
    const argMapping = translateType(arg.idlType, ctx);
    const sovaArgName = sovaIdent(arg.name || `arg${argIdx}`);
    params.push({
      name: sovaArgName,
      sova: argMapping.sovaType || "any",
      needsHandleWrap: argMapping.needsHandleWrap,
      optional: !!arg.optional,
    });
    argIdx++;
  }

  const paramSig = params.map((p) => `${p.name}: ${p.sova}`).join(", ");

  lines.push(``);
  lines.push(`    /// IDL operation ${op.name}`);
  if (isVoid) {
    lines.push(`    func ${sovaName}(${paramSig}) {`);
    lines.push(`        ${externName}(this.handle${params.length > 0 ? ", " + params.map((p) => paramRef(p)).join(", ") : ""})`);
    lines.push(`    }`);
  } else if (retInfo.needsHandleWrap) {
    lines.push(`    func ${sovaName}(${paramSig}): ${retInfo.sovaType} {`);
    lines.push(`        return new ${retInfo.needsHandleWrap}(${externName}(this.handle${params.length > 0 ? ", " + params.map((p) => paramRef(p)).join(", ") : ""}))`);
    lines.push(`    }`);
  } else {
    lines.push(`    func ${sovaName}(${paramSig}): ${retInfo.sovaType} {`);
    lines.push(`        return ${externName}(this.handle${params.length > 0 ? ", " + params.map((p) => paramRef(p)).join(", ") : ""})`);
    lines.push(`    }`);
  }

  const jsParams = ["h", ...params.map((p) => p.name)];
  const jsArgs = params.map((p) => (p.needsHandleWrap ? `${p.name}.handle` : p.name)).join(", ");
  const externParams = ["h: any", ...params.map((p) => `${p.name}: ${p.sova}`)].join(", ");
  const externRet = isVoid ? "" : `: ${retInfo.sovaType}`;
  const asyncKw = retInfo.isAsync ? "async " : "";
  if (isVoid) {
    externLines.push(`${asyncKw}func ${externName}(${externParams})${externRet} = {`);
    externLines.push(`    frontend: "(${jsParams.join(", ")}) => { if (h != null) h.${op.name}(${jsArgs}); }"`);
    externLines.push(`}`);
  } else {
    externLines.push(`${asyncKw}func ${externName}(${externParams})${externRet} = {`);
    externLines.push(`    frontend: "(${jsParams.join(", ")}) => (h == null ? undefined : h.${op.name}(${jsArgs}))"`);
    externLines.push(`}`);
  }
}

function paramRef(p: { name: string; needsHandleWrap?: string }): string {
  // Note: when the JS side expects an unwrapped handle, the extern body strips `.handle` from
  // the wrapper struct. From Sova-side we pass the wrapper through; the extern signature still
  // takes the typed Sova value.
  return p.name;
}

// emitEnum produces a Sova payload enum from a WebIDL enum declaration. The IDL allows
// arbitrary string values; the Sova case name is mangled to satisfy identifier rules while the
// payload carries the raw IDL string so JS round-trips losslessly.
function emitEnum(name: string, decl: webidl.EnumType): string {
  const lines: string[] = [];
  lines.push(`/// ${name} - generated WebIDL enum.`);
  lines.push(`enum ${name}(value: string) {`);
  const cases: { sovaCase: string; jsValue: string }[] = [];
  for (const v of decl.values) {
    const jsValue = v.value;
    const sovaCase = mangleEnumCase(jsValue);
    cases.push({ sovaCase, jsValue });
  }
  
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    const comma = i < cases.length - 1 ? "," : "";
    lines.push(`    ${c.sovaCase}(${JSON.stringify(c.jsValue)})${comma}`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`/// ${name}FromString parses a raw WebIDL enum string into the Sova enum. Returns`);
  lines.push(`/// none when the input doesn't match any case.`);
  lines.push(`func ${name}FromString(s: string): option<${name}> {`);
  for (const c of cases) {
    lines.push(`    if s == ${JSON.stringify(c.jsValue)} {`);
    lines.push(`        return ${name}.${c.sovaCase}`);
    lines.push(`    }`);
  }
  lines.push(`    return none`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}

// mangleEnumCase converts an IDL enum string value into a valid Sova identifier. The IDL spec
// lets enum values be arbitrary text; in practice nearly all are alphanumeric with the
// occasional hyphen or slash. We PascalCase the result, replace separators with underscores,
// and suffix keyword collisions.
function mangleEnumCase(value: string): string {
  if (value === "") return "Empty";
  const parts = value.split(/[-/_\s]+/).filter((p) => p.length > 0);
  const camel = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  let id = camel.replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[0-9]/.test(id)) id = "V" + id;
  if (id === "") id = "Value";
  return sovaIdent(id);
}

// emitDictionary turns a WebIDL dictionary into a Sova struct. Defaults are translated where
// the IDL supplies them; types are mapped through the same `translateType` path as interface
// members, so callbacks/enums/nested dicts resolve correctly.
function emitDictionary(
  name: string,
  decl: webidl.DictionaryType,
  ctx: MapperContext,
): string {
  const lines: string[] = [];
  lines.push(`/// ${name} - generated WebIDL dictionary.`);
  if (decl.inheritance) {
    lines.push(`/// inherits ${decl.inheritance}`);
  }

  lines.push(`type ${name} {`);

  const chain: webidl.DictionaryType[] = [];
  let cursor: webidl.DictionaryType | undefined = decl;
  while (cursor) {
    chain.push(cursor);
    const parentName = cursor.inheritance;
    if (!parentName) break;
    cursor = ctx.dictionaries.get(parentName);
  }
  chain.reverse();

  const seenFields = new Set<string>();
  for (const link of chain) {
    for (const member of link.members) {
      const fieldName = sovaIdent(member.name);
      if (seenFields.has(fieldName)) continue;
      seenFields.add(fieldName);
      const typ = translateType(member.idlType, ctx);
      let sovaType = typ.sovaType || "any";

      if (!member.default && needsOptionalLift(sovaType, ctx)) {
        sovaType = `option<${sovaType}>`;
      }

      const defaultPart = renderDictDefault(member, sovaType, ctx);
      lines.push(`    /// IDL field ${member.name}: ${describeIdlType(member.idlType)}`);
      lines.push(`    ${fieldName}: ${sovaType}${defaultPart}`);
    }
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}

// renderDictDefault returns `= <expr>` for a member with an IDL default, or "" when the field
// has no default. The renderer recognizes the small set of default shapes WebIDL allows:
// primitive literals, the empty sequence (`[]`), the empty dictionary (`{}`), and `null`. The
// types we degrade to `any` keep the default but emit it loosely; downstream Sova type
// checking on `any` is permissive enough to accept whichever shape we produce.
function renderDictDefault(
  member: webidl.DictionaryMemberType,
  sovaType: string,
  ctx: MapperContext,
): string {
  const def = member.default;
  if (!def) {
    return ` = ${zeroFor(sovaType, ctx)}`;
  }
  
  if (def.type === "string" && ctx.enums.has(sovaType)) {
    return ` = ${sovaType}.${mangleEnumCase(def.value)}`;
  }
  switch (def.type) {
    case "boolean":
      return ` = ${def.value ? "true" : "false"}`;
    case "number":
      return ` = ${def.value}`;
    case "string":
      return ` = ${JSON.stringify(def.value)}`;
    case "null":
      return ` = none`;
    case "sequence":
      return ` = [ ]`;
    case "dictionary":
      return ` = { }`;
    default:
      return ` = ${zeroFor(sovaType, ctx)}`;
  }
}

// zeroFor returns a Sova source-text zero value for the given declared type. The defaults
// match Sova's primitive zero conventions so a struct without an explicit init produces a
// usable instance.
// needsOptionalLift reports whether a field declared with the given Sova type would lack a
// usable zero unless we wrap it in `option<>`. Interfaces, enums, dictionaries, and callbacks
// have no nullary value the compiler can synthesize; primitives, slices, maps, and option
// types do. This keeps the dictionary emitter from producing `field: AbortSignal = none`
// which Sova would reject as a type mismatch.
function needsOptionalLift(sovaType: string, ctx: MapperContext): boolean {
  if (sovaType.startsWith("option<")) return false;
  if (sovaType.startsWith("[]") || sovaType.startsWith("map<")) return false;
  if (sovaType.startsWith("func(")) return false;
  if (sovaType === "string" || sovaType === "int" || sovaType === "float" || sovaType === "bool" || sovaType === "byte" || sovaType === "char" || sovaType === "any") return false;
  if (ctx.wrappable.has(sovaType)) return true;
  if (ctx.enums.has(sovaType)) return true;
  if (ctx.dictionaries.has(sovaType)) return true;
  return false;
}

function zeroFor(sovaType: string, ctx: MapperContext): string {
  if (sovaType === "string") return `""`;
  if (sovaType === "int" || sovaType === "float") return "0";
  if (sovaType === "bool") return "false";
  if (sovaType === "byte") return "0";
  if (sovaType.startsWith("option<")) return "none";
  if (sovaType.startsWith("[]")) return "[ ]";
  if (sovaType.startsWith("map<")) return "{ }";
  if (sovaType.startsWith("func(")) return "none";
  if (sovaType === "any") return "none";
  return "none";
}

// describeIdlType is a small helper for doc comments; renders the raw IDL leaf name where
// possible so the generated docs feel like the spec.
function describeIdlType(node: webidl.IDLTypeDescription): string {
  if (typeof node.idlType === "string") return node.idlType;
  if (node.generic) return `${node.generic}<...>`;
  if (node.union) return "union";
  return "any";
}

// emitStaticOperation produces a top-level factory function for an IDL `static T method(...)`.
// Naming convention: `<TypeName><MethodName>` (`URLCanParse`, `ResponseJson`,
// `AbortSignalTimeout`). The extern body invokes the JS-side `TypeName.method(...)` directly
// on the engine's constructor object - no `this.handle`, since static methods don't have a
// receiver instance.
function emitStaticOperation(
  ifaceName: string,
  op: webidl.OperationMemberType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): void {
  const opName = op.name!;
  const factoryName = ifaceName + capitalizeFirst(opName);
  const externName = `__bx_${ifaceName}_static_${sovaIdent(opName)}`;
  const retInfo = translateType(op.idlType, ctx);
  const isVoid = isVoidReturn(op.idlType) || retInfo.sovaType === "";

  const params: { name: string; sova: string; needsHandleWrap?: string }[] = [];
  let argIdx = 0;
  for (const arg of op.arguments) {
    const argMapping = translateType(arg.idlType, ctx);
    const sovaArgName = sovaIdent(arg.name || `arg${argIdx}`);
    params.push({
      name: sovaArgName,
      sova: argMapping.sovaType || "any",
      needsHandleWrap: argMapping.needsHandleWrap,
    });
    argIdx++;
  }

  const paramSig = params.map((p) => `${p.name}: ${p.sova}`).join(", ");
  const sovaCallArgs = params.map((p) => p.name).join(", ");

  lines.push(`/// ${ifaceName}.${opName} - WebIDL static method.`);
  if (isVoid) {
    lines.push(`func ${factoryName}(${paramSig}) {`);
    lines.push(`    ${externName}(${sovaCallArgs})`);
    lines.push(`}`);
  } else if (retInfo.needsHandleWrap) {
    lines.push(`func ${factoryName}(${paramSig}): ${retInfo.sovaType} {`);
    lines.push(`    return new ${retInfo.needsHandleWrap}(${externName}(${sovaCallArgs}))`);
    lines.push(`}`);
  } else {
    lines.push(`func ${factoryName}(${paramSig}): ${retInfo.sovaType} {`);
    lines.push(`    return ${externName}(${sovaCallArgs})`);
    lines.push(`}`);
  }

  const jsParams = params.map((p) => p.name);
  const jsArgs = params.map((p) => (p.needsHandleWrap ? `${p.name}.handle` : p.name)).join(", ");
  const externParams = params.map((p) => `${p.name}: ${p.sova}`).join(", ");
  const externRet = isVoid ? "" : `: ${retInfo.sovaType}`;
  const asyncKw = retInfo.isAsync ? "async " : "";
  if (isVoid) {
    externLines.push(`${asyncKw}func ${externName}(${externParams})${externRet} = {`);
    externLines.push(`    frontend: "(${jsParams.join(", ")}) => { ${ifaceName}.${opName}(${jsArgs}); }"`);
    externLines.push(`}`);
  } else {
    externLines.push(`${asyncKw}func ${externName}(${externParams})${externRet} = {`);
    externLines.push(`    frontend: "(${jsParams.join(", ")}) => ${ifaceName}.${opName}(${jsArgs})"`);
    externLines.push(`}`);
  }
}

function capitalizeFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// emitIndexedGetter synthesizes an `at(index: int): option<T>` method that maps to JS
// `obj[index]` access. Sova has no indexer-operator overload for user-defined types, so this
// is the ergonomic substitute (Java/Kotlin/Rust use the same `at` naming). The body returns
// `none` when the access produces undefined/null so out-of-bounds reads don't crash.
function emitIndexedGetter(
  ifaceName: string,
  op: webidl.OperationMemberType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): void {
  const ret = translateType(op.idlType, ctx);
  const retTy = ret.sovaType || "any";
  const sovaRet = retTy.startsWith("option<") ? retTy : `option<${retTy}${retTy.endsWith(">") ? " " : ""}>`;
  const externName = `__bx_${ifaceName}_at`;
  lines.push(``);
  lines.push(`    /// IDL indexed getter - returns the element at \`index\` or none when out of bounds.`);
  if (ret.needsHandleWrap) {
    lines.push(`    func at(index: int): ${sovaRet} {`);
    lines.push(`        let v = ${externName}(this.handle, index)`);
    lines.push(`        if v == none {`);
    lines.push(`            return none`);
    lines.push(`        }`);
    lines.push(`        return new ${ret.needsHandleWrap}(v)`);
    lines.push(`    }`);
  } else {
    lines.push(`    func at(index: int): ${sovaRet} {`);
    lines.push(`        return ${externName}(this.handle, index)`);
    lines.push(`    }`);
  }
  externLines.push(`func ${externName}(h: any, index: int): any = {`);
  externLines.push(`    frontend: "(h, i) => (h == null ? undefined : h[i])"`);
  externLines.push(`}`);
}

// emitNamedGetter synthesizes a `get(key: string): option<T>` method for IDL `getter` ops
// keyed on a string (DataTransfer.getData, FormData.get). Same `none`-on-miss pattern as
// the indexed variant.
function emitNamedGetter(
  ifaceName: string,
  op: webidl.OperationMemberType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): void {
  const ret = translateType(op.idlType, ctx);
  const retTy = ret.sovaType || "any";
  const sovaRet = retTy.startsWith("option<") ? retTy : `option<${retTy}${retTy.endsWith(">") ? " " : ""}>`;
  const externName = `__bx_${ifaceName}_namedGet`;
  lines.push(``);
  lines.push(`    /// IDL named getter - returns the value associated with \`key\` or none.`);
  if (ret.needsHandleWrap) {
    lines.push(`    func get(key: string): ${sovaRet} {`);
    lines.push(`        let v = ${externName}(this.handle, key)`);
    lines.push(`        if v == none {`);
    lines.push(`            return none`);
    lines.push(`        }`);
    lines.push(`        return new ${ret.needsHandleWrap}(v)`);
    lines.push(`    }`);
  } else {
    lines.push(`    func get(key: string): ${sovaRet} {`);
    lines.push(`        return ${externName}(this.handle, key)`);
    lines.push(`    }`);
  }
  externLines.push(`func ${externName}(h: any, key: string): any = {`);
  externLines.push(`    frontend: "(h, k) => (h == null ? undefined : h[k])"`);
  externLines.push(`}`);
}

// emitIndexedSetter synthesizes `setAt(index: int, value: T)` for IDL indexed `setter` ops.
function emitIndexedSetter(
  ifaceName: string,
  op: webidl.OperationMemberType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): void {
  const valueArg = op.arguments[1];
  if (!valueArg) return;
  const valTy = translateType(valueArg.idlType, ctx);
  const sovaVal = valTy.sovaType || "any";
  const externName = `__bx_${ifaceName}_setAt`;
  lines.push(``);
  lines.push(`    /// IDL indexed setter - assigns \`value\` at \`index\`.`);
  lines.push(`    func setAt(index: int, value: ${sovaVal}) {`);
  lines.push(`        ${externName}(this.handle, index, value)`);
  lines.push(`    }`);
  externLines.push(`func ${externName}(h: any, index: int, value: ${sovaVal}) = {`);
  externLines.push(`    frontend: "(h, i, v) => { if (h != null) h[i] = v; }"`);
  externLines.push(`}`);
}

// emitNamedSetter synthesizes `set(key: string, value: T)` for IDL named `setter` ops.
function emitNamedSetter(
  ifaceName: string,
  op: webidl.OperationMemberType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): void {
  const valueArg = op.arguments[1];
  if (!valueArg) return;
  const valTy = translateType(valueArg.idlType, ctx);
  const sovaVal = valTy.sovaType || "any";
  const externName = `__bx_${ifaceName}_namedSet`;
  lines.push(``);
  lines.push(`    /// IDL named setter - assigns \`value\` at \`key\`.`);
  lines.push(`    func set(key: string, value: ${sovaVal}) {`);
  lines.push(`        ${externName}(this.handle, key, value)`);
  lines.push(`    }`);
  externLines.push(`func ${externName}(h: any, key: string, value: ${sovaVal}) = {`);
  externLines.push(`    frontend: "(h, k, v) => { if (h != null) h[k] = v; }"`);
  externLines.push(`}`);
}

// emitIterable synthesizes the Sova iteration protocol (a `next(): option<T>` method that
// returns elements until exhausted, then resets the cursor) so `for x in nodeList { ... }`
// works. Two shapes are handled:
//
//   - Value iterable (`iterable<T>`): NodeList, HTMLCollection, DOMTokenList.
//     `next(): option<T>` reads `handle[i]`.
//   - Pair iterable (`iterable<K, V>`): FormData, Headers, URLSearchParams. `next()` returns
//     `option<(K, V)>` so the user can destructure with `for k, v in formData { ... }`. The
//     JS extern snapshots the iterator into an array on first call and indexes into it.
function emitIterable(
  ifaceName: string,
  iter: webidl.IterableType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): void {
  if (!iter.idlType || iter.idlType.length === 0) return;
  const isPair = iter.idlType.length === 2;
  const externName = `__bx_${ifaceName}_iterAt`;
  const snapshotName = `__bx_${ifaceName}_iterSnapshot`;

  if (!isPair) {
    const valNode = iter.idlType[0]!;
    const ret = translateType(valNode, ctx);
    const retTy = ret.sovaType || "any";
    const sovaRet = retTy.startsWith("option<") ? retTy : `option<${retTy}${retTy.endsWith(">") ? " " : ""}>`;

    lines.push(``);
    lines.push(`    /// Iteration protocol - yields the next element, auto-reset on end-of-stream.`);
    if (ret.needsHandleWrap) {
      lines.push(`    func next(): ${sovaRet} {`);
      lines.push(`        let v = ${externName}(this.handle, this._iterCursor)`);
      lines.push(`        if v == none {`);
      lines.push(`            this._iterCursor = 0`);
      lines.push(`            return none`);
      lines.push(`        }`);
      lines.push(`        this._iterCursor = this._iterCursor + 1`);
      lines.push(`        return new ${ret.needsHandleWrap}(v)`);
      lines.push(`    }`);
    } else {
      lines.push(`    func next(): ${sovaRet} {`);
      lines.push(`        let v = ${externName}(this.handle, this._iterCursor)`);
      lines.push(`        if v == none {`);
      lines.push(`            this._iterCursor = 0`);
      lines.push(`            return none`);
      lines.push(`        }`);
      lines.push(`        this._iterCursor = this._iterCursor + 1`);
      lines.push(`        return v`);
      lines.push(`    }`);
    }
    externLines.push(`func ${externName}(h: any, i: int): any = {`);
    externLines.push(`    frontend: "(h, i) => (h == null ? undefined : (i < (h.length ?? 0) ? h[i] : undefined))"`);
    externLines.push(`}`);
    return;
  }

  // Pair iterable. The Sova-side `next()` returns a tuple `(K, V)`; on the JS side we lazily
  // snapshot the iterator entries into an array stashed on the handle (via WeakMap) so
  // subsequent `next()` calls index into it.
  const keyT = translateType(iter.idlType[0]!, ctx);
  const valT = translateType(iter.idlType[1]!, ctx);
  const keyTy = keyT.sovaType || "any";
  const valTy = valT.sovaType || "any";
  const pairTy = `(${keyTy}, ${valTy})`;
  const sovaRet = `option<${pairTy}${pairTy.endsWith(">") ? " " : ""}>`;

  lines.push(``);
  lines.push(`    /// Pair-iteration protocol - yields the next (key, value) entry, auto-reset on end-of-stream.`);
  lines.push(`    func next(): ${sovaRet} {`);
  lines.push(`        let entry = ${externName}(this.handle, this._iterCursor)`);
  lines.push(`        if entry == none {`);
  lines.push(`            this._iterCursor = 0`);
  lines.push(`            return none`);
  lines.push(`        }`);
  lines.push(`        this._iterCursor = this._iterCursor + 1`);
  lines.push(`        let k = (entry as map<int, any>)[0] as ${keyTy}`);
  lines.push(`        let v = (entry as map<int, any>)[1] as ${valTy}`);
  lines.push(`        return (k, v)`);
  lines.push(`    }`);
  
  void snapshotName;
  externLines.push(`func ${externName}(h: any, i: int): any = {`);
  externLines.push(`    frontend: "(h, i) => { if (h == null) return undefined; if (i === 0 || h.__bxIterCache == null) { try { h.__bxIterCache = Array.from(h.entries ? h.entries() : []); } catch (e) { h.__bxIterCache = []; } } const arr = h.__bxIterCache; if (arr == null || i >= arr.length) return undefined; return arr[i]; }"`);
  externLines.push(`}`);
}

function emitMaplike(
  ifaceName: string,
  m: webidl.MaplikeType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): void {
  const keyT = translateType(m.idlType[0]!, ctx);
  const valT = translateType(m.idlType[1]!, ctx);
  const keyTy = keyT.sovaType || "any";
  const valTy = valT.sovaType || "any";
  const valWrap = valT.needsHandleWrap;
  const ext = (op: string) => `__bx_${ifaceName}_maplike_${op}`;

  lines.push(``);
  lines.push(`    func size(): int { return ${ext("size")}(this.handle) }`);
  lines.push(`    func has(key: ${keyTy}): bool { return ${ext("has")}(this.handle, key) }`);
  if (valWrap) {
    lines.push(`    func get(key: ${keyTy}): option<${valTy}> {`);
    lines.push(`        let v = ${ext("get")}(this.handle, key)`);
    lines.push(`        if v == none { return none }`);
    lines.push(`        return new ${valWrap}(v)`);
    lines.push(`    }`);
  } else {
    lines.push(`    func get(key: ${keyTy}): option<${valTy}${valTy.endsWith(">") ? " " : ""}> { return ${ext("get")}(this.handle, key) }`);
  }
  if (!m.readonly) {
    lines.push(`    func set(key: ${keyTy}, value: ${valTy}) { ${ext("set")}(this.handle, key, ${valWrap ? "value.handle" : "value"}) }`);
    lines.push(`    func deleteKey(key: ${keyTy}): bool { return ${ext("delete")}(this.handle, key) }`);
    lines.push(`    func clear() { ${ext("clear")}(this.handle) }`);
  }

  externLines.push(`func ${ext("size")}(h: any): int = { frontend: "(h) => (h == null ? 0 : h.size)" }`);
  externLines.push(`func ${ext("has")}(h: any, k: ${keyTy}): bool = { frontend: "(h, k) => (h == null ? false : h.has(k))" }`);
  externLines.push(`func ${ext("get")}(h: any, k: ${keyTy}): any = { frontend: "(h, k) => (h == null ? undefined : h.get(k))" }`);
  if (!m.readonly) {
    externLines.push(`func ${ext("set")}(h: any, k: ${keyTy}, v: any) = { frontend: "(h, k, v) => { if (h != null) h.set(k, v); }" }`);
    externLines.push(`func ${ext("delete")}(h: any, k: ${keyTy}): bool = { frontend: "(h, k) => (h == null ? false : h.delete(k))" }`);
    externLines.push(`func ${ext("clear")}(h: any) = { frontend: "(h) => { if (h != null) h.clear(); }" }`);
  }
}

function emitSetlike(
  ifaceName: string,
  s: webidl.SetlikeType,
  lines: string[],
  externLines: string[],
  ctx: MapperContext,
): void {
  const elemT = translateType(s.idlType[0]!, ctx);
  const elemTy = elemT.sovaType || "any";
  const ext = (op: string) => `__bx_${ifaceName}_setlike_${op}`;

  lines.push(``);
  lines.push(`    func size(): int { return ${ext("size")}(this.handle) }`);
  lines.push(`    func has(value: ${elemTy}): bool { return ${ext("has")}(this.handle, ${elemT.needsHandleWrap ? "value.handle" : "value"}) }`);
  if (!s.readonly) {
    lines.push(`    func add(value: ${elemTy}) { ${ext("add")}(this.handle, ${elemT.needsHandleWrap ? "value.handle" : "value"}) }`);
    lines.push(`    func deleteValue(value: ${elemTy}): bool { return ${ext("delete")}(this.handle, ${elemT.needsHandleWrap ? "value.handle" : "value"}) }`);
    lines.push(`    func clear() { ${ext("clear")}(this.handle) }`);
  }

  externLines.push(`func ${ext("size")}(h: any): int = { frontend: "(h) => (h == null ? 0 : h.size)" }`);
  externLines.push(`func ${ext("has")}(h: any, v: any): bool = { frontend: "(h, v) => (h == null ? false : h.has(v))" }`);
  if (!s.readonly) {
    externLines.push(`func ${ext("add")}(h: any, v: any) = { frontend: "(h, v) => { if (h != null) h.add(v); }" }`);
    externLines.push(`func ${ext("delete")}(h: any, v: any): bool = { frontend: "(h, v) => (h == null ? false : h.delete(v))" }`);
    externLines.push(`func ${ext("clear")}(h: any) = { frontend: "(h) => { if (h != null) h.clear(); }" }`);
  }
}
