import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import {
  UiAccordion,
  UiAccordionItem,
  UiAccordionTrigger,
  UiAccordionContent,
} from '../components/ui/accordion';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiAccordion,
    UiAccordionItem,
    UiAccordionTrigger,
    UiAccordionContent,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-6 p-6 flex">
        <text class="text-2xl font-bold text-foreground">Accordion</text>
        <text class="text-sm text-muted-foreground">
          A vertically stacked set of interactive headings that reveal content.
        </text>

        <!-- Single-mode accordion (only one item open at a time) -->
        <view class="flex-col gap-2 flex">
          <text class="text-lg font-semibold text-foreground">
            Single Mode
          </text>
          <text class="text-xs text-muted-foreground">
            Only one item can be expanded at a time.
          </text>
        </view>

        <ui-accordion type="single">
          <ui-accordion-item value="item-1">
            <ui-accordion-trigger>Is it accessible?</ui-accordion-trigger>
            <ui-accordion-content>
              <text class="text-sm text-muted-foreground">
                Yes. All components follow WAI-ARIA patterns and support
                keyboard navigation.
              </text>
            </ui-accordion-content>
          </ui-accordion-item>
          <ui-accordion-item value="item-2">
            <ui-accordion-trigger>Is it styled?</ui-accordion-trigger>
            <ui-accordion-content>
              <text class="text-sm text-muted-foreground">
                Yes. Components are styled with Tailwind CSS and support theming
                through CSS custom properties.
              </text>
            </ui-accordion-content>
          </ui-accordion-item>
          <ui-accordion-item value="item-3">
            <ui-accordion-trigger>Can I customize it?</ui-accordion-trigger>
            <ui-accordion-content>
              <text class="text-sm text-muted-foreground">
                Absolutely. Every component accepts a class input for additional
                Tailwind overrides.
              </text>
            </ui-accordion-content>
          </ui-accordion-item>
        </ui-accordion>

        <!-- Multiple-mode accordion (multiple items can be open) -->
        <view class="mt-4 flex-col gap-2 flex">
          <text class="text-lg font-semibold text-foreground">
            Multiple Mode
          </text>
          <text class="text-xs text-muted-foreground">
            Multiple items can be expanded simultaneously.
          </text>
        </view>

        <ui-accordion type="multiple">
          <ui-accordion-item value="multi-1">
            <ui-accordion-trigger>First Section</ui-accordion-trigger>
            <ui-accordion-content>
              <text class="text-sm text-muted-foreground">
                This section can stay open while you expand others.
              </text>
            </ui-accordion-content>
          </ui-accordion-item>
          <ui-accordion-item value="multi-2">
            <ui-accordion-trigger>Second Section</ui-accordion-trigger>
            <ui-accordion-content>
              <text class="text-sm text-muted-foreground">
                Open this alongside the first section to see multiple mode in
                action.
              </text>
            </ui-accordion-content>
          </ui-accordion-item>
          <ui-accordion-item value="multi-3">
            <ui-accordion-trigger>Third Section</ui-accordion-trigger>
            <ui-accordion-content>
              <text class="text-sm text-muted-foreground">
                All three sections can be open at the same time.
              </text>
            </ui-accordion-content>
          </ui-accordion-item>
        </ui-accordion>
      </view>
    </scroll-view>
  `,
})
export class App {}
