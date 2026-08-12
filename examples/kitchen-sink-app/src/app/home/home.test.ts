import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { Home } from './home';

describe('Home', () => {
  it('renders the hero text', async () => {
    const { getByText } = await render(Home);
    expect(getByText('Angular')).toBeTruthy();
    expect(getByText('on Lynx')).toBeTruthy();
  });

  it('alterLogo starts as false and onTap() toggles it', async () => {
    const { componentRef } = await render(Home);
    const instance = componentRef.instance as Home;

    expect(instance.alterLogo()).toBe(false);

    instance.onTap({} as never);
    await waitForUpdate();
    expect(instance.alterLogo()).toBe(true);

    instance.onTap({} as never);
    await waitForUpdate();
    expect(instance.alterLogo()).toBe(false);
  });

  it('showDialog starts closed', async () => {
    const { componentRef } = await render(Home);
    const instance = componentRef.instance as Home;
    expect(instance.showDialog()).toBe(false);
  });
});
