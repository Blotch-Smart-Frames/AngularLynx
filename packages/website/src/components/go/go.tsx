import { useSyncExternalStore } from 'react';
import { Go as GoBase, GoConfigProvider, type GoProps } from '@lynx-js/go-web';
import { rspressAdapter } from '@lynx-js/go-web/adapters/rspress';
import {
  DEVICE_HEIGHT,
  DEVICE_WIDTH,
  applyNativeParity,
} from './native-parity';

applyNativeParity();

const config = {
  exampleBasePath: '/examples',
  defaultTab: 'web' as const,
  ...rspressAdapter,
};

// The width at which `<Go>` stacks the preview under the code.
const PHONE_QUERY = '(max-width: 600px)';

const subscribeToPhoneQuery = (onChange: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const useIsPhone = () =>
  useSyncExternalStore(
    subscribeToPhoneQuery,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );

const InteractiveGo = ({ langAlias, ...props }: GoProps) => {
  // On a desktop, lay the example out at a phone's size and scale it down to
  // fit the pane whole, rather than reflowing it to the pane's width: the web
  // preview should look like the app does on iOS (see native-parity.ts). On a
  // phone the pane is already about a phone wide, but short, so scaling the
  // whole screen into it would shrink the text to under half its size there.
  const isPhone = useIsPhone();
  return (
    <GoConfigProvider config={config}>
      <GoBase
        langAlias={{ ts: 'angular-ts', ...langAlias }}
        webPreviewMode={isPhone ? 'responsive' : 'fit'}
        fit="contain"
        designWidth={DEVICE_WIDTH}
        designHeight={DEVICE_HEIGHT}
        {...props}
      />
    </GoConfigProvider>
  );
};

/**
 * An example's code and live preview. Rspress 2.1 also renders each page to
 * Markdown at build time, for AI tools (on by default), and that renderer
 * runs components' effects with no DOM, which the preview's need, so a page
 * with an example failed to render there. A live preview has nothing to put
 * in Markdown, so it's left out there, as Rspress's own BrowserOnly does.
 */
export const Go = (props: GoProps) =>
  import.meta.env.SSG_MD ? null : <InteractiveGo {...props} />;

export type { GoProps };
export default Go;
