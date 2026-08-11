import { Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

@Component({
  selector: 'app-root',
  imports: [LYNX_ELEMENTS],
  template: `
    <scroll-view class="h-screen bg-zinc-50" scroll-orientation="vertical">
      <view class="p-6">
        <text class="mb-1 text-[28px] font-bold text-zinc-900">
          Profile Form
        </text>
        <text class="mb-5 text-[13px] text-zinc-500">
          Input validation with signal-based state.
        </text>

        <view class="mb-5 rounded-xl border border-zinc-200 bg-white p-5">
          <text class="mb-1.5 text-[13px] font-semibold text-zinc-900">
            Name
          </text>
          <input
            class="rounded-lg border border-zinc-200 bg-white px-3.5 py-3 text-[15px]"
            [class.border-indigo-500]="focusedField() === 'name'"
            [class.border-red-500]="submitted() && !name()"
            placeholder="Enter your name"
            [value]="name()"
            (bindinput)="name.set($any($event).detail.value)"
            (bindfocus)="focusedField.set('name')"
            (bindblur)="focusedField.set(null)"
            confirm-type="next"
          />
          @if (submitted() && !name()) {
            <text class="mt-1 text-xs text-red-500">Name is required</text>
          }

          <text class="mb-1.5 mt-4 text-[13px] font-semibold text-zinc-900">
            Email
          </text>
          <input
            class="rounded-lg border border-zinc-200 bg-white px-3.5 py-3 text-[15px]"
            [class.border-indigo-500]="focusedField() === 'email'"
            [class.border-red-500]="submitted() && !validEmail()"
            placeholder="you@example.com"
            input-type="email"
            [value]="email()"
            (bindinput)="email.set($any($event).detail.value)"
            (bindfocus)="focusedField.set('email')"
            (bindblur)="focusedField.set(null)"
            confirm-type="next"
          />
          @if (submitted() && !validEmail()) {
            <text class="mt-1 text-xs text-red-500">Enter a valid email</text>
          }

          <text class="mb-1.5 mt-4 text-[13px] font-semibold text-zinc-900">
            Bio
          </text>
          <textarea
            class="h-[100px] rounded-lg border border-zinc-200 bg-white px-3.5 py-3 text-[15px]"
            [class.border-indigo-500]="focusedField() === 'bio'"
            placeholder="Tell us about yourself..."
            [value]="bio()"
            (bindinput)="bio.set($any($event).detail.value)"
            (bindfocus)="focusedField.set('bio')"
            (bindblur)="focusedField.set(null)"
          ></textarea>
          <text class="mt-1 text-xs text-zinc-400 text-right">
            {{ bio().length }} / 200
          </text>
        </view>

        <view
          class="items-center rounded-[10px] bg-indigo-500 p-3.5"
          (bindtap)="submit()"
        >
          <text class="text-base font-semibold text-white">Save Profile</text>
        </view>

        @if (successMessage()) {
          <view
            class="mt-4 items-center rounded-xl border border-green-200 bg-green-50 p-3.5"
          >
            <text class="text-sm text-green-800">{{ successMessage() }}</text>
          </view>
        }
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly name = signal('');
  readonly email = signal('');
  readonly bio = signal('');
  readonly focusedField = signal<string | null>(null);
  readonly submitted = signal(false);
  readonly successMessage = signal('');

  readonly validEmail = computed(() =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email()),
  );

  submit(): void {
    this.submitted.set(true);
    this.successMessage.set('');
    if (!this.name() || !this.validEmail()) return;
    this.successMessage.set(`Saved: ${this.name()} (${this.email()})`);
    this.submitted.set(false);
  }
}
