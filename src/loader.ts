import { listAll } from "@webref/idl";
import type * as webidl from "webidl2";
import { allSubsetNames } from "./subset";

export type LoadedSpec = {
  spec: string; // spec slug from @webref (e.g. "dom", "html")
  ast: webidl.IDLRootType[];
};

export type CollectedInterface = {
  spec: string;
  iface: webidl.InterfaceType;
  mixins: webidl.InterfaceMixinType[];
};

export type Catalog = {
  specs: LoadedSpec[];
  interfaces: Map<string, CollectedInterface>;
  typedefs: Map<string, webidl.TypedefType>;
  callbacks: Map<string, webidl.CallbackType>;
  enums: Map<string, webidl.EnumType>;
  dictionaries: Map<string, webidl.DictionaryType>;
};

export async function loadCatalog(): Promise<Catalog> {
  const files = await listAll();
  const specs: LoadedSpec[] = [];
  for (const [spec, file] of Object.entries(files)) {
    try {
      const ast = await file.parse();
      specs.push({ spec, ast });
    } catch {
      // Malformed/missing specs are skipped silently. The next phase doesn't depend on a fully
      // loaded catalog; partial coverage just means some interfaces degrade to `any`.
    }
  }

  const interfaceByName = new Map<string, { spec: string; iface: webidl.InterfaceType }>();
  const mixinByName = new Map<string, webidl.InterfaceMixinType>();
  const includesEdges = new Map<string, string[]>();
  const typedefs = new Map<string, webidl.TypedefType>();
  const callbacks = new Map<string, webidl.CallbackType>();
  const enums = new Map<string, webidl.EnumType>();
  const dictionaries = new Map<string, webidl.DictionaryType>();

  for (const { spec, ast } of specs) {
    for (const node of ast) {
      switch (node.type) {
        case "interface":
          if (node.partial) {
            const existing = interfaceByName.get(node.name);
            if (existing) {
              existing.iface = mergePartial(existing.iface, node);
            }
          } else if (!interfaceByName.has(node.name)) {
            interfaceByName.set(node.name, { spec, iface: node });
          }
          break;
        case "interface mixin":
          if (node.partial) {
            const existing = mixinByName.get(node.name);
            if (existing) {
              mixinByName.set(node.name, mergeMixinPartial(existing, node));
            }
          } else if (!mixinByName.has(node.name)) {
            mixinByName.set(node.name, node);
          }
          break;
        case "includes": {
          const arr = includesEdges.get(node.target) ?? [];
          arr.push(node.includes);
          includesEdges.set(node.target, arr);
          break;
        }
        case "typedef":
          typedefs.set(node.name, node);
          break;
        case "callback":
          callbacks.set(node.name, node);
          break;
        case "enum":
          enums.set(node.name, node);
          break;
        case "dictionary":
          dictionaries.set(node.name, node);
          break;
      }
    }
  }

  for (const { ast } of specs) {
    for (const node of ast) {
      if (node.type === "interface" && node.partial) {
        const existing = interfaceByName.get(node.name);
        if (existing) {
          existing.iface = mergePartial(existing.iface, node);
        }
      } else if (node.type === "interface mixin" && node.partial) {
        const existing = mixinByName.get(node.name);
        if (existing) {
          mixinByName.set(node.name, mergeMixinPartial(existing, node));
        }
      }
    }
  }

  const targets = allSubsetNames();
  const closure = new Set<string>(targets);
  const queue = [...targets];
  while (queue.length > 0) {
    const name = queue.shift()!;
    const entry = interfaceByName.get(name);
    if (!entry) continue;
    const parent = entry.iface.inheritance;
    if (parent && !closure.has(parent)) {
      closure.add(parent);
      queue.push(parent);
    }
    for (const mixin of includesEdges.get(name) ?? []) {
      if (!closure.has(mixin)) {
        closure.add(mixin);
      }
    }
  }

  const interfaces = new Map<string, CollectedInterface>();
  for (const name of closure) {
    const entry = interfaceByName.get(name);
    if (!entry) continue;
    const mixinList: webidl.InterfaceMixinType[] = [];
    for (const mixinName of includesEdges.get(name) ?? []) {
      const m = mixinByName.get(mixinName);
      if (m) mixinList.push(m);
    }
    interfaces.set(name, { spec: entry.spec, iface: entry.iface, mixins: mixinList });
  }

  return { specs, interfaces, typedefs, callbacks, enums, dictionaries };
}

function mergePartial(base: webidl.InterfaceType, partial: webidl.InterfaceType): webidl.InterfaceType {
  return {
    type: base.type,
    name: base.name,
    inheritance: base.inheritance,
    partial: base.partial,
    members: [...base.members, ...partial.members],
    extAttrs: [...base.extAttrs, ...partial.extAttrs],
  } as webidl.InterfaceType;
}

function mergeMixinPartial(
  base: webidl.InterfaceMixinType,
  partial: webidl.InterfaceMixinType,
): webidl.InterfaceMixinType {
  return {
    type: base.type,
    name: base.name,
    partial: base.partial,
    members: [...base.members, ...partial.members],
    extAttrs: [...base.extAttrs, ...partial.extAttrs],
  } as webidl.InterfaceMixinType;
}
