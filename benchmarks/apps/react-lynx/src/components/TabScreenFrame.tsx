import { useGlobalProps } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';

/**
 * A white strip under the status bar, then the screen's gray. The shell lays
 * the page out under the status bar and sends the insets as global props
 * (Lynx's own env(safe-area-inset-*) is 0 there).
 */
export default function TabScreenFrame({ children }: { children: ReactNode }) {
  const { safeAreaTop = 0 } = useGlobalProps();
  return (
    <view className="tab-screen" style={{ paddingTop: `${safeAreaTop}px` }}>
      <view className="tab-screen-content">{children}</view>
    </view>
  );
}
