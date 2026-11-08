/**
 * How a navigation changes the stack, when the app wants to say so itself.
 * Pass it as the navigation's `info`, which Angular keeps for the navigation
 * alone (it isn't saved in the history):
 *
 * ```html
 * <view routerLink="/item/3" [info]="{ stack: 'push' }">…</view>
 * ```
 *
 * ```ts
 * router.navigate(['/settings'], { info: { stack: 'root' } });
 * ```
 *
 * - `'push'`: opens the page on top of the stack, sliding it in.
 * - `'pop'`: goes back to the page, sliding the pages above it away. A page
 *   that isn't in the stack slides in from behind and starts a new stack.
 * - `'root'`: starts a new stack with the page, without a transition, as a tab
 *   bar does.
 */
export type StackNavigationInfo = {
  readonly stack?: 'push' | 'pop' | 'root';
};

/** What a navigation does to the stack (see {@link changeFor}). */
export type StackChange =
  /** The page goes on top. */
  | { readonly kind: 'push'; readonly animated: boolean }
  /** The pages above the one at `index` come off, back to it. */
  | { readonly kind: 'pop'; readonly index: number }
  /** The page takes the top one's place, at once. */
  | { readonly kind: 'replace' }
  /** The page starts a new stack, at once or sliding in from behind. */
  | { readonly kind: 'reset'; readonly animated: boolean };

/** What {@link changeFor} needs to know about a navigation. */
export type StackNavigation = {
  /** The URL of each page in the stack, the bottom one first. */
  readonly stack: readonly string[];
  /** The URL of the page the navigation shows. */
  readonly url: string;
  /** Whether the navigation came from the history (back or forward). */
  readonly popstate: boolean;
  /** Whether it went forward in the history, past the top page. */
  readonly forward: boolean;
  /** Whether it replaces the current history entry (`replaceUrl`). */
  readonly replaceUrl: boolean;
  /** What the app said it does, in the navigation's `info`. */
  readonly hint: StackNavigationInfo['stack'];
};

/**
 * Works out what a navigation does to the stack. The stack follows the URL,
 * like a navigation controller follows the hierarchy of an app's screens:
 *
 * - Going to a page that's in the stack goes back to it, whether through the
 *   history (Back, Android's back button, the swipe) or by a link to it, as a
 *   back button made of a `routerLink` to the screen it came from is.
 * - Going back in the history to a page that isn't in the stack (one a tab
 *   switch left) slides it in from behind, as a pop would.
 * - Replacing the URL (`replaceUrl`, as a sign-in redirect does) swaps the top
 *   page at once.
 * - Going deeper (a URL with more segments, like `/notes/3` from `/notes`)
 *   pushes the page. Going up to a URL the top page's is under (`/notes` from
 *   `/notes/3`, opened from a link) slides it in from behind.
 * - Anything else, a page at the same depth (`/settings` from `/home`), starts
 *   a new stack at once, as switching tabs does.
 *
 * The app overrides any of it with the navigation's `info`
 * ({@link StackNavigationInfo}).
 */
export const changeFor = (navigation: StackNavigation): StackChange => {
  const { stack, url, hint } = navigation;
  if (stack.length === 0) return { kind: 'push', animated: false };
  if (hint === 'root') return { kind: 'reset', animated: false };
  if (hint === 'push') return { kind: 'push', animated: true };

  const top = stack.at(-1)!;
  // The nearest page under the top one with this URL, or -1.
  const index = stack.lastIndexOf(url, stack.length - 2);
  if (index >= 0) return { kind: 'pop', index };
  if (hint === 'pop') return { kind: 'reset', animated: true };
  if (url === top) return { kind: 'replace' };

  if (navigation.popstate) {
    return navigation.forward
      ? { kind: 'push', animated: true }
      : { kind: 'reset', animated: true };
  }
  if (navigation.replaceUrl) return { kind: 'replace' };

  const depth = depthOf(url);
  const topDepth = depthOf(top);
  if (depth > topDepth) return { kind: 'push', animated: true };
  if (depth < topDepth && isUnder(top, url)) {
    return { kind: 'reset', animated: true };
  }
  return { kind: 'reset', animated: false };
};

/**
 * How many segments a URL's path has: 0 for `/`, 2 for `/notes/3`.
 */
const depthOf = (url: string): number =>
  url.split('/').filter((segment) => segment !== '').length;

/**
 * Whether `url` is under `ancestor`: `/notes/3` is under `/notes` and `/`.
 */
const isUnder = (url: string, ancestor: string): boolean =>
  url.startsWith(ancestor.endsWith('/') ? ancestor : `${ancestor}/`);
