import { describe, expect, it } from 'vitest';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { renderOnce } from '../../test-utils/render-once';
import { ListExample } from './list-example';

describe('ListExample', () => {
  it('renders the title and category', async () => {
    // renderOnce(), not render(): the heading/badge text is projected into
    // dolan's ui-text/ui-badge, and render()'s extra tick can reset a freshly
    // created child's bound state — see test-utils/render-once.ts.
    const { container, destroy } = await renderOnce(ListExample);
    expect(container.textContent).toContain('List');
    expect(container.textContent).toContain('Elements');
    destroy();
  });

  it('seeds with 10 members', async () => {
    const { componentRef } = await render(ListExample);
    const instance = componentRef.instance as ListExample;
    expect(instance.members()).toHaveLength(10);
  });

  it('onlineCount() reflects the seeded online members', async () => {
    const { componentRef } = await render(ListExample);
    const instance = componentRef.instance as ListExample;
    // 6 of the 10 seed members start online.
    expect(instance.onlineCount()).toBe(6);
  });

  it('addMember() appends a member with a fresh id', async () => {
    const { componentRef } = await render(ListExample);
    const instance = componentRef.instance as ListExample;

    instance.addMember();
    await waitForUpdate();
    expect(instance.members()).toHaveLength(11);
    expect(instance.members()[10].id).toBe('11');
  });

  it('remove() drops the member with the given id', async () => {
    const { componentRef } = await render(ListExample);
    const instance = componentRef.instance as ListExample;

    instance.remove('1');
    await waitForUpdate();
    expect(instance.members()).toHaveLength(9);
    expect(instance.members().some((m) => m.id === '1')).toBe(false);
  });

  it('toggleOnline() flips a member online/away', async () => {
    const { componentRef } = await render(ListExample);
    const instance = componentRef.instance as ListExample;

    const before = instance.members()[0].online;
    instance.toggleOnline('1');
    await waitForUpdate();
    expect(instance.members()[0].online).toBe(!before);
  });

  it('reset() restores the seed after edits', async () => {
    const { componentRef } = await render(ListExample);
    const instance = componentRef.instance as ListExample;

    instance.addMember();
    instance.remove('2');
    await waitForUpdate();
    expect(instance.members()).toHaveLength(10);

    instance.reset();
    await waitForUpdate();
    expect(instance.members()).toHaveLength(10);
    expect(instance.members()[1].id).toBe('2');
  });

  it('initials() takes the first letter of the first two words', async () => {
    const { componentRef } = await render(ListExample);
    const instance = componentRef.instance as ListExample;
    expect(instance.initials('Ada Lovelace')).toBe('AL');
    expect(instance.initials('grace hopper')).toBe('GH');
  });

  it('avatarClass() is stable and includes a named color', async () => {
    const { componentRef } = await render(ListExample);
    const instance = componentRef.instance as ListExample;

    const first = instance.avatarClass('1');
    expect(first).toBe(instance.avatarClass('1'));
    expect(first).toMatch(/bg-[a-z]+-500/);
    expect(first).toContain('rounded-full');
  });
});
