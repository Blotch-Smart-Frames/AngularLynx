import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiProgress } from '../components/ui/progress';
import { UiRadioGroup, UiRadioGroupItem } from '../components/ui/radio-group';
import { UiCheckbox } from '../components/ui/checkbox';
import { UiButton } from '../components/ui/button';
import {
  UiCard,
  UiCardContent,
  UiCardHeader,
  UiCardTitle,
} from '../components/ui/card';
import { UiSeparator } from '../components/ui/separator';
import { UiLabel } from '../components/ui/label';

type Role = 'developer' | 'designer' | 'manager' | 'founder';

@Component({
  selector: 'app-root',
  imports: [
    LYNX_ELEMENTS,
    UiProgress,
    UiRadioGroup,
    UiRadioGroupItem,
    UiCheckbox,
    UiButton,
    UiCard,
    UiCardContent,
    UiCardHeader,
    UiCardTitle,
    UiSeparator,
    UiLabel,
  ],
  template: `
    <scroll-view scroll-orientation="vertical" class="h-screen bg-zinc-50">
      <view class="flex-col gap-6 p-6 flex">
        <view class="flex-col gap-2 flex">
          <view class="flex-row flex justify-between">
            <text class="text-sm text-zinc-500">
              Step {{ step() }} of {{ totalSteps }}
            </text>
            <text class="text-sm text-zinc-500">
              {{ Math.round(progress()) }}%
            </text>
          </view>
          <ui-progress [value]="progress()" />
        </view>

        @if (step() === 1) {
          <view class="flex-col items-center gap-3 py-8 flex">
            <text class="text-[48px]">👋</text>
            <text class="text-[26px] font-bold text-zinc-900 text-center">
              Welcome to AngularLynx
            </text>
            <text class="text-sm leading-5 text-zinc-500 text-center">
              Let's personalize your experience. This only takes a minute.
            </text>
          </view>
        }

        @if (step() === 2) {
          <view class="flex-col gap-4 flex">
            <text class="text-[22px] font-bold text-zinc-900">
              What's your role?
            </text>
            <ui-radio-group [(value)]="role">
              <view class="flex-col gap-2.5 flex">
                @for (opt of roles; track opt.value) {
                  <view
                    class="flex-row items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 flex"
                  >
                    <!--
                      No [id] here: Lynx has no HTML-style label/for-id association, so
                      it was a dead no-op. The label + description stack vertically beside
                      the circle, and the item's ng-content sits inside a <text> (which
                      can't hold a nested view), so the block stays a sibling rather than
                      moving inside the item.
                    -->
                    <ui-radio-group-item [value]="opt.value" />
                    <view class="flex-1 flex-col gap-0.5 flex">
                      <ui-label>{{ opt.label }}</ui-label>
                      <text class="text-xs text-zinc-400">{{ opt.desc }}</text>
                    </view>
                  </view>
                }
              </view>
            </ui-radio-group>
          </view>
        }

        @if (step() === 3) {
          <view class="flex-col gap-4 flex">
            <text class="text-[22px] font-bold text-zinc-900">
              What are you building?
            </text>
            <text class="text-sm text-zinc-500">Select all that apply.</text>
            <view class="flex-col gap-2.5 flex">
              @for (opt of interests; track opt.value) {
                <view
                  class="flex-row items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 flex"
                  [class.border-indigo-500]="
                    selectedInterests().includes(opt.value)
                  "
                  [class.bg-indigo-50]="selectedInterests().includes(opt.value)"
                  (bindtap)="toggleInterest(opt.value)"
                >
                  <ui-checkbox
                    [checked]="selectedInterests().includes(opt.value)"
                    (checkedChange)="toggleInterest(opt.value)"
                  />
                  <view class="flex-1 flex-col gap-0.5 flex">
                    <text class="text-sm font-medium text-zinc-900">{{
                      opt.label
                    }}</text>
                    <text class="text-xs text-zinc-400">{{ opt.desc }}</text>
                  </view>
                </view>
              }
            </view>
          </view>
        }

        @if (step() === 4) {
          <view class="flex-col gap-4 flex">
            <text class="text-[22px] font-bold text-zinc-900">
              You're all set! 🎉
            </text>
            <ui-card>
              <ui-card-header
                ><ui-card-title>Your Profile</ui-card-title>
              </ui-card-header>
              <ui-card-content>
                <view class="flex-col gap-3 flex">
                  <view class="flex-row flex justify-between">
                    <text class="text-sm text-zinc-500">Role</text>
                    <text class="text-sm font-medium text-zinc-900">{{
                      roleName()
                    }}</text>
                  </view>
                  <ui-separator />
                  <view class="flex-col gap-1 flex">
                    <text class="text-sm text-zinc-500">Interests</text>
                    <text class="text-sm font-medium text-zinc-900">{{
                      interestNames()
                    }}</text>
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
          @if (step() < totalSteps) {
            <ui-button class="flex-1" (pressed)="next()">{{
              step() === 1 ? 'Get Started' : 'Continue'
            }}</ui-button>
          } @else {
            <ui-button class="flex-1" (pressed)="finish()">Finish</ui-button>
          }
        </view>
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly Math = Math;
  readonly totalSteps = 4;
  readonly step = signal(1);
  readonly role = signal<Role>('developer');
  readonly selectedInterests = signal<string[]>([]);

  readonly roles = [
    {
      value: 'developer',
      label: 'Developer',
      desc: 'Building apps and features',
    },
    {
      value: 'designer',
      label: 'Designer',
      desc: 'Creating UI/UX experiences',
    },
    { value: 'manager', label: 'Manager', desc: 'Leading a product team' },
    {
      value: 'founder',
      label: 'Founder',
      desc: 'Running a company or startup',
    },
  ];

  readonly interests = [
    {
      value: 'mobile',
      label: 'Mobile App',
      desc: 'iOS and Android native apps',
    },
    { value: 'web', label: 'Web App', desc: 'Browser-based applications' },
    { value: 'mini', label: 'Mini App', desc: 'In-platform lightweight apps' },
    {
      value: 'dashboard',
      label: 'Dashboard',
      desc: 'Data visualization & analytics',
    },
  ];

  readonly progress = computed(
    () => ((this.step() - 1) / (this.totalSteps - 1)) * 100,
  );
  readonly roleName = computed(
    () => this.roles.find((r) => r.value === this.role())?.label ?? '',
  );
  readonly interestNames = computed(() =>
    this.selectedInterests().length === 0
      ? 'None selected'
      : this.interests
          .filter((i) => this.selectedInterests().includes(i.value))
          .map((i) => i.label)
          .join(', '),
  );

  toggleInterest(value: string): void {
    this.selectedInterests.update((list) =>
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    );
  }

  next(): void {
    this.step.update((s) => Math.min(s + 1, this.totalSteps));
  }
  back(): void {
    this.step.update((s) => Math.max(s - 1, 1));
  }
  finish(): void {
    this.step.set(1);
    this.role.set('developer');
    this.selectedInterests.set([]);
  }
}
