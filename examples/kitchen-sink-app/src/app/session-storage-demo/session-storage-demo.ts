import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxSessionStorage } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../components/ui/card';
import { UiSeparator } from '../../components/ui/separator';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

/**
 * One entry in the activity feed. We surface every read/write so the demo
 * visibly shows storage reacting — otherwise session storage is invisible and
 * the screen looks static (the point of the redesign).
 */
type Activity = {
  readonly id: number;
  readonly kind: 'write' | 'read';
  readonly message: string;
};

@Component({
  selector: 'app-session-storage-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [
    LYNX_ELEMENTS,
    DemoScreen,
    UiBadge,
    UiButton,
    UiCard,
    UiCardContent,
    UiCardDescription,
    UiCardHeader,
    UiCardTitle,
    UiSeparator,
    UiText,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-storage-demo.html',
})
export class SessionStorageDemo {
  readonly #sessionStorage = inject(LynxSessionStorage);

  /**
   * The shared key. Surfaced in the UI (and reused for every call below) so the
   * demo is self-documenting — you can see exactly which key is being read and
   * written. Declared before `counter` because the field initializer reads it.
   */
  readonly key = 'counter';

  // Reactive signal that auto-updates when any LynxView writes to "counter".
  readonly counter = this.#sessionStorage.watch<number>(this.key);

  // One-shot read result, shown verbatim in the read card.
  readonly lastRead = signal<string>('Not read yet');

  // How many writes this session has issued.
  readonly writeCount = signal(0);

  // Newest-first feed of reads/writes, capped so it stays short and scannable.
  readonly activity = signal<readonly Activity[]>([]);
  #nextActivityId = 0;

  increment(): void {
    const next = (this.counter() ?? 0) + 1;
    this.#sessionStorage.setItem(this.key, next);
    this.writeCount.update((v) => v + 1);
    this.#log('write', `Set ${this.key} = ${next}`);
  }

  reset(): void {
    this.#sessionStorage.setItem(this.key, 0);
    this.writeCount.update((v) => v + 1);
    this.#log('write', `Reset ${this.key} to 0`);
  }

  async readOnce(): Promise<void> {
    try {
      const value = await this.#sessionStorage.getItem<number>(this.key);
      const text = `${this.key} = ${value ?? 'undefined'}`;
      this.lastRead.set(text);
      this.#log('read', `Read ${text}`);
    } catch {
      this.lastRead.set('Not available in this environment');
      this.#log('read', 'Read failed — not available here');
    }
  }

  /**
   * Prepend an entry, keeping only the most recent few so the feed stays tidy.
   */
  #log(kind: Activity['kind'], message: string): void {
    const entry: Activity = { id: this.#nextActivityId++, kind, message };
    this.activity.update((list) => [entry, ...list].slice(0, 6));
  }
}
