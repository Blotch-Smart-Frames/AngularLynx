import { NativeModule, requireNativeModule } from 'expo';

declare class AppStartupModule extends NativeModule<{}> {
  reportInitiallyDrawn(): void;
  reportFullyDrawn(): void;
  reportMountStart(): void;
  reportMountEnd(): void;
}

export default requireNativeModule<AppStartupModule>('AppStartupModule');
