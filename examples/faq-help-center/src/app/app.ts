import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiAccordion,
  UiAccordionItem,
  UiAccordionTrigger,
  UiAccordionContent,
} from '../components/ui/accordion';
import {
  UiCollapsible,
  UiCollapsibleTrigger,
  UiCollapsibleContent,
} from '../components/ui/collapsible';
import { UiInput } from '../components/ui/input';
import {
  UiDialog,
  UiDialogHeader,
  UiDialogTitle,
  UiDialogDescription,
  UiDialogFooter,
} from '../components/ui/dialog';
import { UiButton } from '../components/ui/button';
import { UiTextarea } from '../components/ui/textarea';
import { UiLabel } from '../components/ui/label';

type FaqItem = { q: string; a: string };
type FaqCategory = { title: string; items: FaqItem[] };

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiAccordion,
    UiAccordionItem,
    UiAccordionTrigger,
    UiAccordionContent,
    UiCollapsible,
    UiCollapsibleTrigger,
    UiCollapsibleContent,
    UiInput,
    UiDialog,
    UiDialogHeader,
    UiDialogTitle,
    UiDialogDescription,
    UiDialogFooter,
    UiButton,
    UiTextarea,
    UiLabel,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-screen bg-zinc-50">
      <view class="flex-col gap-5 p-6 flex">
        <view class="flex-col gap-1 flex">
          <text class="text-[28px] font-bold text-zinc-900">Help Center</text>
          <text class="text-sm text-zinc-500">
            Find answers to common questions
          </text>
        </view>

        <ui-input
          [value]="query()"
          (valueChange)="query.set($event)"
          placeholder="Search FAQs..."
        />

        @for (cat of filtered(); track cat.title) {
          <view class="rounded-2xl border border-zinc-200 bg-white p-4">
            <ui-collapsible [open]="true">
              <ui-collapsible-trigger>
                <view
                  class="flex-row items-center gap-2 py-2 flex justify-between"
                >
                  <text class="text-base font-semibold text-zinc-900">{{
                    cat.title
                  }}</text>
                  <text class="text-xs text-zinc-400">
                    {{ cat.items.length }} items
                  </text>
                </view>
              </ui-collapsible-trigger>
              <ui-collapsible-content>
                <ui-accordion type="single">
                  @for (item of cat.items; track item.q) {
                    <ui-accordion-item [value]="item.q">
                      <ui-accordion-trigger>{{ item.q }}</ui-accordion-trigger>
                      <ui-accordion-content>
                        <text class="text-sm leading-5 text-zinc-500">{{
                          item.a
                        }}</text>
                      </ui-accordion-content>
                    </ui-accordion-item>
                  }
                </ui-accordion>
              </ui-collapsible-content>
            </ui-collapsible>
          </view>
        } @empty {
          <view class="flex-col items-center gap-2 py-10 flex">
            <text class="text-[32px]">🔍</text>
            <text class="text-sm text-zinc-400">
              No results for "{{ query() }}"
            </text>
          </view>
        }

        <view class="flex-col items-center gap-2 py-4 flex">
          <text class="text-[13px] text-zinc-500">
            Can't find what you need?
          </text>
          <ui-button variant="outline" (pressed)="contactOpen.set(true)">
            Contact Support
          </ui-button>
        </view>
      </view>
    </scroll-view>

    <ui-dialog [(open)]="contactOpen">
      <ui-dialog-header>
        <ui-dialog-title>Contact Support</ui-dialog-title>
        <ui-dialog-description>
          We'll get back to you within 24 hours.
        </ui-dialog-description>
      </ui-dialog-header>
      <view class="flex-col gap-4 p-4 flex">
        <view class="flex-col gap-1.5 flex">
          <ui-label>Subject</ui-label>
          <ui-input
            [(value)]="subject"
            placeholder="Brief description of your issue"
          />
        </view>
        <view class="flex-col gap-1.5 flex">
          <ui-label>Message</ui-label>
          <ui-textarea
            [(value)]="message"
            placeholder="Describe your issue in detail..."
          />
        </view>
      </view>
      <ui-dialog-footer>
        <ui-button variant="outline" (pressed)="contactOpen.set(false)">
          Cancel
        </ui-button>
        <ui-button (pressed)="sendMessage()">Send</ui-button>
      </ui-dialog-footer>
    </ui-dialog>
  `,
})
export class App {
  readonly query = signal('');
  readonly contactOpen = signal(false);
  readonly subject = signal('');
  readonly message = signal('');

  readonly categories: FaqCategory[] = [
    {
      title: 'Getting Started',
      items: [
        {
          q: 'What is AngularLynx?',
          a: 'AngularLynx lets you write Angular components that render natively on iOS, Android, and web using the Lynx runtime.',
        },
        {
          q: 'How do I install it?',
          a: 'Run `npm create angular-lynx my-app` to scaffold a new project with everything pre-configured.',
        },
        {
          q: 'Does it support all Angular APIs?',
          a: 'Yes — signals, routing, lazy loading, forms, and content projection all work out of the box.',
        },
      ],
    },
    {
      title: 'Building & Running',
      items: [
        {
          q: 'How do I start the dev server?',
          a: 'Run `npm start` in your project directory. The Lynx dev server hot-reloads on save.',
        },
        {
          q: 'How do I build for production?',
          a: 'Run `npm run build`. This outputs optimized lynx.bundle and web.bundle files.',
        },
      ],
    },
    {
      title: 'Components & Styling',
      items: [
        {
          q: 'Can I use @blotch/ui components?',
          a: 'Yes — import any component from @blotch/ui and use it directly in your templates.',
        },
        {
          q: 'Does Tailwind CSS work?',
          a: "Yes — @lynx-js/tailwind-preset adapts utility classes to Lynx's CSS subset.",
        },
      ],
    },
  ];

  readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    if (!q) return this.categories;
    return this.categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) =>
            item.q.toLowerCase().includes(q) ||
            item.a.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  });

  sendMessage(): void {
    this.subject.set('');
    this.message.set('');
    this.contactOpen.set(false);
  }
}
