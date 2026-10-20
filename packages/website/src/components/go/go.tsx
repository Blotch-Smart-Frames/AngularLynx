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

export const Go = ({ langAlias, ...props }: GoProps) => {
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

export type { GoProps };
export default Go;
