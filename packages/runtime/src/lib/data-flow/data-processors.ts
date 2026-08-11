import type {
  DataProcessorDefinition,
  InitData,
  InitDataRaw,
} from './data-flow.types';

/**
 * Register data processor functions that the native Lynx runtime calls before
 * delivering init data to the app. Maps to the global `processData` callback.
 *
 * Call this before bootstrapApplication so that native data is transformed
 * before LynxInitData receives the first onDataChanged event.
 *
 * @example
 * registerDataProcessors({
 *   defaultDataProcessor: (raw) => ({ ...raw, theme: raw.theme ?? 'light' }),
 * });
 * bootstrapApplication(App, appConfig);
 */
export const registerDataProcessors = (
  definition: DataProcessorDefinition,
): void => {
  (globalThis as any).processData = (
    data: InitDataRaw,
    processorName?: string,
  ): InitData => {
    try {
      if (processorName) {
        return (definition.dataProcessors?.[processorName]?.(data) ??
          data) as InitData;
      }
      return (definition.defaultDataProcessor?.(data) ?? data) as InitData;
    } catch {
      // Match React Lynx behavior: a crashing processor returns {} rather than crashing the app.
      return {} as InitData;
    }
  };
};
