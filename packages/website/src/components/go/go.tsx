import { Go as GoBase, GoConfigProvider, type GoProps } from '@lynx-js/go-web';
import { rspressAdapter } from '@lynx-js/go-web/adapters/rspress';

const config = {
  exampleBasePath: '/examples',
  defaultTab: 'web' as const,
  ...rspressAdapter,
};

export const Go = ({ langAlias, ...props }: GoProps) => {
  return (
    <GoConfigProvider config={config}>
      <GoBase langAlias={{ ts: 'angular-ts', ...langAlias }} {...props} />
    </GoConfigProvider>
  );
};

export type { GoProps };
export default Go;
