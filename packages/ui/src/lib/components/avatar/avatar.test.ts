import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { describe, expect, it } from 'vitest';
import { fireLynxEvent } from '../../../test-utils/fire-lynx-event';
import { UiAvatar } from './avatar';

type AvatarSize = 'default' | 'sm' | 'lg' | 'xl' | '2xl';

@Component({
  imports: [UiAvatar],
  template: `
    <ui-avatar [src]="src()" fallback="AB" [size]="size()" class="border" />
  `,
})
class AvatarHost {
  readonly src = signal('');
  readonly size = signal<AvatarSize>('default');
}

const renderAvatar = async (src = '') => {
  const result = await render(AvatarHost);
  const host = result.componentRef.instance as AvatarHost;
  host.src.set(src);
  await waitForUpdate();
  return {
    ...result,
    host,
    avatar: () => result.container.querySelector('.overflow-hidden')!,
    image: () => result.container.querySelector('image'),
    /** The pulsing placeholder over the image while it loads. */
    skeleton: () => result.container.querySelector('.inset-0'),
    initials: () => result.queryByText('AB'),
  };
};

describe('UiAvatar', () => {
  it('shows the initials in a muted circle without an image', async () => {
    const { avatar, image, initials } = await renderAvatar();
    expect(image()).toBeNull();
    expect(initials()?.parentElement?.classList).toContain('bg-muted');
    expect(avatar().classList).toContain('border');
  });

  // A class on a component lands on its host too (issue #181): the host is
  // the circle, so the border is drawn once.
  it('puts its class on one element, the circle', async () => {
    const { container, avatar } = await renderAvatar();
    expect([...container.querySelectorAll('.border')]).toEqual([avatar()]);
  });

  it('covers the image with a placeholder while it loads', async () => {
    const { image, skeleton, initials } = await renderAvatar(
      'https://example.com/avatar.png',
    );
    expect(image()?.getAttribute('src')).toBe('https://example.com/avatar.png');
    expect(skeleton()).not.toBeNull();
    expect(initials()).toBeNull();
  });

  it('reveals the image once it loads', async () => {
    const { image, skeleton, initials } = await renderAvatar(
      'https://example.com/avatar.png',
    );
    fireLynxEvent(image()!, 'load');
    await waitForUpdate();
    expect(skeleton()).toBeNull();
    expect(image()).not.toBeNull();

    // Lynx can dispatch `load` again as the placeholder's animation stops:
    // the avatar stays as it is.
    fireLynxEvent(image()!, 'load');
    await waitForUpdate();
    expect(skeleton()).toBeNull();
    expect(image()).not.toBeNull();
    expect(initials()).toBeNull();
  });

  it('falls back to the initials when the image fails to load', async () => {
    const { image, skeleton, initials } = await renderAvatar(
      'https://example.com/missing.png',
    );
    // Lynx can dispatch the event again before the avatar updates, as the
    // placeholder's animation stops: the second one changes nothing.
    fireLynxEvent(image()!, 'error', { detail: { errMsg: 'Not found' } });
    fireLynxEvent(image()!, 'error', { detail: { errMsg: 'Not found' } });
    await waitForUpdate();
    expect(image()).toBeNull();
    expect(skeleton()).toBeNull();
    expect(initials()).not.toBeNull();
  });

  it.each<[AvatarSize, string, string]>([
    ['sm', 'h-8', 'text-sm'],
    ['default', 'h-10', 'text-sm'],
    ['lg', 'h-14', 'text-lg'],
    ['xl', 'h-20', 'text-2xl'],
    ['2xl', 'h-28', 'text-3xl'],
  ])('sizes a %s avatar and its initials', async (size, height, text) => {
    const { host, avatar, initials } = await renderAvatar();
    host.size.set(size);
    await waitForUpdate();
    expect(avatar().classList).toContain(height);
    expect(initials()?.classList).toContain(text);
  });

  it.each<[AvatarSize, string]>([
    ['sm', 'h-8'],
    ['default', 'h-10'],
    ['lg', 'h-14'],
    ['xl', 'h-20'],
    ['2xl', 'h-28'],
  ])('sizes the image of a %s avatar', async (size, height) => {
    const { host, image } = await renderAvatar(
      'https://example.com/avatar.png',
    );
    host.size.set(size);
    await waitForUpdate();
    expect(image()?.classList).toContain(height);
  });
});
