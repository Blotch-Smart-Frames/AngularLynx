import { useEffect } from '@lynx-js/react';
import { useGlobalProps } from '@lynx-js/react';

import { reportFullyDrawn } from '../lib/fullyDrawn';
import { markMountStart } from '../lib/mountStart';
import { SPRITE_BASE } from '../lib/mappers/pokemon';

// The benchmark's rendering-throughput screen (benchmarks/SPEC.md, "Mount"),
// which a BENCH_SCREEN build opens on: mount?kind=view&count=1500.
type Kind = 'view' | 'text' | 'image';

const KINDS: readonly Kind[] = ['view', 'text', 'image'];

export default function BenchMount({ params }: { params: Record<string, string> }) {
  // Before anything of the screen is made, on whichever thread renders it
  // first (lib/mountStart.ts), as the original's MountStart is emitted while
  // its screen renders.
  markMountStart();
  const kind: Kind = KINDS.includes(params.kind as Kind) ? (params.kind as Kind) : 'view';
  const count = Number(params.count) > 0 ? Number(params.count) : 1500;
  const { safeAreaTop = 0 } = useGlobalProps();

  // After the commit that shows all `count` elements, as the Pokédex reports
  // its first page (lib/fullyDrawn.ts).
  useEffect(() => {
    reportFullyDrawn();
  }, []);

  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(<Item key={i} kind={kind} index={i} />);
  }

  return (
    // A scroll-view renders every child (it isn't virtualized), so all
    // `count` elements mount, and the ones past the screen can be scrolled to.
    <scroll-view
      className="bench"
      scroll-orientation="vertical"
      style={{ paddingTop: `${safeAreaTop}px` }}
    >
      <view className="bench-container">{items}</view>
    </scroll-view>
  );
}

function Item({ kind, index }: { kind: Kind; index: number }) {
  switch (kind) {
    case 'text':
      return <text>{index}</text>;
    case 'image':
      // Lynx's <image>, as the Pokédex's rows draw their sprites.
      return (
        <image
          src={`${SPRITE_BASE}/${(index % 300) + 1}.png`}
          className="bench-image"
          mode="aspectFit"
        />
      );
    default:
      return <view className="bench-box" />;
  }
}
