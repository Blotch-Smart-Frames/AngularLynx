import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  submit,
  required,
  email,
} from '@angular/forms/signals';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { UiButton } from '../components/ui/button';
import { UiInput } from '../components/ui/input';
import { UiTextarea } from '../components/ui/textarea';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, FormField, UiButton, UiInput, UiTextarea],
  template: `
    <scroll-view class="h-screen bg-background" scroll-orientation="vertical">
      <view class="p-6">
        <text class="text-[28px] font-bold text-foreground mb-1">Contact Us</text>
        <text class="text-[13px] text-muted-foreground mb-5">Angular signal forms — powered by Lynx.</text>

        <view class="bg-card border border-border rounded-xl p-5 mb-5">
          <ui-input
            label="Name *"
            type="text"
            placeholder="Your name"
            [formField]="contactForm.name"
            [error]="contactForm.name().touched() && contactForm.name().errors().length ? 'Name is required' : ''"
          />

          <ui-input
            class="mt-4"
            label="Email *"
            type="email"
            placeholder="you@example.com"
            [formField]="contactForm.email"
            [error]="emailError()"
          />

          <ui-textarea
            class="mt-4"
            label="Message"
            placeholder="Write a message..."
            [formField]="contactForm.message"
          />
        </view>

        <ui-button class="w-full" (pressed)="onSubmit()">
          {{ submitted() ? 'Sent ✓' : 'Send Message' }}
        </ui-button>

        @if (submitted()) {
          <view class="bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl p-3.5 mt-4">
            <text class="text-sm text-[#166534] font-semibold mb-1">
              Message sent from {{ contactForm.name().value() }}!
            </text>
            <text class="text-[13px] text-[#166534]">
              Reply to: {{ contactForm.email().value() }}
            </text>
          </view>
        }
      </view>
    </scroll-view>
  `,
})
export class App {
  readonly #model = signal({ name: '', email: '', message: '' });

  readonly contactForm = form(this.#model, (s) => {
    required(s.name, { message: 'Name is required' });
    required(s.email, { message: 'Email is required' });
    email(s.email, { message: 'Enter a valid email address' });
  });

  readonly submitted = signal(false);

  protected readonly emailError = computed(() => {
    const field = this.contactForm.email();
    if (!field.touched()) return '';
    if (field.errors().some((e) => e.kind === 'required'))
      return 'Email is required';
    if (field.errors().some((e) => e.kind === 'email'))
      return 'Enter a valid email address';
    return '';
  });

  onSubmit(): void {
    submit(this.contactForm, async () => {
      this.submitted.set(true);
      setTimeout(() => {
        this.submitted.set(false);
        this.#model.set({ name: '', email: '', message: '' });
      }, 3000);
    });
  }
}
