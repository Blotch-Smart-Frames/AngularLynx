import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiButton } from '../components/ui/button';
import { UiWizard, UiWizardStep } from '../components/ui/wizard';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS, UiButton, UiWizard, UiWizardStep],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-full">
      <view class="flex-col gap-8 p-4 flex">
        <view class="flex-col gap-2 flex">
          <text class="text-2xl font-bold text-foreground">Wizard</text>
          <text class="text-sm text-muted-foreground">
            A task split into steps, under an indicator that shows three at a
            time.
          </text>
        </view>

        <!-- More than three steps: the indicator slides as each is done -->
        <view class="flex-col gap-4 flex">
          <text class="text-lg font-semibold text-foreground">
            Create an account
          </text>
          <ui-wizard #account [(step)]="accountStep">
            @for (item of accountSteps; track item.label) {
              <ui-wizard-step [label]="item.label">
                <view class="flex-col gap-1 rounded-xl bg-muted p-4 flex">
                  <text class="text-base font-semibold text-foreground">
                    {{ item.title }}
                  </text>
                  <text class="text-sm text-muted-foreground">
                    {{ item.text }}
                  </text>
                </view>
              </ui-wizard-step>
            }
          </ui-wizard>
          <view class="flex-row gap-3 flex">
            <ui-button
              variant="outline"
              class="flex-1"
              [disabled]="account.isFirst()"
              (pressed)="account.previous()"
            >
              Back
            </ui-button>
            <ui-button
              class="flex-1"
              (pressed)="account.isLast() ? account.goTo(0) : account.next()"
            >
              {{ account.isLast() ? 'Start over' : 'Continue' }}
            </ui-button>
          </view>
          <text class="text-sm text-muted-foreground">
            Step {{ accountStep() + 1 }} of {{ accountSteps.length }}
          </text>
        </view>

        <!-- Three steps fit, so nothing slides or fades -->
        <view class="flex-col gap-4 flex">
          <text class="text-lg font-semibold text-foreground">Checkout</text>
          <ui-wizard #checkout [(step)]="checkoutStep">
            <ui-wizard-step label="Cart">
              <text class="text-base text-foreground">
                Two items, ready to send.
              </text>
            </ui-wizard-step>
            <ui-wizard-step label="Delivery">
              <text class="text-base text-foreground">
                Arrives Thursday, to your door.
              </text>
            </ui-wizard-step>
            <ui-wizard-step label="Payment">
              <text class="text-base text-foreground">
                Paid with the card ending 4242.
              </text>
            </ui-wizard-step>
          </ui-wizard>
          <view class="flex-row gap-3 flex">
            <ui-button
              variant="outline"
              class="flex-1"
              [disabled]="checkout.isFirst()"
              (pressed)="checkout.previous()"
            >
              Back
            </ui-button>
            <ui-button
              class="flex-1"
              [disabled]="checkout.isLast()"
              (pressed)="checkout.next()"
            >
              Next
            </ui-button>
          </view>
        </view>

        <!-- Only the indicator: steps with no label and no content -->
        <view class="flex-col gap-4 flex">
          <text class="text-lg font-semibold text-foreground">
            Without labels
          </text>
          <ui-wizard #survey [(step)]="surveyStep" class="gap-0">
            @for (question of questions; track question) {
              <ui-wizard-step />
            }
          </ui-wizard>
          <view class="flex-row gap-3 flex">
            <ui-button
              variant="outline"
              class="flex-1"
              [disabled]="survey.isFirst()"
              (pressed)="survey.previous()"
            >
              Back
            </ui-button>
            <ui-button
              class="flex-1"
              [disabled]="survey.isLast()"
              (pressed)="survey.next()"
            >
              Next
            </ui-button>
          </view>
          <text class="text-sm text-muted-foreground">
            Question {{ surveyStep() + 1 }} of {{ questions.length }}
          </text>
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  protected readonly accountStep = signal(0);
  protected readonly checkoutStep = signal(0);
  protected readonly surveyStep = signal(0);

  protected readonly accountSteps = [
    {
      label: 'Account',
      title: 'Your account',
      text: 'An email address and a password to sign in with.',
    },
    {
      label: 'Profile',
      title: 'About you',
      text: 'Your name and a photo, as other people see them.',
    },
    {
      label: 'Plan',
      title: 'Choose a plan',
      text: 'Free to start. Change it whenever you like.',
    },
    {
      label: 'Payment',
      title: 'Payment',
      text: 'A card for when the free month ends.',
    },
    {
      label: 'Review',
      title: 'Check it over',
      text: 'One last look before the account is made.',
    },
  ];

  protected readonly questions = [1, 2, 3, 4, 5, 6, 7, 8];
}
