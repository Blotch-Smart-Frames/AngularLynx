import { runOnBackground, useEffect, useMainThreadRef, useState } from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';

import { ActivityIndicator } from '../components/ActivityIndicator';
import { FavouriteButton } from '../components/FavouriteButton';
import { PokemonDetail } from '../components/PokemonDetail';
import { usePokemon } from '../lib/hooks/usePokemon';
import { useNavigation } from '../navigation';

// How far the header has to be dragged down to dismiss the sheet.
const DISMISS_DISTANCE = 100;

/**
 * The original's /pokemon/:id route, presented as an iOS form sheet at 75%
 * of the screen (react-native-screens' UISheetPresentationController). Lynx
 * has no native sheet, so this draws one: the dimmed page behind, a sheet
 * that slides up from the bottom with a 16 radius, and dismisses with a tap
 * on the dimmed page or a drag of its header, which a main-thread handler
 * follows frame by frame as ReactLynx does gestures.
 */
export default function PokemonScreen({ id }: { id: string }) {
  const closeDetail = useNavigation(state => state.closeDetail);
  // Mounted at its starting place, then moved, so the transitions run.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(true);
  }, []);

  const close = () => {
    setShown(false);
    setTimeout(closeDetail, 350);
  };

  const sheetRef = useMainThreadRef<MainThread.Element | null>(null);
  const startY = useMainThreadRef(0);
  const dragged = useMainThreadRef(0);

  const onDragStart = (event: MainThread.TouchEvent) => {
    'main thread';
    startY.current = event.touches[0]!.clientY;
    dragged.current = 0;
    sheetRef.current?.setStyleProperty('transition', 'none');
  };
  const onDragMove = (event: MainThread.TouchEvent) => {
    'main thread';
    dragged.current = Math.max(0, event.touches[0]!.clientY - startY.current);
    sheetRef.current?.setStyleProperty('transform', `translateY(${dragged.current}px)`);
  };
  const onDragEnd = () => {
    'main thread';
    sheetRef.current?.setStyleProperty('transition', 'transform 0.35s ease-out');
    if (dragged.current > DISMISS_DISTANCE) {
      sheetRef.current?.setStyleProperty('transform', 'translateY(100%)');
      runOnBackground(close)();
    } else {
      sheetRef.current?.setStyleProperty('transform', 'translateY(0px)');
    }
  };

  return (
    <view className="sheet-root">
      <view
        className={`sheet-backdrop${shown ? ' sheet-backdrop-shown' : ''}`}
        bindtap={close}
      />
      <view main-thread:ref={sheetRef} className={`sheet${shown ? ' sheet-shown' : ''}`}>
        <SheetContent
          id={id}
          close={close}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        />
      </view>
    </view>
  );
}

function SheetContent({
  id,
  close,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  id: string;
  close: () => void;
  onDragStart: (event: MainThread.TouchEvent) => void;
  onDragMove: (event: MainThread.TouchEvent) => void;
  onDragEnd: () => void;
}) {
  const pokemon = usePokemon(id);
  const centerHeight = SystemInfo.pixelHeight / SystemInfo.pixelRatio / 2;

  const header = (
    // Loaded, the handle sits in a 52 tall header beside the heart; loading
    // or failed, the original draws the handle alone at the top.
    <view
      className={pokemon.data ? 'sheet-header' : 'sheet-header-bare'}
      main-thread:bindtouchstart={onDragStart}
      main-thread:bindtouchmove={onDragMove}
      main-thread:bindtouchend={onDragEnd}
      main-thread:bindtouchcancel={onDragEnd}
    >
      <view className="sheet-handle" />
      {pokemon.data && <FavouriteButton name={id} size={30} className="sheet-favourite" />}
    </view>
  );

  if (pokemon.isLoading) {
    return (
      <view className="fill">
        {header}
        <view className="sheet-center" style={{ height: `${centerHeight}px` }}>
          <ActivityIndicator size="large" />
        </view>
      </view>
    );
  }

  if (pokemon.isError || !pokemon.data) {
    return (
      <view className="fill">
        {header}
        <view className="sheet-center" style={{ height: `${centerHeight}px` }}>
          <text>Failed to load the Pokémon</text>
          <view className="sheet-link" bindtap={close}>
            <text>Close</text>
          </view>
        </view>
      </view>
    );
  }

  return (
    <view className="fill">
      {header}
      <scroll-view className="sheet-scroll" scroll-orientation="vertical">
        <view className="sheet-content">
          <PokemonDetail pokemon={pokemon.data} />
        </view>
      </scroll-view>
    </view>
  );
}
