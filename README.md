# browserx-generator

The Sova-source emitter behind [`browserx`](../browserx/). Reads W3C WebIDL
from [`@webref/idl`](https://github.com/w3c/webref), translates each interface
into a typed Sova wrapper, and writes the result to the sibling `browserx`
package.

This tool runs at *develop time*. Consumers of `browserx` don't run it - they
import the committed Sova source. You run it when you want to refresh against
a newer `@webref/idl` snapshot, or when you change the curated subset.

## Quick start

```bash
bun install              # one-time
bun run generate:browserx
```

Default target is `../browserx/src`. Override with `--out <path>`. Pass
`--keep` to skip the wipe of the existing `generated/` directory (useful when
you're staging a partial edit).

## What gets emitted

For each in-subset IDL interface:

- A Sova `type` declaration wrapping an opaque `handle: any`
- Typed getter + setter methods for every attribute (event-handler attributes
  use the precise `Event` subclass from a hard-coded table)
- Typed methods for every operation, including a `Promise<T>` → `async`
  detection that flows through Sova's auto-async propagation
- An `at(index)` and / or `get(key)` method synthesized from IDL indexed /
  named getters
- A `next(): option<T>` method synthesized from IDL `iterable<T>`; pair
  iterables produce `next(): option<(K, V)>`
- `size()`/`has(k)`/`get(k)`/`set(k, v)`/`deleteKey(k)`/`clear()` for IDL
  `maplike<K, V>`; `size()`/`has(v)`/`add(v)`/`deleteValue(v)`/`clear()`
  for IDL `setlike<T>`. Readonly variants drop the mutators.
- Top-level `new<TypeName>(args)` factory functions for IDL `constructor()`
  declarations (Sova ctor overload resolution can't disambiguate from the
  internal `new(handle: any)` wrap ctor, so factories live as siblings)
- Top-level `<TypeName><MethodName>(args)` factory functions for IDL
  `static` operations (`URLCanParse`, `ResponseJson`, ...)
- Top-level `<TypeName>_<ConstName>` constants for IDL `const` declarations
  (`Node_ELEMENT_NODE`, ...)
- Per-extern JS body in each method - no runtime dispatch table, the call
  splats directly into the underlying JS handle

Plus, beyond interfaces:

- IDL `enum` → Sova payload enum (`enum ScrollLogicalPosition(value: string) {
  Start("start"), ... }`) plus a `<EnumName>FromString(s)` helper for
  JS → Sova conversion
- IDL `dictionary` → Sova struct with field defaults
- IDL callback typedefs → typed `func(...)` signatures

A separate hand-written facade lives in [`src/facade.ts`](src/facade.ts) and
is emitted alongside the generated tree as `*.sova` files. The facade covers
the Strix-style ergonomic surface (query, events, mutation, observers,
storage, cookies, http, clipboard, routing, geolocation, channels, media,
narrow).

## Architecture

```
src/
  main.ts        Entry point. Parses CLI args, drives load → emit pipeline.
  subset.ts     Curated list of WebIDL interfaces to emit. Adding 5
                interfaces is fine; bulk-importing whole specs is a smell.
  loader.ts     Reads every spec @webref ships, parses each via webidl2,
                merges partial interfaces + partial mixins, builds the
                catalog (interfaces, typedefs, callbacks, enums, dicts).
                Includes the transitive subset closure (inheritance +
                mixin includes).
  types.ts      WebIDL type → Sova type translation. Knows about primitives,
                unions (degrade to `any`), sequences/records (→ slices /
                maps), Promise<T> (→ T with `isAsync` flag), callbacks
                (→ typed func), typedef chains, enum / dictionary refs.
  emit.ts       Walks the catalog, produces per-interface Sova source.
                Owns the strix-aligned file grouping (core.sova, html.sova,
                events.sova, ...) and the synthesis of indexer / iteration /
                constructor / static / constant declarations.
  facade.ts     Hand-written ergonomic layer. Each `FACADE_*` constant is a
                full Sova source file emitted verbatim.
```

### Pipeline order

1. **load** - parse every spec, merge partials, resolve inheritance + mixin
   closure for the subset.
2. **emit** - walk each in-subset interface, generate type body, queue
   constants / constructors / statics / extern bodies.
3. **facade** - emit each `FACADE_*` source verbatim into the output tree.
4. **write** - flush everything to disk under `generated/` for the
   auto-generated files and the package root for the facade.

## Adjusting the subset

Edit [`src/subset.ts`](src/subset.ts). The categories are organizational; what
matters is that every name ends up in `allSubsetNames()`. The loader walks
inheritance (`Element` pulls in `Node`, `EventTarget`) and `includes` mixins
automatically, so adding a leaf type usually doesn't require listing its
parents.

Per the strix-style philosophy, the subset should stay focused on what
frontend code actually touches. The whole IDL surface is ~35k lines after
generation; we're shipping ~16k by being deliberate about scope.

## Why a separate generator

The browserx package ships pure Sova source - no `bun`, `node`, or
`@webref/idl` dependency on consumer machines. Keeping the generator in its
own repo (with its own `package.json` and `bun.lock`) means:

- Consumer projects don't accidentally pull WebIDL parsing into their
  dependency tree
- The generated `browserx/` output is reviewable as source - diffs from a
  regeneration are easy to inspect
- The generator can iterate independently of browserx's release cadence
- Bundle tooling sees `browserx/src/*.sova` as plain Sova, not a build artifact

## Updating WebIDL data

```bash
bun update @webref/idl
bun run generate:browserx
git diff ../browserx/
```

Inspect the diff before committing - sometimes a new spec version trips a
mapping the generator hasn't seen before, and you want to catch the spurious
diagnostics before pushing.

## Known gaps

- **No watch mode.** Re-run `bun run generate:browserx` manually after
  editing `subset.ts` or any `src/*.ts` file.
- **No CI check.** If `@webref/idl` ships an IDL that breaks our translator
  (new generic kind, new special-op shape), the only feedback is the
  generator throwing. Add a smoke that builds the smallest valid browserx
  consumer if that becomes a problem.
- **Subset hand-curated.** No automatic "import all interfaces transitively
  reachable from this seed" flow - you list each name explicitly. This is on
  purpose; bulk imports would tank the bundle.
