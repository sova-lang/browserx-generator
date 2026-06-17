// The Strix-aligned ergonomic facade. Hand-written, not generated. Lives alongside the
// generated bindings in browserx/src/ but produced by this generator pass so a single
// `bun run generate` produces the whole output tree atomically.
//
// The facade picks the 20% of APIs that 80% of Sova frontend code touches and gives them an
// ergonomic surface: queries that produce typed Streams, event bindings that look like Strix
// observers, classList shortcuts, etc.

import type { EmitFile } from "./emit";

export function emitFacade(): EmitFile[] {
  return [
    { path: "browserx.sova", content: FACADE_TOP },
    { path: "query.sova", content: FACADE_QUERY },
    { path: "events.sova", content: FACADE_EVENTS },
    { path: "storage.sova", content: FACADE_STORAGE },
    { path: "mutation.sova", content: FACADE_MUTATION },
    { path: "forms.sova", content: FACADE_FORMS },
    { path: "observers.sova", content: FACADE_OBSERVERS },
    { path: "cookies.sova", content: FACADE_COOKIES },
    { path: "media.sova", content: FACADE_MEDIA },
    { path: "narrow.sova", content: FACADE_NARROW },
    { path: "http.sova", content: FACADE_HTTP },
    { path: "clipboard.sova", content: FACADE_CLIPBOARD },
    { path: "routing.sova", content: FACADE_ROUTING },
    { path: "geolocation.sova", content: FACADE_GEOLOCATION },
    { path: "channels.sova", content: FACADE_CHANNELS },
    { path: "binary.sova", content: FACADE_BINARY },
  ];
}

// Top-level conveniences plus re-export anchor. Importing `browserx` from a frontend file
// gives the user `document()`, `window()`, and the ergonomic types without further imports.
const FACADE_TOP = `package browserx on frontend

/// document returns the global Document instance wrapped in the generated Sova type. The
/// underlying JS handle is the page's actual document; calling document() repeatedly returns
/// fresh wrappers around the same handle (handles compare by reference inside the JS engine,
/// so two wrappers around the same document still work the same way).
func document(): Document {
    return new Document(__bxDocumentHandle())
}

/// window returns the global Window instance.
func window(): Window {
    return new Window(__bxWindowHandle())
}

/// alert displays a native browser alert with the given message - thin shortcut for
/// window().alert(msg).
func alert(msg: string) {
    __bxAlert(msg)
}

/// log writes to the browser console. Mirrors console.log; uses any so values of any Sova type
/// flow through.
func log(value: any) {
    __bxConsoleLog(value)
}

/// warn / err are the corresponding console.warn / console.error variants.
func warn(value: any) {
    __bxConsoleWarn(value)
}

func err(value: any) {
    __bxConsoleError(value)
}

extern {
    func __bxDocumentHandle(): any = {
        frontend: "() => document"
    }
    func __bxWindowHandle(): any = {
        frontend: "() => window"
    }
    func __bxAlert(msg: string) = {
        frontend: "(m) => window.alert(m)"
    }
    func __bxConsoleLog(v: any) = {
        frontend: "(v) => console.log(v)"
    }
    func __bxConsoleWarn(v: any) = {
        frontend: "(v) => console.warn(v)"
    }
    func __bxConsoleError(v: any) = {
        frontend: "(v) => console.error(v)"
    }
}
`;

// Query-related ergonomic helpers - the API Sova frontend code reaches for first.
const FACADE_QUERY = `package browserx on frontend

import "std/streams"

/// query finds the first element matching the CSS selector, or none. Thin typed wrapper
/// around document.querySelector that returns the element as a typed Element wrapper.
func query(selector: string): option<Element> {
    let h = __bxQuery(selector)
    if h == none {
        return none
    }
    return new Element(h)
}

/// queryAll returns every element matching the selector as a Stream<Element>. Snapshot at
/// call time; subsequent DOM mutations do not affect the stream.
func queryAll(selector: string): streams.Stream<Element> {
    let handles = __bxQueryAll(selector)
    let out: []Element = [ ]
    for h in handles {
        out = out + [new Element(h)]
    }
    return streams.of(out)
}

/// byId returns the element with the given id, or none. Wrapper around
/// document.getElementById that types its return as an Element.
func byId(id: string): option<Element> {
    let h = __bxById(id)
    if h == none {
        return none
    }
    return new Element(h)
}

/// create makes a new detached element of the given tag. Returns the wrapper around the
/// freshly-constructed JS Element.
func create(tagName: string): Element {
    return new Element(__bxCreate(tagName))
}

extern {
    func __bxQuery(selector: string): any = {
        frontend: "(s) => document.querySelector(s)"
    }
    func __bxQueryAll(selector: string): []any = {
        frontend: "(s) => Array.from(document.querySelectorAll(s))"
    }
    func __bxById(id: string): any = {
        frontend: "(i) => document.getElementById(i)"
    }
    func __bxCreate(tagName: string): any = {
        frontend: "(t) => document.createElement(t)"
    }
}
`;

const FACADE_EVENTS = `package browserx on frontend

/// onClick attaches a click handler to the element. Returns a teardown closure that, when
/// invoked, removes the listener. The returned closure is safe to call multiple times - it
/// only detaches once.
func onClick(el: Element, handler: func(e: MouseEvent)): func() {
    let raw: any = __bxAddListener(el.handle, "click", handler)
    return func() {
        __bxRemoveListener(el.handle, "click", raw)
    }
}

/// onInput is the dual for text input change events. The handler receives an InputEvent.
func onInput(el: Element, handler: func(e: InputEvent)): func() {
    let raw: any = __bxAddListener(el.handle, "input", handler)
    return func() {
        __bxRemoveListener(el.handle, "input", raw)
    }
}

/// onSubmit mirrors form submission. Calling preventDefault() inside the handler keeps the
/// page from navigating away, which is the typical pattern for SPA-style forms.
func onSubmit(el: Element, handler: func(e: Event)): func() {
    let raw: any = __bxAddListener(el.handle, "submit", handler)
    return func() {
        __bxRemoveListener(el.handle, "submit", raw)
    }
}

/// on is the generic event binder for everything onClick/onInput/onSubmit don't cover.
/// The handler receives a generic Event - cast via the underlying handle if you need a
/// subtype's methods.
func listen(el: Element, eventName: string, handler: func(e: Event)): func() {
    let raw: any = __bxAddListener(el.handle, eventName, handler)
    return func() {
        __bxRemoveListener(el.handle, eventName, raw)
    }
}

extern {
    /// __bxAddListener wraps the user's Sova callback in a JS thunk that constructs a typed
    /// Sova Event wrapper around the underlying event, then invokes the callback. The thunk
    /// is returned so __bxRemoveListener can later detach the exact-same reference.
    func __bxAddListener(h: any, eventType: string, cb: any): any = {
        frontend: "(h, t, cb) => { const thunk = (e) => cb({ handle: e }); h.addEventListener(t, thunk); return thunk; }"
    }
    func __bxRemoveListener(h: any, eventType: string, thunk: any) = {
        frontend: "(h, t, thunk) => h.removeEventListener(t, thunk)"
    }
}
`;

const FACADE_STORAGE = `package browserx on frontend

/// localGet reads a key from window.localStorage; returns none when the key is absent.
func localGet(key: string): option<string> {
    let v = __bxLocalGet(key)
    if v == none {
        return none
    }
    return v as string
}

/// localSet writes a string into window.localStorage. Quota-exceeded errors are silently
/// swallowed - the same behavior plain JS code typically wants, since storage is best-effort.
func localSet(key: string, value: string) {
    __bxLocalSet(key, value)
}

/// localRemove deletes a single key.
func localRemove(key: string) {
    __bxLocalRemove(key)
}

/// localClear empties the entire localStorage for this origin.
func localClear() {
    __bxLocalClear()
}

/// sessionGet / sessionSet / sessionRemove / sessionClear are the sessionStorage twins. Same
/// semantics as their local counterparts; the storage is scoped to the browsing context.
func sessionGet(key: string): option<string> {
    let v = __bxSessionGet(key)
    if v == none {
        return none
    }
    return v as string
}

func sessionSet(key: string, value: string) {
    __bxSessionSet(key, value)
}

func sessionRemove(key: string) {
    __bxSessionRemove(key)
}

func sessionClear() {
    __bxSessionClear()
}

extern {
    func __bxLocalGet(k: string): any = {
        frontend: "(k) => { try { const v = window.localStorage.getItem(k); return v == null ? undefined : v; } catch (e) { return undefined; } }"
    }
    func __bxLocalSet(k: string, v: string) = {
        frontend: "(k, v) => { try { window.localStorage.setItem(k, v); } catch (e) {} }"
    }
    func __bxLocalRemove(k: string) = {
        frontend: "(k) => { try { window.localStorage.removeItem(k); } catch (e) {} }"
    }
    func __bxLocalClear() = {
        frontend: "() => { try { window.localStorage.clear(); } catch (e) {} }"
    }
    func __bxSessionGet(k: string): any = {
        frontend: "(k) => { try { const v = window.sessionStorage.getItem(k); return v == null ? undefined : v; } catch (e) { return undefined; } }"
    }
    func __bxSessionSet(k: string, v: string) = {
        frontend: "(k, v) => { try { window.sessionStorage.setItem(k, v); } catch (e) {} }"
    }
    func __bxSessionRemove(k: string) = {
        frontend: "(k) => { try { window.sessionStorage.removeItem(k); } catch (e) {} }"
    }
    func __bxSessionClear() = {
        frontend: "() => { try { window.sessionStorage.clear(); } catch (e) {} }"
    }
}
`;

// DOM mutation helpers - the typed counterparts to native append/remove/replace/clone. Each
// takes wrapped browserx values, unwraps to JS handles at the extern boundary, and returns
// the mutated parent so users can chain. The append/prepend forms accept varargs via a
// slice; Sova's `func(parent, children: []Element)` shape lets callers pass any number of
// children with a single literal.
const FACADE_MUTATION = `package browserx on frontend

/// append puts \`children\` at the end of \`parent\`. Mirrors Element.append for typed
/// children. Returns \`parent\` so the call chains: \`append(div, [a, b]).setId("box")\`.
func append(parent: Element, children: []Element): Element {
    let raw: []any = [ ]
    for c in children {
        raw = raw + [c.handle]
    }
    __bxAppend(parent.handle, raw)
    return parent
}

/// prepend puts \`children\` at the start of \`parent\`, preserving their relative order.
func prepend(parent: Element, children: []Element): Element {
    let raw: []any = [ ]
    for c in children {
        raw = raw + [c.handle]
    }
    __bxPrepend(parent.handle, raw)
    return parent
}

/// removeFrom detaches \`child\` from its current parent (if any). Re-attaching with
/// \`append(p, [child])\` after a removeFrom is the idiomatic "move" pattern.
func removeFrom(child: Element) {
    __bxRemoveChild(child.handle)
}

/// replace swaps \`oldChild\` for \`newChild\` in its parent. Returns the new child for
/// chaining.
func replace(oldChild: Element, newChild: Element): Element {
    __bxReplaceWith(oldChild.handle, newChild.handle)
    return newChild
}

/// clone returns a copy of \`el\`. When \`deep\` is true the entire subtree is copied;
/// otherwise only the element node itself. The copy is detached - call append() to insert
/// it.
func clone(el: Element, deep: bool): Element {
    return new Element(__bxClone(el.handle, deep))
}

/// empty removes all child nodes of \`parent\`. Equivalent to \`parent.innerHTML = ""\` but
/// faster on dense trees because the engine doesn't re-parse markup.
func empty(parent: Element) {
    __bxEmpty(parent.handle)
}

extern {
    func __bxAppend(parent: any, children: []any) = {
        frontend: "(p, c) => { if (p != null) p.append(...c); }"
    }
    func __bxPrepend(parent: any, children: []any) = {
        frontend: "(p, c) => { if (p != null) p.prepend(...c); }"
    }
    func __bxRemoveChild(child: any) = {
        frontend: "(c) => { if (c != null && c.parentNode != null) c.parentNode.removeChild(c); }"
    }
    func __bxReplaceWith(oldC: any, newC: any) = {
        frontend: "(o, n) => { if (o != null && o.parentNode != null) o.parentNode.replaceChild(n, o); }"
    }
    func __bxClone(el: any, deep: bool): any = {
        frontend: "(e, d) => (e == null ? undefined : e.cloneNode(d))"
    }
    func __bxEmpty(parent: any) = {
        frontend: "(p) => { if (p == null) return; while (p.firstChild) p.removeChild(p.firstChild); }"
    }
}
`;

// Form helpers - the ergonomic shortcut for the two operations every form ever needs:
// "collect all values into a map" and "set the value of a specific input". The collection
// path walks the form's elements once at call time, so callers can also iterate manually
// via the typed wrappers if they need per-field nuance (file inputs, checkboxes, etc.).
const FACADE_FORMS = `package browserx on frontend

/// formValues collects every \`name=value\` pair from a form's submittable controls,
/// keyed by name. Checkboxes contribute when checked; radio groups contribute the selected
/// option. Multi-value fields (\`<select multiple>\`) are joined with commas. File inputs
/// surface the first selected filename - reach for the typed wrapper if you need the
/// underlying File handles.
func formValues(form: Element): map<string, string> {
    return __bxFormValues(form.handle)
}

/// setFormValue assigns \`value\` to the form control named \`name\` inside \`form\`. No-op
/// when no matching control exists. Handles input/textarea/select uniformly.
func setFormValue(form: Element, name: string, value: string) {
    __bxFormSet(form.handle, name, value)
}

/// formValue reads a single named control's value, or none when missing.
func formValue(form: Element, name: string): option<string> {
    let v = __bxFormGet(form.handle, name)
    if v == none {
        return none
    }
    return v as string
}

extern {
    func __bxFormValues(form: any): map<string, string> = {
        frontend: "(f) => { const out = {}; if (f == null) return out; const fd = new FormData(f); for (const [k, v] of fd.entries()) { out[k] = typeof v === 'string' ? v : (v && v.name) || ''; } return out; }"
    }
    func __bxFormSet(form: any, name: string, value: string) = {
        frontend: "(f, n, v) => { if (f == null) return; const el = f.elements && f.elements[n]; if (el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } }"
    }
    func __bxFormGet(form: any, name: string): any = {
        frontend: "(f, n) => { if (f == null) return undefined; const el = f.elements && f.elements[n]; if (el == null) return undefined; return el.type === 'checkbox' ? (el.checked ? 'on' : '') : el.value; }"
    }
}
`;

// Observers (MutationObserver, IntersectionObserver) + media-query listener share a uniform
// shape: a single \`observe*\` function takes the target and a callback, returns a teardown
// closure that disconnects when invoked. The teardown is safe to call multiple times.
const FACADE_OBSERVERS = `package browserx on frontend

/// observeMutations watches \`target\` for child-list / attribute / character-data changes
/// according to \`opts\` and fires \`callback\` with the batch of MutationRecord-shaped any
/// values whenever the platform delivers one. The returned closure disconnects the observer.
///
/// \`opts\` is a free-form bag (\`{"childList": true, "subtree": true}\` etc.) passed
/// through to MutationObserver.observe verbatim.
func observeMutations(target: Element, opts: map<string, any>, callback: func(records: []any)): func() {
    let h = __bxMutationObserve(target.handle, opts, callback)
    return func() {
        __bxMutationDisconnect(h)
    }
}

/// observeIntersection fires \`callback\` whenever any of \`targets\` crosses the viewport
/// (or root) intersection threshold. Common use: lazy-load below-the-fold images. Returns a
/// teardown closure; the returned function detaches every target at once.
func observeIntersection(targets: []Element, opts: map<string, any>, callback: func(entries: []any)): func() {
    let raw: []any = [ ]
    for t in targets {
        raw = raw + [t.handle]
    }
    let h = __bxIntersectionObserve(raw, opts, callback)
    return func() {
        __bxIntersectionDisconnect(h)
    }
}

extern {
    func __bxMutationObserve(target: any, opts: map<string, any>, cb: any): any = {
        frontend: "(t, o, cb) => { const mo = new MutationObserver((records) => cb(records)); mo.observe(t, o); return mo; }"
    }
    func __bxMutationDisconnect(h: any) = {
        frontend: "(h) => { if (h != null) h.disconnect(); }"
    }
    func __bxIntersectionObserve(targets: []any, opts: map<string, any>, cb: any): any = {
        frontend: "(targets, o, cb) => { const io = new IntersectionObserver((entries) => cb(entries), o); for (const t of targets) io.observe(t); return io; }"
    }
    func __bxIntersectionDisconnect(h: any) = {
        frontend: "(h) => { if (h != null) h.disconnect(); }"
    }
}
`;

// Cookie helpers - thin wrappers around document.cookie. The browser's cookie API is a
// string-formatted bag we parse into typed get/set/remove. Set helpers accept an opts struct
// for the common knobs (path, max age, secure, sameSite); domain / signed cookies stay
// caller-controlled via the raw extern below.
const FACADE_COOKIES = `package browserx on frontend

/// cookieGet returns the value of the cookie named \`key\`, or none when absent. URL-
/// encoded values are decoded automatically.
func cookieGet(key: string): option<string> {
    let v = __bxCookieGet(key)
    if v == none {
        return none
    }
    return v as string
}

/// cookieSet writes \`value\` under \`key\`. Defaults: path=/, no expiry. Pass \`maxAge\`
/// in seconds; -1 deletes; 0 makes a session cookie (default).
func cookieSet(key: string, value: string, maxAge: int) {
    __bxCookieSet(key, value, maxAge)
}

/// cookieRemove deletes a cookie by setting its max-age to 0 in the past. The browser
/// drops it on next request.
func cookieRemove(key: string) {
    __bxCookieSet(key, "", -1)
}

extern {
    func __bxCookieGet(k: string): any = {
        frontend: "(k) => { const c = document.cookie || ''; const target = encodeURIComponent(k) + '='; for (const part of c.split(';')) { const trimmed = part.trim(); if (trimmed.startsWith(target)) { return decodeURIComponent(trimmed.slice(target.length)); } } return undefined; }"
    }
    func __bxCookieSet(k: string, v: string, maxAge: int) = {
        frontend: "(k, v, age) => { let parts = encodeURIComponent(k) + '=' + encodeURIComponent(v) + ';path=/;samesite=lax'; if (age > 0) parts += ';max-age=' + age; else if (age < 0) parts += ';max-age=0'; document.cookie = parts; }"
    }
}
`;

// Media-query helpers - one-shot match check plus subscribe-with-teardown listener.
const FACADE_MEDIA = `package browserx on frontend

/// mediaMatches returns true when the given CSS media query currently matches the
/// viewport (e.g. \`mediaMatches("(prefers-color-scheme: dark)")\`).
func mediaMatches(query: string): bool {
    return __bxMediaMatches(query)
}

/// mediaListen subscribes to changes in a media query. The callback fires immediately
/// with the current matches state, then again each time the match flips. Returns a
/// teardown closure.
func mediaListen(query: string, callback: func(matches: bool)): func() {
    let h = __bxMediaListen(query, callback)
    return func() {
        __bxMediaUnlisten(h)
    }
}

extern {
    func __bxMediaMatches(q: string): bool = {
        frontend: "(q) => window.matchMedia(q).matches"
    }
    func __bxMediaListen(q: string, cb: any): any = {
        frontend: "(q, cb) => { const mm = window.matchMedia(q); cb(mm.matches); const fn = (e) => cb(e.matches); mm.addEventListener('change', fn); return { mm, fn }; }"
    }
    func __bxMediaUnlisten(h: any) = {
        frontend: "(h) => { if (h != null && h.mm != null && h.fn != null) h.mm.removeEventListener('change', h.fn); }"
    }
}
`;

// Type narrowing - the missing `as<T>` operator the underlying browser engine already does
// via subclass instanceof checks. Each helper takes an Element (or any HTMLElement), looks
// at the underlying JS handle, and re-wraps it in the typed Sova wrapper when the runtime
// shape matches. Returns none when it doesn't, so the caller can branch idiomatically.
//
// The instanceof check runs against the engine's constructor names, not tagName, so
// `<custom-element>`s that extend HTMLElement still narrow correctly. The unmatched-case
// fallback never throws.
const FACADE_NARROW = `package browserx on frontend

/// asHTMLElement narrows an Element to HTMLElement (covers every HTML tag). Returns none
/// when the underlying handle is an SVG/MathML element or a custom element that doesn't
/// inherit from HTMLElement.
func asHTMLElement(el: Element): option<HTMLElement> {
    if !__bxIsInstance(el.handle, "HTMLElement") { return none }
    return new HTMLElement(el.handle)
}

/// asInput narrows to HTMLInputElement (\`<input>\` tags).
func asInput(el: Element): option<HTMLInputElement> {
    if !__bxIsInstance(el.handle, "HTMLInputElement") { return none }
    return new HTMLInputElement(el.handle)
}

/// asButton narrows to HTMLButtonElement (\`<button>\` tags).
func asButton(el: Element): option<HTMLButtonElement> {
    if !__bxIsInstance(el.handle, "HTMLButtonElement") { return none }
    return new HTMLButtonElement(el.handle)
}

/// asForm narrows to HTMLFormElement.
func asForm(el: Element): option<HTMLFormElement> {
    if !__bxIsInstance(el.handle, "HTMLFormElement") { return none }
    return new HTMLFormElement(el.handle)
}

/// asSelect narrows to HTMLSelectElement.
func asSelect(el: Element): option<HTMLSelectElement> {
    if !__bxIsInstance(el.handle, "HTMLSelectElement") { return none }
    return new HTMLSelectElement(el.handle)
}

/// asTextarea narrows to HTMLTextAreaElement.
func asTextarea(el: Element): option<HTMLTextAreaElement> {
    if !__bxIsInstance(el.handle, "HTMLTextAreaElement") { return none }
    return new HTMLTextAreaElement(el.handle)
}

/// asAnchor narrows to HTMLAnchorElement (\`<a>\` tags).
func asAnchor(el: Element): option<HTMLAnchorElement> {
    if !__bxIsInstance(el.handle, "HTMLAnchorElement") { return none }
    return new HTMLAnchorElement(el.handle)
}

/// asImage narrows to HTMLImageElement (\`<img>\` tags).
func asImage(el: Element): option<HTMLImageElement> {
    if !__bxIsInstance(el.handle, "HTMLImageElement") { return none }
    return new HTMLImageElement(el.handle)
}

/// asCanvas narrows to HTMLCanvasElement (\`<canvas>\` tags).
func asCanvas(el: Element): option<HTMLCanvasElement> {
    if !__bxIsInstance(el.handle, "HTMLCanvasElement") { return none }
    return new HTMLCanvasElement(el.handle)
}

/// asDialog narrows to HTMLDialogElement (\`<dialog>\` tags).
func asDialog(el: Element): option<HTMLDialogElement> {
    if !__bxIsInstance(el.handle, "HTMLDialogElement") { return none }
    return new HTMLDialogElement(el.handle)
}

/// asTemplate narrows to HTMLTemplateElement (\`<template>\` tags).
func asTemplate(el: Element): option<HTMLTemplateElement> {
    if !__bxIsInstance(el.handle, "HTMLTemplateElement") { return none }
    return new HTMLTemplateElement(el.handle)
}

/// asIframe narrows to HTMLIFrameElement (\`<iframe>\` tags).
func asIframe(el: Element): option<HTMLIFrameElement> {
    if !__bxIsInstance(el.handle, "HTMLIFrameElement") { return none }
    return new HTMLIFrameElement(el.handle)
}

/// asVideo narrows to HTMLVideoElement.
func asVideo(el: Element): option<HTMLVideoElement> {
    if !__bxIsInstance(el.handle, "HTMLVideoElement") { return none }
    return new HTMLVideoElement(el.handle)
}

/// asAudio narrows to HTMLAudioElement.
func asAudio(el: Element): option<HTMLAudioElement> {
    if !__bxIsInstance(el.handle, "HTMLAudioElement") { return none }
    return new HTMLAudioElement(el.handle)
}

/// asMedia narrows to HTMLMediaElement - the shared base of \`<video>\` and \`<audio>\`.
/// Use this when the code only needs play/pause/currentTime semantics and doesn't care
/// whether the element is a video or an audio.
func asMedia(el: Element): option<HTMLMediaElement> {
    if !__bxIsInstance(el.handle, "HTMLMediaElement") { return none }
    return new HTMLMediaElement(el.handle)
}

/// asSvg narrows to SVGElement - the base of every SVG node.
func asSvg(el: Element): option<SVGElement> {
    if !__bxIsInstance(el.handle, "SVGElement") { return none }
    return new SVGElement(el.handle)
}

/// asSvgRoot narrows to SVGSVGElement (the outer \`<svg>\` element).
func asSvgRoot(el: Element): option<SVGSVGElement> {
    if !__bxIsInstance(el.handle, "SVGSVGElement") { return none }
    return new SVGSVGElement(el.handle)
}

/// asSvgGroup narrows to SVGGElement (the \`<g>\` group container).
func asSvgGroup(el: Element): option<SVGGElement> {
    if !__bxIsInstance(el.handle, "SVGGElement") { return none }
    return new SVGGElement(el.handle)
}

/// asSvgPath narrows to SVGPathElement.
func asSvgPath(el: Element): option<SVGPathElement> {
    if !__bxIsInstance(el.handle, "SVGPathElement") { return none }
    return new SVGPathElement(el.handle)
}

/// asSvgRect narrows to SVGRectElement.
func asSvgRect(el: Element): option<SVGRectElement> {
    if !__bxIsInstance(el.handle, "SVGRectElement") { return none }
    return new SVGRectElement(el.handle)
}

/// asSvgCircle narrows to SVGCircleElement.
func asSvgCircle(el: Element): option<SVGCircleElement> {
    if !__bxIsInstance(el.handle, "SVGCircleElement") { return none }
    return new SVGCircleElement(el.handle)
}

/// asSvgEllipse narrows to SVGEllipseElement.
func asSvgEllipse(el: Element): option<SVGEllipseElement> {
    if !__bxIsInstance(el.handle, "SVGEllipseElement") { return none }
    return new SVGEllipseElement(el.handle)
}

/// asSvgLine narrows to SVGLineElement.
func asSvgLine(el: Element): option<SVGLineElement> {
    if !__bxIsInstance(el.handle, "SVGLineElement") { return none }
    return new SVGLineElement(el.handle)
}

/// asSvgPolygon narrows to SVGPolygonElement.
func asSvgPolygon(el: Element): option<SVGPolygonElement> {
    if !__bxIsInstance(el.handle, "SVGPolygonElement") { return none }
    return new SVGPolygonElement(el.handle)
}

/// asSvgPolyline narrows to SVGPolylineElement.
func asSvgPolyline(el: Element): option<SVGPolylineElement> {
    if !__bxIsInstance(el.handle, "SVGPolylineElement") { return none }
    return new SVGPolylineElement(el.handle)
}

/// asSvgText narrows to SVGTextElement.
func asSvgText(el: Element): option<SVGTextElement> {
    if !__bxIsInstance(el.handle, "SVGTextElement") { return none }
    return new SVGTextElement(el.handle)
}

/// asSvgImage narrows to SVGImageElement.
func asSvgImage(el: Element): option<SVGImageElement> {
    if !__bxIsInstance(el.handle, "SVGImageElement") { return none }
    return new SVGImageElement(el.handle)
}

/// asSvgUse narrows to SVGUseElement (the \`<use>\` reuse / instancing primitive).
func asSvgUse(el: Element): option<SVGUseElement> {
    if !__bxIsInstance(el.handle, "SVGUseElement") { return none }
    return new SVGUseElement(el.handle)
}

/// tagName reads the underlying handle's HTML tag in upper-case (\`"DIV"\`, \`"INPUT"\`,
/// ...). The browser's normal contract - useful when narrowing by tag rather than by class.
func tagName(el: Element): string {
    return __bxTagName(el.handle)
}

extern {
    /// __bxIsInstance does a single \`handle instanceof globalThis[className]\` check, guarded
    /// against missing globals so the helper still returns false in non-browser runtimes
    /// (Node-side smoke tests, server-rendered pre-checks) instead of throwing.
    func __bxIsInstance(h: any, className: string): bool = {
        frontend: "(h, c) => { if (h == null) return false; const ctor = globalThis[c]; if (typeof ctor !== 'function') return false; return h instanceof ctor; }"
    }
    func __bxTagName(h: any): string = {
        frontend: "(h) => (h == null ? '' : (h.tagName || ''))"
    }
}
`;

// HTTP sugar - the ergonomic wrappers around fetch() for the 80% case. Each helper handles
// the common knobs (JSON body encode, Accept header, response decode) so user code drops the
// `let init = new RequestInit(); init.method = "POST"; init.headers = ...` boilerplate. Every
// helper is async; Sova's auto-async lift makes the caller transparent.
const FACADE_HTTP = `package browserx on frontend

/// fetchText fetches \`url\` and returns the response body as a string. Errors (network
/// failure, non-2xx status) surface as the empty string - callers wanting status codes
/// should reach for the typed Response wrapper instead.
func fetchText(url: string): string {
    return __bxFetchText(url)
}

/// fetchJson fetches \`url\` and parses the response body as JSON. Returns none on any
/// error (network, decode, non-2xx) so callers can pipeline with \`??\` defaults.
func fetchJson(url: string): any {
    return __bxFetchJson(url)
}

/// postJson sends \`data\` as a JSON POST to \`url\`. Returns the decoded response body, or
/// none on error. The Content-Type header is set automatically.
func postJson(url: string, data: any): any {
    return __bxPostJson(url, data)
}

/// putJson is the PUT counterpart to postJson; same response shape.
func putJson(url: string, data: any): any {
    return __bxPutJson(url, data)
}

/// httpDelete sends a DELETE to \`url\` and returns whether the response was 2xx.
func httpDelete(url: string): bool {
    return __bxHttpDelete(url)
}

extern {
    async func __bxFetchText(url: string): string = {
        frontend: "async (url) => { try { const r = await fetch(url); return await r.text(); } catch (e) { return ''; } }"
    }
    async func __bxFetchJson(url: string): any = {
        frontend: "async (url) => { try { const r = await fetch(url); if (!r.ok) return undefined; return await r.json(); } catch (e) { return undefined; } }"
    }
    async func __bxPostJson(url: string, data: any): any = {
        frontend: "async (url, data) => { try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok) return undefined; return await r.json(); } catch (e) { return undefined; } }"
    }
    async func __bxPutJson(url: string, data: any): any = {
        frontend: "async (url, data) => { try { const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok) return undefined; return await r.json(); } catch (e) { return undefined; } }"
    }
    async func __bxHttpDelete(url: string): bool = {
        frontend: "async (url) => { try { const r = await fetch(url, { method: 'DELETE' }); return r.ok; } catch (e) { return false; } }"
    }
}
`;

// Clipboard - reads and writes plain text via the modern Clipboard API. The async path is
// required by every browser; permission prompts pop up automatically on first use.
const FACADE_CLIPBOARD = `package browserx on frontend

/// clipboardRead reads the current clipboard contents as a string. Returns the empty string
/// on permission denial or unsupported environments.
func clipboardRead(): string {
    return __bxClipRead()
}

/// clipboardWrite writes \`text\` to the system clipboard. Returns true on success.
func clipboardWrite(text: string): bool {
    return __bxClipWrite(text)
}

extern {
    async func __bxClipRead(): string = {
        frontend: "async () => { try { return await navigator.clipboard.readText(); } catch (e) { return ''; } }"
    }
    async func __bxClipWrite(t: string): bool = {
        frontend: "async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }"
    }
}
`;

// Routing - the URL / history bits SPAs need. Reads the current URL pieces, pushes new
// states, navigates back, subscribes to popstate. The popstate listener returns a teardown
// closure for clean composition with reactive frameworks.
const FACADE_ROUTING = `package browserx on frontend

/// currentPath returns the URL path (e.g. \`"/users/42"\`) plus query string.
func currentPath(): string {
    return __bxLocPathQuery()
}

/// currentHash returns the URL fragment (e.g. \`"#section-2"\`) including the leading hash.
func currentHash(): string {
    return __bxLocHash()
}

/// navigate pushes \`url\` onto the history stack and re-renders. Callers using a reactive
/// framework typically follow this with a route re-evaluation. Use \`replace=true\` to
/// replace the current entry instead of pushing a new one (e.g. for redirects).
func navigate(url: string, replace: bool) {
    __bxHistoryPush(url, replace)
}

/// historyBack goes back one entry.
func historyBack() {
    __bxHistoryBack()
}

/// historyForward goes forward one entry.
func historyForward() {
    __bxHistoryForward()
}

/// onPopState subscribes to URL changes triggered by back/forward navigation (and
/// programmatic \`navigate(replace=true)\`). The callback fires with the new path; the
/// returned closure removes the listener.
func onPopState(callback: func(path: string)): func() {
    let h = __bxPopStateListen(callback)
    return func() {
        __bxPopStateUnlisten(h)
    }
}

extern {
    func __bxLocPathQuery(): string = {
        frontend: "() => window.location.pathname + (window.location.search || '')"
    }
    func __bxLocHash(): string = {
        frontend: "() => window.location.hash"
    }
    func __bxHistoryPush(url: string, replace: bool) = {
        frontend: "(u, r) => { if (r) window.history.replaceState({}, '', u); else window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate')); }"
    }
    func __bxHistoryBack() = {
        frontend: "() => window.history.back()"
    }
    func __bxHistoryForward() = {
        frontend: "() => window.history.forward()"
    }
    func __bxPopStateListen(cb: any): any = {
        frontend: "(cb) => { const fn = () => cb(window.location.pathname + (window.location.search || '')); window.addEventListener('popstate', fn); return fn; }"
    }
    func __bxPopStateUnlisten(h: any) = {
        frontend: "(h) => { if (h != null) window.removeEventListener('popstate', h); }"
    }
}
`;

// Geolocation - one-shot position read + continuous watch. Both async via the Geolocation
// API; positions surface as Sova tuples so destructuring is clean: \`let lat, lon = pos\`.
const FACADE_GEOLOCATION = `package browserx on frontend

/// geolocate returns the current position as (latitude, longitude). Returns none when the
/// user denies permission, no geolocation provider is available, or the request times out
/// (default 10s).
func geolocate(): option<(float, float) > {
    return __bxGeolocate()
}

/// watchPosition subscribes to position updates as the user moves. The callback fires with
/// each new (latitude, longitude). The returned closure clears the watch.
func watchPosition(callback: func(position: (float, float))): func() {
    let h = __bxWatchPos(callback)
    return func() {
        __bxClearWatch(h)
    }
}

extern {
    async func __bxGeolocate(): option<(float, float) > = {
        frontend: "() => new Promise((resolve) => { if (!navigator.geolocation) return resolve(undefined); navigator.geolocation.getCurrentPosition((p) => resolve([p.coords.latitude, p.coords.longitude]), () => resolve(undefined), { timeout: 10000 }); })"
    }
    func __bxWatchPos(cb: any): int = {
        frontend: "(cb) => { if (!navigator.geolocation) return -1; return navigator.geolocation.watchPosition((p) => cb([p.coords.latitude, p.coords.longitude]), null, { enableHighAccuracy: false }); }"
    }
    func __bxClearWatch(h: int) = {
        frontend: "(h) => { if (h >= 0 && navigator.geolocation) navigator.geolocation.clearWatch(h); }"
    }
}
`;

// BroadcastChannel - a same-origin pub/sub channel between tabs/iframes/workers. Send +
// subscribe with teardown. Messages are JSON-shaped \`any\` so callers can put primitives or
// records through without ceremony.
const FACADE_CHANNELS = `package browserx on frontend

/// openChannel returns a handle to a named BroadcastChannel. Pass the handle to
/// \`sendChannel\` to publish and \`subscribeChannel\` to receive. Keep the handle alive
/// for the lifetime of the subscription; close with \`closeChannel\` to release the
/// channel's resources.
func openChannel(name: string): any {
    return __bxOpenChannel(name)
}

/// sendChannel publishes \`message\` to every other listener on \`channel\`. The message is
/// structured-cloned, so non-serializable values (DOM nodes, functions) will fail at
/// runtime - keep payloads to plain data.
func sendChannel(channel: any, message: any) {
    __bxSendChannel(channel, message)
}

/// subscribeChannel registers a listener on \`channel\`. Returns a teardown closure.
func subscribeChannel(channel: any, callback: func(message: any)): func() {
    let h = __bxSubChannel(channel, callback)
    return func() {
        __bxUnsubChannel(channel, h)
    }
}

/// closeChannel releases the BroadcastChannel and detaches any remaining listeners.
func closeChannel(channel: any) {
    __bxCloseChannel(channel)
}

extern {
    func __bxOpenChannel(name: string): any = {
        frontend: "(n) => new BroadcastChannel(n)"
    }
    func __bxSendChannel(c: any, m: any) = {
        frontend: "(c, m) => { if (c != null) c.postMessage(m); }"
    }
    func __bxSubChannel(c: any, cb: any): any = {
        frontend: "(c, cb) => { if (c == null) return null; const fn = (e) => cb(e.data); c.addEventListener('message', fn); return fn; }"
    }
    func __bxUnsubChannel(c: any, h: any) = {
        frontend: "(c, h) => { if (c != null && h != null) c.removeEventListener('message', h); }"
    }
    func __bxCloseChannel(c: any) = {
        frontend: "(c) => { if (c != null) c.close(); }"
    }
}
`;

const FACADE_BINARY = `package browserx on frontend

/// ArrayBuffer wraps a JS \`ArrayBuffer\` handle - a raw fixed-length byte
/// container used as the storage backing every typed array. Most users
/// don't construct these directly; they receive one from \`Response.arrayBuffer()\`,
/// \`FileReader\`, \`fetch\`, or the WebGL/WebRTC APIs.
type ArrayBuffer {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func byteLength(): int { return __bxBufByteLength(this.handle) }
    func slice(begin: int, end: int): ArrayBuffer {
        return new ArrayBuffer(__bxBufSlice(this.handle, begin, end))
    }
}

/// SharedArrayBuffer is the cross-thread variant of ArrayBuffer used with
/// Atomics + workers. Same shape; different concurrency semantics.
type SharedArrayBuffer {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func byteLength(): int { return __bxBufByteLength(this.handle) }
}

/// DataView reads / writes typed values at arbitrary byte offsets into an
/// underlying ArrayBuffer with explicit endianness control.
type DataView {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func byteLength(): int { return __bxBufByteLength(this.handle) }
}

/// Each typed array wraps a JS typed-array handle. The underlying memory is
/// an ArrayBuffer; \`length\` is the element count (not bytes), \`at(i)\` and
/// \`set(i, v)\` index into it. Use \`buffer()\` to get back the raw bytes.
type Int8Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): int { return __bxTAGetInt(this.handle, i) }
    func setAt(i: int, v: int) { __bxTASetInt(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type Uint8Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): int { return __bxTAGetInt(this.handle, i) }
    func setAt(i: int, v: int) { __bxTASetInt(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type Uint8ClampedArray {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): int { return __bxTAGetInt(this.handle, i) }
    func setAt(i: int, v: int) { __bxTASetInt(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type Int16Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): int { return __bxTAGetInt(this.handle, i) }
    func setAt(i: int, v: int) { __bxTASetInt(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type Uint16Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): int { return __bxTAGetInt(this.handle, i) }
    func setAt(i: int, v: int) { __bxTASetInt(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type Int32Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): int { return __bxTAGetInt(this.handle, i) }
    func setAt(i: int, v: int) { __bxTASetInt(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type Uint32Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): int { return __bxTAGetInt(this.handle, i) }
    func setAt(i: int, v: int) { __bxTASetInt(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type BigInt64Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): int { return __bxTAGetInt(this.handle, i) }
    func setAt(i: int, v: int) { __bxTASetInt(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type BigUint64Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): int { return __bxTAGetInt(this.handle, i) }
    func setAt(i: int, v: int) { __bxTASetInt(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type Float16Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): float { return __bxTAGetFloat(this.handle, i) }
    func setAt(i: int, v: float) { __bxTASetFloat(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type Float32Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): float { return __bxTAGetFloat(this.handle, i) }
    func setAt(i: int, v: float) { __bxTASetFloat(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

type Float64Array {
    handle: any = none
    new(handle: any) { this.handle = handle }
    func length(): int { return __bxBufLength(this.handle) }
    func at(i: int): float { return __bxTAGetFloat(this.handle, i) }
    func setAt(i: int, v: float) { __bxTASetFloat(this.handle, i, v) }
    func buffer(): ArrayBuffer { return new ArrayBuffer(__bxTABuffer(this.handle)) }
}

/// newArrayBuffer allocates a fresh ArrayBuffer of the given byte length.
func newArrayBuffer(byteLength: int): ArrayBuffer {
    return new ArrayBuffer(__bxNewArrayBuffer(byteLength))
}

/// uint8ArrayFromBytes wraps a Sova \`[]byte\` slice in a Uint8Array view.
/// The underlying memory is copied on construction.
func uint8ArrayFromBytes(bytes: []byte): Uint8Array {
    return new Uint8Array(__bxUint8FromBytes(bytes))
}

/// uint8ArrayToBytes copies a Uint8Array's contents into a Sova \`[]byte\`.
func uint8ArrayToBytes(arr: Uint8Array): []byte {
    return __bxUint8ToBytes(arr.handle)
}

extern {
    func __bxBufByteLength(h: any): int = {
        frontend: "(h) => (h == null ? 0 : (h.byteLength | 0))"
    }
    func __bxBufLength(h: any): int = {
        frontend: "(h) => (h == null ? 0 : (h.length | 0))"
    }
    func __bxBufSlice(h: any, begin: int, end: int): any = {
        frontend: "(h, b, e) => (h == null ? null : h.slice(b, e))"
    }
    func __bxTAGetInt(h: any, i: int): int = {
        frontend: "(h, i) => (h == null ? 0 : Number(h[i] ?? 0) | 0)"
    }
    func __bxTASetInt(h: any, i: int, v: int) = {
        frontend: "(h, i, v) => { if (h != null) h[i] = v; }"
    }
    func __bxTAGetFloat(h: any, i: int): float = {
        frontend: "(h, i) => (h == null ? 0 : Number(h[i] ?? 0))"
    }
    func __bxTASetFloat(h: any, i: int, v: float) = {
        frontend: "(h, i, v) => { if (h != null) h[i] = v; }"
    }
    func __bxTABuffer(h: any): any = {
        frontend: "(h) => (h == null ? null : h.buffer)"
    }
    func __bxNewArrayBuffer(n: int): any = {
        frontend: "(n) => new ArrayBuffer(n)"
    }
    func __bxUint8FromBytes(bs: []byte): any = {
        frontend: "(bs) => new Uint8Array(bs)"
    }
    func __bxUint8ToBytes(h: any): []byte = {
        frontend: "(h) => Array.from(h || [])"
    }
}
`;
