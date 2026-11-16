import { describe, expect, it } from 'vitest';
import { LynxTabPage, setTabActive } from './tab-page';

describe('LynxTabPage', () => {
  it("sets each tab's own active, whichever was made first", () => {
    // The first tab's constructor assigns setTabActive; the tabs after it
    // use the same.
    const first = new LynxTabPage();
    const second = new LynxTabPage();

    setTabActive(second, true);
    expect(first.active()).toBe(false);
    expect(second.active()).toBe(true);

    setTabActive(first, true);
    setTabActive(second, false);
    expect(first.active()).toBe(true);
    expect(second.active()).toBe(false);
  });
});
