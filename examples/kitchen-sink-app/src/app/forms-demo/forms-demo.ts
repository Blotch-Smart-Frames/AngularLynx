import { Component, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import { UiLabel } from '../../components/ui/label';
import { UiText } from '../../components/ui/typography';
import { DemoScreen } from '../demo-screen/demo-screen';
import { ScreenHost } from '../screen-host';

@Component({
  selector: 'app-forms-demo',
  hostDirectives: [ScreenHost],
  standalone: true,
  imports: [
    LYNX_ELEMENTS,
    ReactiveFormsModule,
    DemoScreen,
    UiBadge,
    UiButton,
    UiLabel,
    UiText,
  ],
  template: `
    <app-demo-screen
      heading="Forms"
      category="Forms & Input"
      description="Angular reactive forms bound to Lynx native fields via ControlValueAccessor. The chrome is dolan; the inputs stay native so [formControl] binding still works."
    >
      <view class="flex-col gap-4 flex">
        <!-- Name -->
        <view class="flex-col gap-1.5 flex">
          <ui-label>Name *</ui-label>
          <input
            type="text"
            placeholder="Your name"
            class="rounded-md border border-border bg-background p-2.5 text-[15px] text-foreground"
            [formControl]="form.controls.name"
          />
          @if (form.controls.name.invalid && form.controls.name.touched) {
            <ui-text variant="small" class="text-destructive">
              Name is required
            </ui-text>
          }
        </view>

        <!-- Email -->
        <view class="flex-col gap-1.5 flex">
          <ui-label>Email *</ui-label>
          <input
            type="email"
            placeholder="you@example.com"
            class="rounded-md border border-border bg-background p-2.5 text-[15px] text-foreground"
            [formControl]="form.controls.email"
          />
          @if (form.controls.email.touched) {
            @if (form.controls.email.hasError('required')) {
              <ui-text variant="small" class="text-destructive">
                Email is required
              </ui-text>
            } @else if (form.controls.email.hasError('email')) {
              <ui-text variant="small" class="text-destructive">
                Enter a valid email address
              </ui-text>
            }
          }
        </view>

        <!-- Message -->
        <view class="flex-col gap-1.5 flex">
          <ui-label>Message</ui-label>
          <textarea
            placeholder="Write a message..."
            class="h-[80px] rounded-md border border-border bg-background p-2.5 text-[15px] text-foreground"
            [formControl]="form.controls.message"
          ></textarea>
        </view>

        <!-- Form state badges -->
        <view class="flex-row flex-wrap gap-2 flex">
          <ui-badge
            [variant]="form.valid ? 'default' : 'destructive'"
            [animated]="false"
          >
            {{ form.valid ? 'Valid' : 'Invalid' }}
          </ui-badge>
          @if (form.dirty) {
            <ui-badge variant="secondary" [animated]="false">Dirty</ui-badge>
          }
          @if (form.touched) {
            <ui-badge variant="secondary" [animated]="false">Touched</ui-badge>
          }
          @if (disabled()) {
            <ui-badge variant="outline" [animated]="false">Disabled</ui-badge>
          }
        </view>

        <!-- Action buttons -->
        <view class="flex-row gap-2 flex">
          <ui-button class="flex-1" (pressed)="submit()">Submit</ui-button>
          <ui-button
            class="flex-1"
            variant="outline"
            (pressed)="toggleDisable()"
          >
            {{ disabled() ? 'Enable' : 'Disable' }}
          </ui-button>
        </view>

        <!-- Result -->
        @if (result()) {
          <view
            class="flex-col gap-0.5 rounded-md border border-border bg-card p-3 flex"
          >
            <ui-text variant="small">Submitted!</ui-text>
            <ui-text variant="muted">{{ result() }}</ui-text>
          </view>
        }
      </view>
    </app-demo-screen>
  `,
})
export class FormsDemo {
  form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: Validators.required,
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    message: new FormControl('', { nonNullable: true }),
  });

  // `disabled` mirrors form.disabled as a signal because Angular's FormGroup
  // doesn't expose its enabled/disabled state as a signal — the template can't
  // reactively read form.disabled without an explicit signal bridge.
  disabled = signal(false);
  result = signal('');

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.valid) {
      const { name, email } = this.form.getRawValue();
      this.result.set(`From ${name} <${email}>`);
      // Clear the result banner after 4 seconds and reset the form.
      // setTimeout is safe here — it's outside the native event callback.
      setTimeout(() => {
        this.result.set('');
        this.form.reset();
      }, 4000);
    }
  }

  toggleDisable(): void {
    if (this.disabled()) {
      this.form.enable();
      this.disabled.set(false);
    } else {
      this.form.disable();
      this.disabled.set(true);
    }
  }
}
