// Shared shape for the native __* PAPI globals that renderer/element spec
// harnesses fake out (installNativeFakes()-style setups). Generic over the
// harness's own fake element type — each harness models a different subset
// of a real ElementRef's fields — so every spec gets property-name and
// parameter-type checking on its fakes without redeclaring this interface.
//
// Not exported from public-api.ts: this is test-only infrastructure, never
// shipped in the published package.
export type FakeNativeGlobal<El> = {
  __CreatePage: () => El;
  __CreateView: () => El;
  __CreateText: () => El;
  __CreateScrollView: () => El;
  __CreateImage: () => El;
  __CreateRawText: (text: string) => El;
  __CreateElement: (tag: string) => El;
  __CreateWrapperElement: () => El;
  __GetElementUniqueID: (n: El) => number;
  __GetTag: (n: El) => string;
  __AppendElement: (parent: El, child: El) => El;
  __InsertElementBefore: (parent: El, child: El, ref: El) => El;
  __RemoveElement: (parent: El, child: El) => El;
  __GetParent: (n: El) => El | null;
  __GetChildren: (n: El) => El[];
  __FirstElement: (n: El) => El | null;
  __LastElement: (n: El) => El | null;
  __NextElement: (n: El) => El | null;
  __SetClasses: (n: El, s: string | undefined) => void;
  __GetClasses: (n: El) => string[];
  __AddClass: (n: El, name: string) => void;
  __SetAttribute: (n: El, name: string, value: unknown) => void;
  __GetAttributeByName: (n: El, name: string) => unknown;
  __SetID: (n: El, id: string) => void;
  __SetDataset: () => void;
  __SetConfig: () => void;
  __AddInlineStyle: (n: El, key: string, value: unknown) => void;
  __SetInlineStyles: (n: El, value: unknown) => void;
  __AddEvent: (el: El, type: string, name: string) => void;
  __FlushElementTree: () => void;
  __ElementAnimate: () => void;
};
