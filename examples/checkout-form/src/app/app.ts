import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiInput } from '../components/ui/input';
import { UiLabel } from '../components/ui/label';
import { UiSelect, UiSelectItem } from '../components/ui/select';
import { UiRadioGroup, UiRadioGroupItem } from '../components/ui/radio-group';
import {
  UiCard,
  UiCardHeader,
  UiCardTitle,
  UiCardContent,
} from '../components/ui/card';
import { UiProgress } from '../components/ui/progress';
import { UiButton } from '../components/ui/button';
import { UiCheckbox } from '../components/ui/checkbox';
import { UiSeparator } from '../components/ui/separator';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiInput,
    UiLabel,
    UiSelect,
    UiSelectItem,
    UiRadioGroup,
    UiRadioGroupItem,
    UiCard,
    UiCardHeader,
    UiCardTitle,
    UiCardContent,
    UiProgress,
    UiButton,
    UiCheckbox,
    UiSeparator,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-screen bg-zinc-50">
      <view class="flex-col gap-6 p-6 flex">
        <view class="flex-col gap-2 flex">
          <view class="flex-row flex justify-between">
            <text class="text-sm font-medium text-zinc-900">
              Step {{ step() }} of 3
            </text>
            <text class="text-sm text-zinc-500">{{ stepLabel() }}</text>
          </view>
          <ui-progress [value]="progress()" />
        </view>

        @if (step() === 1) {
          <view class="flex-col gap-4 flex">
            <text class="text-[22px] font-bold text-zinc-900">
              Shipping Address
            </text>
            <view class="flex-col gap-1.5 flex">
              <ui-label>Full Name</ui-label>
              <ui-input [(value)]="name" placeholder="Jane Smith" />
            </view>
            <view class="flex-col gap-1.5 flex">
              <ui-label>Street Address</ui-label>
              <ui-input [(value)]="street" placeholder="123 Main St" />
            </view>
            <view class="flex-row gap-3 flex">
              <view class="flex-1 flex-col gap-1.5 flex">
                <ui-label>City</ui-label>
                <ui-input [(value)]="city" placeholder="New York" />
              </view>
              <view class="w-24 flex-col gap-1.5 flex">
                <ui-label>ZIP</ui-label>
                <ui-input [(value)]="zip" placeholder="10001" />
              </view>
            </view>
            <view class="flex-col gap-1.5 flex">
              <ui-label>Country</ui-label>
              <ui-select [(value)]="country">
                <ui-select-item value="us" label="United States" />
                <ui-select-item value="ca" label="Canada" />
                <ui-select-item value="gb" label="United Kingdom" />
              </ui-select>
            </view>
          </view>
        }

        @if (step() === 2) {
          <view class="flex-col gap-4 flex">
            <text class="text-[22px] font-bold text-zinc-900">Payment</text>
            <view class="flex-col gap-2.5 flex">
              <ui-label>Payment Method</ui-label>
              <ui-radio-group [(value)]="paymentMethod">
                <view class="flex-col gap-2 flex">
                  @for (opt of paymentOptions; track opt.value) {
                    <view
                      class="flex-row items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-4 py-3 flex"
                    >
                      <!--
                        The label lives inside ui-radio-group-item (via ng-content),
                        not as a sibling ui-label. Lynx has no HTML-style label/for-id
                        association, and the item's whole row is tappable to select — so
                        keeping the text inside makes the label tappable too.
                      -->
                      <ui-radio-group-item [value]="opt.value">{{
                        opt.label
                      }}</ui-radio-group-item>
                    </view>
                  }
                </view>
              </ui-radio-group>
            </view>
            @if (paymentMethod() === 'card') {
              <view class="flex-col gap-3 flex">
                <view class="flex-col gap-1.5 flex">
                  <ui-label>Card Number</ui-label>
                  <ui-input
                    [(value)]="cardNumber"
                    placeholder="4242 4242 4242 4242"
                  />
                </view>
                <view class="flex-row gap-3 flex">
                  <view class="flex-1 flex-col gap-1.5 flex">
                    <ui-label>Expiry</ui-label>
                    <ui-input [(value)]="expiry" placeholder="MM/YY" />
                  </view>
                  <view class="w-24 flex-col gap-1.5 flex">
                    <ui-label>CVV</ui-label>
                    <ui-input [(value)]="cvv" placeholder="123" />
                  </view>
                </view>
              </view>
            }
            <!--
              No id/for pairing: Lynx has no HTML-style label/for association, so these
              were dead attributes. ui-checkbox has its own tap area (no label slot to
              nest into), so the label stays a sibling.
            -->
            <view class="flex-row items-center gap-2.5 flex">
              <ui-checkbox [(checked)]="agreeTerms" />
              <ui-label>I agree to the Terms of Service</ui-label>
            </view>
          </view>
        }

        @if (step() === 3) {
          <view class="flex-col gap-4 flex">
            <text class="text-[22px] font-bold text-zinc-900">
              Order Summary
            </text>
            <ui-card>
              <ui-card-header
                ><ui-card-title>Items</ui-card-title>
              </ui-card-header>
              <ui-card-content>
                <view class="flex-col gap-2.5 flex">
                  <view class="flex-row flex justify-between">
                    <text class="text-sm text-zinc-900">
                      AngularLynx Pro Plan
                    </text>
                    <text class="text-sm font-medium text-zinc-900"
                      >$99.00
                    </text>
                  </view>
                  <view class="flex-row flex justify-between">
                    <text class="text-sm text-zinc-900">
                      Annual discount (20%)
                    </text>
                    <text class="text-sm text-green-600">-$19.80</text>
                  </view>
                  <ui-separator />
                  <view class="flex-row flex justify-between">
                    <text class="text-sm font-bold text-zinc-900">Total</text>
                    <text class="text-sm font-bold text-zinc-900">$79.20</text>
                  </view>
                </view>
              </ui-card-content>
            </ui-card>
          </view>
        }

        <view class="flex-row gap-3 flex">
          @if (step() > 1) {
            <ui-button variant="outline" class="flex-1" (pressed)="back()">
              Back
            </ui-button>
          }
          @if (step() < 3) {
            <ui-button class="flex-1" (pressed)="next()">Continue</ui-button>
          } @else {
            <ui-button class="flex-1" (pressed)="placeOrder()">
              Place Order
            </ui-button>
          }
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly step = signal(1);
  readonly name = signal('');
  readonly street = signal('');
  readonly city = signal('');
  readonly zip = signal('');
  readonly country = signal('us');
  readonly paymentMethod = signal('card');
  readonly cardNumber = signal('');
  readonly expiry = signal('');
  readonly cvv = signal('');
  readonly agreeTerms = signal(false);

  readonly paymentOptions = [
    { value: 'card', label: 'Credit / Debit Card' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'apple', label: 'Apple Pay' },
  ];

  readonly progress = computed(() => (this.step() / 3) * 100);
  readonly stepLabel = computed(
    () => ['Shipping', 'Payment', 'Review'][this.step() - 1],
  );

  next(): void {
    this.step.update((s) => Math.min(s + 1, 3));
  }
  back(): void {
    this.step.update((s) => Math.max(s - 1, 1));
  }
  placeOrder(): void {
    this.step.set(1);
  }
}
