import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { type BadgeVariant, UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiSeparator } from '../../components/ui/separator';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

// Mirror of the runtime's Opcode enum
// (packages/runtime/src/lib/ssr/opcodes.ts). Duplicated here rather than
// imported because it's a `const enum` — inlined at compile time and not
// exported across the package boundary. The encode/hydrate contract is the
// stable surface; these numeric tags are part of it.
const OP_BEGIN = 0;
const OP_END = 1;
const OP_ATTR = 2;
const OP_TEXT = 3;

// A single decoded instruction, pre-formatted for display so the template stays
// dumb (no per-kind branching or narrowing). `kind` only drives indentation.
type OpcodeRow = {
  readonly kind: 'begin' | 'attr' | 'text';
  readonly badge: string;
  readonly badgeVariant: BadgeVariant;
  readonly primary: string;
  readonly secondary?: string;
};

// The result of one ssrEncode() run — the headline metrics plus a capped,
// human-readable slice of the opcode stream.
type Snapshot = {
  readonly elements: number;
  readonly attributes: number;
  readonly textNodes: number;
  readonly totalOpcodes: number;
  readonly bytes: number;
  readonly rows: readonly OpcodeRow[];
  readonly hiddenRows: number;
};

// How many decoded rows to show before collapsing the rest into a "+N more"
// footer — enough to convey the shape of the stream without a wall of rows.
const PREVIEW_CAP = 18;

@Component({
  selector: 'app-ssr-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiBadge,
    UiButton,
    UiCard,
    UiCardContent,
    UiCardDescription,
    UiCardHeader,
    UiCardTitle,
    UiSeparator,
    UiText,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ssr-demo.html',
})
export class SsrDemo {
  // Whether the SSR entry points are wired up in this build. Checked eagerly so
  // the screen reflects the real capability even before the button is tapped.
  readonly capability = signal(this.#checkCapability());

  // The most recent encode result, or null before the first run.
  readonly snapshot = signal<Snapshot | null>(null);

  // Surfaced verbatim so a misconfigured build fails loudly instead of silently.
  readonly error = signal('');

  // Human-readable snapshot size, derived so the template doesn't do math.
  readonly sizeLabel = computed(() => {
    const snap = this.snapshot();
    if (!snap) return '';
    return snap.bytes < 1024
      ? `${snap.bytes} B`
      : `${(snap.bytes / 1024).toFixed(1)} KB`;
  });

  runEncode(): void {
    this.error.set('');

    // `ssrEncode` is registered on globalThis by the renderer's SSR setup
    // (provideRenderer() with SSR enabled) — not in DI, because the native host
    // (test harness, CLI) invokes it after bootstrap without injector access.
    const ssrEncode = (globalThis as any).ssrEncode as
      | (() => string)
      | undefined;
    if (typeof ssrEncode !== 'function') {
      this.error.set(
        'ssrEncode is not registered — SSR is disabled in this build.',
      );
      return;
    }

    try {
      const json = ssrEncode();
      const parsed = JSON.parse(json) as { __opcodes?: unknown[] };
      this.snapshot.set(this.#decode(parsed.__opcodes ?? [], json.length));
      // A successful call proves encode is live; refresh in case it registered
      // late relative to the initial capability probe.
      this.capability.set(this.#checkCapability());
    } catch (e) {
      this.error.set(String(e));
    }
  }

  /**
   * Walk the flat opcode stream, tallying each opcode type and decoding the
   * first {@link PREVIEW_CAP} content instructions into display rows.
   *
   * The stream is a packed sequence of `[opcode, ...args]` tuples with no
   * delimiters, so we advance by each opcode's fixed arg count. `End` opcodes
   * are counted toward the total but skipped in the preview — they carry no
   * content, and indentation already conveys nesting.
   */
  #decode(opcodes: readonly unknown[], bytes: number): Snapshot {
    const rows: OpcodeRow[] = [];
    let elements = 0;
    let attributes = 0;
    let textNodes = 0;
    let ends = 0;

    let i = 0;
    while (i < opcodes.length) {
      switch (opcodes[i]) {
        case OP_BEGIN:
          elements++;
          if (rows.length < PREVIEW_CAP) {
            rows.push({
              kind: 'begin',
              badge: 'el',
              badgeVariant: 'default',
              primary: `<${String(opcodes[i + 2])}>`,
            });
          }
          i += 3; // [Begin, ssrId, tag]
          break;
        case OP_ATTR:
          attributes++;
          if (rows.length < PREVIEW_CAP) {
            rows.push({
              kind: 'attr',
              badge: 'attr',
              badgeVariant: 'secondary',
              primary: String(opcodes[i + 1]),
              secondary: this.#truncate(String(opcodes[i + 2])),
            });
          }
          i += 3; // [Attr, key, value]
          break;
        case OP_TEXT:
          textNodes++;
          if (rows.length < PREVIEW_CAP) {
            rows.push({
              kind: 'text',
              badge: 'txt',
              badgeVariant: 'outline',
              primary: `"${this.#truncate(String(opcodes[i + 2]))}"`,
            });
          }
          i += 3; // [Text, ssrId, content]
          break;
        case OP_END:
          ends++;
          i += 1; // [End]
          break;
        default:
          // Unknown opcode — advance one slot rather than trust the framing, so
          // a malformed stream can't spin this loop forever.
          i += 1;
      }
    }

    const contentOps = elements + attributes + textNodes;
    return {
      elements,
      attributes,
      textNodes,
      totalOpcodes: contentOps + ends,
      bytes,
      rows,
      hiddenRows: contentOps - rows.length,
    };
  }

  /**
   * Keep long class strings and text content from overflowing a stream row.
   */
  #truncate(value: string, max = 48): string {
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }

  #checkCapability(): {
    encode: boolean;
    hydrate: boolean;
    ready: boolean;
  } {
    // Both must be present for SSR to be operational: ssrEncode serializes the
    // initial render to a snapshot, and ssrHydrate replays it on the main
    // thread before Angular hydrates.
    const encode = typeof (globalThis as any).ssrEncode === 'function';
    const hydrate = typeof (globalThis as any).ssrHydrate === 'function';
    return { encode, hydrate, ready: encode && hydrate };
  }
}
