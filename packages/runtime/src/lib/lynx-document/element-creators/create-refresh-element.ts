import type { ElementRef } from '../../types/lynx';

export const createRefreshElement = (pageId: number): ElementRef => {
  return __CreateElement('refresh', pageId);
};

export const createRefreshHeaderElement = (pageId: number): ElementRef => {
  return __CreateElement('refresh-header', pageId);
};
