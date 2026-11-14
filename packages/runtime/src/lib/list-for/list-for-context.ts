/**
 * The context of each item `*lynxListFor` shows, as `NgForOf`'s and the CDK's
 * `cdkVirtualFor`'s: `let item` is `$implicit`, and `let i = index`,
 * `count`, `first`, `last`, `even` and `odd` read the rest.
 *
 * One context belongs to one view, which shows one item after another as
 * native reuses its element: the directive sets the item and index on it
 * when native asks for the item, and again when the data changes while the
 * item is on screen.
 */
export class LynxListForContext<T> {
  constructor(
    /** The item. */
    public $implicit: T,
    /** All the items, as `lynxListForOf` gave them. */
    public lynxListForOf: readonly T[],
    /** The item's index in them. */
    public index: number,
    /** How many there are. */
    public count: number,
  ) {}

  get first(): boolean {
    return this.index === 0;
  }

  get last(): boolean {
    return this.index === this.count - 1;
  }

  get even(): boolean {
    return this.index % 2 === 0;
  }

  get odd(): boolean {
    return !this.even;
  }
}
