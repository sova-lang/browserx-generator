export const SUBSET = {
  // Core DOM tree primitives.
  dom: [
    "EventTarget",
    "Node",
    "Document",
    "DocumentFragment",
    "Element",
    "Attr",
    "CharacterData",
    "Text",
    "Comment",
    "DOMTokenList",
    "NamedNodeMap",
    "NodeList",
    "HTMLCollection",
    "Range",
    "DOMImplementation",
    "DOMException",
    "AbortController",
    "AbortSignal",
  ],

  // HTML element hierarchy: top of the tree plus the 12-or-so subclasses people actually use.
  html: [
    "HTMLElement",
    "HTMLBodyElement",
    "HTMLHeadElement",
    "HTMLDivElement",
    "HTMLSpanElement",
    "HTMLParagraphElement",
    "HTMLAnchorElement",
    "HTMLImageElement",
    "HTMLInputElement",
    "HTMLButtonElement",
    "HTMLFormElement",
    "HTMLLabelElement",
    "HTMLSelectElement",
    "HTMLOptionElement",
    "HTMLOptGroupElement",
    "HTMLTextAreaElement",
    "HTMLUListElement",
    "HTMLOListElement",
    "HTMLLIElement",
    "HTMLHeadingElement",
    "HTMLTableElement",
    "HTMLTableRowElement",
    "HTMLTableCellElement",
    "HTMLTableSectionElement",
    "HTMLCanvasElement",
    "HTMLDialogElement",
    "HTMLDetailsElement",
    "HTMLTemplateElement",
    "HTMLScriptElement",
    "HTMLStyleElement",
    "HTMLLinkElement",
    "HTMLMetaElement",
    "HTMLTitleElement",
    "HTMLIFrameElement",
    "HTMLVideoElement",
    "HTMLAudioElement",
    "HTMLMediaElement",
    "HTMLSourceElement",
    "HTMLTrackElement",
    "Window",
    "Location",
    "History",
    "Navigator",
    "Storage",
    "DOMStringMap",
    "ValidityState",
    "DataTransfer",
    "FormData",
  ],

  // Event hierarchy.
  uievents: [
    "UIEvent",
    "MouseEvent",
    "KeyboardEvent",
    "InputEvent",
    "CompositionEvent",
    "FocusEvent",
    "WheelEvent",
  ],

  // HTML-spec event subclasses that need their own typed callbacks: `onsubmit` lands here,
  // `onbeforeunload`'s return-string contract drives the typedef, and `onerror` /
  // `onpopstate` carry their own payloads. Adding them to the subset both gives users typed
  // access to event.* members and lets the event-handler subtype table point at the right
  // class.
  html_events: [
    "SubmitEvent",
    "BeforeUnloadEvent",
    "ErrorEvent",
    "HashChangeEvent",
    "PageTransitionEvent",
    "PopStateEvent",
    "PromiseRejectionEvent",
    "MessageEvent",
    "StorageEvent",
  ],
  uievents_2: ["DragEvent"], // DragEvent inherits from MouseEvent

  pointerevents: ["PointerEvent"],
  touchevents: ["TouchEvent", "Touch", "TouchList"],
  cssom: ["CSSStyleDeclaration", "CSSStyleSheet", "CSSRule", "StyleSheet"],
  geometry: ["DOMRect", "DOMRectReadOnly", "DOMPoint", "DOMPointReadOnly"],
  "file-a-pi": ["File", "Blob", "FileList", "FileReader"],
  fetch: ["Headers", "Request", "Response"],
  "url-spec": ["URL", "URLSearchParams"],
  console: ["console"],

  // SVG elements - the common shapes / containers users actually touch. The animation
  // hierarchy (svg-animations spec) and the long tail of filter/gradient/pattern primitives
  // stay out of subset for v1; users importing those can extend this list.
  SVG: [
    "SVGElement",
    "SVGGraphicsElement",
    "SVGGeometryElement",
    "SVGSVGElement",
    "SVGGElement",
    "SVGPathElement",
    "SVGRectElement",
    "SVGCircleElement",
    "SVGEllipseElement",
    "SVGLineElement",
    "SVGPolygonElement",
    "SVGPolylineElement",
    "SVGTextElement",
    "SVGTSpanElement",
    "SVGTextPathElement",
    "SVGImageElement",
    "SVGUseElement",
    "SVGDefsElement",
    "SVGSymbolElement",
    "SVGMarkerElement",
    "SVGTitleElement",
    "SVGDescElement",
  ],

  webgl1: [
    "WebGLObject",
    "WebGLBuffer",
    "WebGLFramebuffer",
    "WebGLProgram",
    "WebGLRenderbuffer",
    "WebGLShader",
    "WebGLTexture",
    "WebGLUniformLocation",
    "WebGLActiveInfo",
    "WebGLShaderPrecisionFormat",
    "WebGLRenderingContext",
    "WebGLContextEvent",
  ],

  webgl2: [
    "WebGLQuery",
    "WebGLSampler",
    "WebGLSync",
    "WebGLTransformFeedback",
    "WebGLVertexArrayObject",
    "WebGL2RenderingContext",
  ],

  webrtc: [
    "RTCPeerConnection",
    "RTCSessionDescription",
    "RTCIceCandidate",
    "RTCPeerConnectionIceEvent",
    "RTCPeerConnectionIceErrorEvent",
    "RTCCertificate",
    "RTCRtpSender",
    "RTCRtpReceiver",
    "RTCRtpTransceiver",
    "RTCDtlsTransport",
    "RTCIceTransport",
    "RTCIceCandidatePair",
    "RTCTrackEvent",
    "RTCSctpTransport",
    "RTCDataChannel",
    "RTCDataChannelEvent",
    "RTCDTMFSender",
    "RTCDTMFToneChangeEvent",
    "RTCStatsReport",
    "RTCError",
    "RTCErrorEvent",
  ],

  IndexedDB: [
    "IDBRequest",
    "IDBOpenDBRequest",
    "IDBVersionChangeEvent",
    "IDBFactory",
    "IDBDatabase",
    "IDBObjectStore",
    "IDBIndex",
    "IDBKeyRange",
    "IDBCursor",
    "IDBCursorWithValue",
    "IDBTransaction",
  ],

  mediasession: ["MediaSession", "MediaMetadata", "ChapterInformation"],

  webauthn: [
    "PublicKeyCredential",
    "AuthenticatorResponse",
    "AuthenticatorAttestationResponse",
    "AuthenticatorAssertionResponse",
  ],
};

SUBSET.dom.push("Event", "CustomEvent", "EventInit", "CustomEventInit");

export type SubsetKey = keyof typeof SUBSET;

export function allSubsetNames(): Set<string> {
  const out = new Set<string>();
  for (const arr of Object.values(SUBSET)) {
    for (const name of arr) out.add(name);
  }
  return out;
}
