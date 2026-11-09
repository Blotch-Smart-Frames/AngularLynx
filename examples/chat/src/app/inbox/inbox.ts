import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiIcon } from '../../components/ui/icon';
import type { Letter } from '../data/letters';
import { postmarkTime } from '../post/format';
import { AirmailEdge, Postmark, Stamp } from '../post/marks';
import { ChatState } from '../state/chat-state';

/**
 * The inbox: a stack of airmail envelopes, the latest letter first. Each is
 * addressed by hand to the contact, carries their stamp struck by the
 * postmark of the last letter's time, and opens with the letter's first
 * line. An envelope with letters unread is edged in red and blue.
 */
@Component({
  selector: 'app-inbox',
  imports: [LYNX_ELEMENTS, AirmailEdge, Postmark, Stamp, UiIcon],
  host: { class: 'flex flex-1 flex-col bg-paper' },
  template: `
    <view class="flex flex-col px-4 pt-safe-3 pb-3">
      <view class="flex flex-row items-center justify-between">
        <view class="flex flex-row items-center">
          <text
            class="font-postal text-[34px] leading-[38px] tracking-[1px] text-ink"
            accessibility-traits="header"
            >Letters</text
          >
          <!-- The PAR AVION label, as stuck on every airmail envelope:
               white, edged in the airmail chevrons, lettered in blue. -->
          <view class="ml-3 flex flex-col bg-envelope shadow-letter">
            <app-airmail-edge [length]="78" [thickness]="4" />
            <text
              class="px-2 py-[3px] text-center font-postal text-[12px] tracking-[2px] text-airmail-blue"
              >PAR AVION</text
            >
            <app-airmail-edge [length]="78" [thickness]="4" />
          </view>
        </view>
        <view
          class="flex h-11 w-11 items-center justify-center"
          (bindtap)="searching.set(!searching())"
          accessibility-element="true"
          accessibility-traits="button"
          [attr.accessibility-label]="
            searching() ? 'Close search' : 'Search letters'
          "
        >
          <ui-icon
            [name]="searching() ? 'x' : 'search'"
            size="md"
            class="text-ink"
          />
        </view>
      </view>
      @if (searching()) {
        <view
          class="mt-2 flex flex-row items-center border-b border-ink/30 pb-1"
        >
          <input
            class="h-9 flex-1 text-[16px] text-ink"
            placeholder="Search by name, city or a word"
            [value]="query()"
            (bindinput)="query.set($event.detail.value)"
            accessibility-label="Search letters"
          />
        </view>
      }
    </view>

    <list
      class="flex-1"
      list-type="single"
      accessibility-label="Correspondence"
    >
      @for (
        item of envelopes();
        track item.correspondent.id;
        let index = $index
      ) {
        <list-item
          [attr.item-key]="item.correspondent.id"
          [attr.estimated-main-axis-size-px]="132"
        >
          <view class="px-4 pb-3">
            <view
              class="relative flex flex-col bg-envelope shadow-letter"
              (bindtap)="open(item.correspondent.id)"
              accessibility-element="true"
              accessibility-traits="button"
              [attr.accessibility-label]="label(item)"
            >
              @if (item.unread) {
                <app-airmail-edge [length]="envelopeWidth()" [thickness]="6" />
              }
              <view class="flex flex-row px-4 pt-3 pb-4">
                <view class="flex flex-1 flex-col pr-3">
                  <text
                    class="font-hand text-[23px] leading-[30px] text-ellipsis text-ink"
                    [text-maxline]="1"
                    >{{ item.correspondent.name }}</text
                  >
                  <!-- The address, in the same hand as the name. -->
                  <text
                    class="font-hand text-[16px] leading-[24px] text-ellipsis text-ink-muted"
                    [text-maxline]="1"
                    >{{ item.correspondent.city }},
                    {{ item.correspondent.country }}</text
                  >
                  <text
                    class="mt-2 text-[14px] leading-[19px] text-ellipsis"
                    [class.text-ink]="item.unread"
                    [class.text-ink-muted]="!item.unread"
                    [text-maxline]="2"
                    >{{ preview(item) }}</text
                  >
                </view>
                <!-- The stamp, top right, struck by the last postmark. A
                     component's host keeps its own position class, so each
                     is placed by a view around it. -->
                <view class="relative" style="width: 92px; height: 76px">
                  <view class="absolute" style="right: 0; top: 0">
                    <app-stamp
                      [color]="item.correspondent.stamp.color"
                      [motif]="item.correspondent.stamp.motif"
                      [value]="item.correspondent.stamp.value"
                      [size]="48"
                    />
                  </view>
                  <!-- After the stamp, so its ring lands over the stamp's
                       corner; the town and time stay on the envelope. -->
                  <view class="absolute" style="left: 0; top: 28px">
                    <app-postmark
                      [top]="item.correspondent.city.toUpperCase()"
                      [middle]="time(item.last)"
                      [size]="48"
                      [tilt]="-10 + (index % 3) * 6"
                      [plain]="true"
                    />
                  </view>
                </view>
              </view>
              @if (item.unread) {
                <view
                  class="absolute flex items-center justify-center bg-airmail-red"
                  style="left: 16px; bottom: -8px; height: 18px; min-width: 18px; padding: 0 6px"
                >
                  <text class="font-postal text-[12px] text-paper">{{
                    item.unread
                  }}</text>
                </view>
              }
            </view>
          </view>
        </list-item>
      }
    </list>
  `,
})
export class Inbox {
  protected readonly chat = inject(ChatState);
  readonly #router = inject(Router);

  protected readonly searching = signal(false);
  protected readonly query = signal('');
  /** An envelope runs the screen's width less its margins. */
  protected readonly envelopeWidth = signal(
    Math.max(240, (globalThis.innerWidth || 402) - 32),
  );

  protected readonly envelopes = computed(() => {
    const query = this.searching() ? this.query().trim().toLowerCase() : '';
    const all = this.chat.inbox();
    if (!query) return all;
    return all.filter(
      ({ correspondent: c }) =>
        c.name.toLowerCase().includes(query) ||
        c.city.toLowerCase().includes(query) ||
        this.chat
          .letters(c.id)
          .some((l) => l.text.toLowerCase().includes(query)),
    );
  });

  protected open(id: string): void {
    this.#router.navigate(['/letters', id]);
  }

  protected time(letter: Letter): string {
    return postmarkTime(letter.at);
  }

  protected preview(item: { last: Letter; writing: boolean }): string {
    if (item.writing) return 'Writing to you…';
    const { last } = item;
    const text = last.photo ? 'A postcard' : last.text;
    return last.from === 'me' ? `You: ${text}` : text;
  }

  protected label(item: {
    correspondent: { name: string; city: string };
    last: Letter;
    unread: number;
  }): string {
    const unread = item.unread ? `, ${item.unread} unread` : '';
    return `${item.correspondent.name}, ${item.correspondent.city}${unread}. ${this.preview({ last: item.last, writing: false })}`;
  }
}
