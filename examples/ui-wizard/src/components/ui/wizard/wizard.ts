import {
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  output,
} from '@angular/core';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';

import {
  type AnimationHandle,
  DURATION,
  EASING,
  directionalSlideIn,
} from '@blotch/dolan/utils/animate';
import { cn } from '@blotch/dolan/utils/cn';
import { injectIconColor } from '../icon/icon-theme';

/**
 * How many steps the indicator shows at once. Three fit a phone's width with
 * room for a label under each, and a wizard with more slides them through.
 */
const VISIBLE_STEPS = 3;

/**
 * The check of a finished step, with a heavier stroke than the icon set's:
 * at 16px a 2px-in-24 line is barely over a pixel.
 */
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

/**
 * A CSS transition of each property, for an inline `transition`.
 */
const transitionOf = (
  properties: readonly string[],
  duration: number,
  easing: string,
): string =>
  properties
    .map((property) => `${property} ${duration}ms ${easing}`)
    .join(', ');

/**
 * The steps slide on the curve a sheet does: quick off the mark, with a long
 * settle. What fades as they slide (the step coming in, the one going out,
 * the lines at the edges) takes as long, so it lands with them.
 */
const SLIDE = transitionOf(['transform'], DURATION.slow, EASING.sheet);
const FADE = transitionOf(['opacity'], DURATION.slow, EASING.standard);
/**
 * A step's circle, number and label, and the lines, change color as a step
 * is reached and finished.
 */
const TINT = transitionOf(
  ['background-color', 'color', 'opacity'],
  DURATION.normal,
  EASING.standard,
);
/** The check pops into a finished step. */
const CHECK = `${transitionOf(['opacity'], DURATION.fast, EASING.standard)}, ${transitionOf(['transform'], DURATION.normal, EASING.springSubtle)}`;

/**
 * The indicator's sides fade out, over the 8% of its width it leaves clear
 * there (`px-[8%]` in the template). The three steps on show sit between
 * them, and what runs or slides past does so through the fade: the line on
 * to a step that isn't on show, and a step on its way in or out. Nothing is
 * cut at an edge.
 *
 * A mask rather than a gradient in the background color over each side: it
 * fades to whatever the wizard is on, a card or a sheet as well as the page.
 * Its stops are percentages, the only kind native Lynx takes.
 */
const EDGE_MASK =
  'linear-gradient(to right, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) 8%, rgba(0, 0, 0, 1) 92%, rgba(0, 0, 0, 0) 100%)';

/** Where a step is: behind the current one, the current one, or ahead. */
export type WizardStepState = 'done' | 'current' | 'upcoming';

/**
 * What a screen reader calls the indicator: the current step's number, how
 * many there are, and its label.
 */
export type WizardStepLabel = (
  step: number,
  count: number,
  label: string,
) => string;

const defaultStepLabel: WizardStepLabel = (step, count, label) =>
  label ? `Step ${step} of ${count}: ${label}` : `Step ${step} of ${count}`;

/** A step as the indicator draws it. */
type WizardCell = {
  step: UiWizardStep;
  number: number;
  label: string;
  state: WizardStepState;
  /** Whether it's one of the steps on show. */
  opacity: 0 | 1;
  circle: string;
  numberClass: string;
  labelClass: string;
};

/** The line between a step and the one after it. */
type WizardLine = {
  /** Where it starts in the row: the middle of its step. */
  left: string;
  /** Whether it's drawn: it is when either of its steps is on show. */
  opacity: 0 | 1;
  /** Its classes, with its color. */
  fill: string;
};

/**
 * A number to three places, for a percentage in a style.
 */
const round = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * `UiWizardStep`, for the wizard's content query. A call rather than the
 * class itself: for a class, Angular's test build keeps an arrow function
 * that nothing calls, which an app's coverage report would show as
 * uncovered.
 */
const stepType = () => UiWizardStep;

/**
 * A task split into steps, one on screen at a time, under an indicator of
 * where the user is:
 *
 * ```html
 * <ui-wizard #wizard [(step)]="step">
 *   <ui-wizard-step label="Account">…</ui-wizard-step>
 *   <ui-wizard-step label="Profile">…</ui-wizard-step>
 *   <ui-wizard-step label="Plan">…</ui-wizard-step>
 *   <ui-wizard-step label="Payment">…</ui-wizard-step>
 * </ui-wizard>
 * <ui-button (pressed)="wizard.next()">Continue</ui-button>
 * ```
 *
 * It takes any number of steps, and the indicator shows three: the current
 * step and the two after it. With more to come, the line past the third
 * fades out. As a step is finished the steps slide along by one, and the
 * line before the first fades the same way, for the steps left behind. Near
 * the end there's nothing more to slide in, so the last three stay and fill
 * in with checks.
 *
 * The buttons that move between steps are the app's: what they say, and what
 * has to be valid before going on, differ with every wizard. They call
 * next(), previous() and goTo().
 *
 * The indicator is one accessibility element, read as "Step 2 of 5:
 * Profile". Its circles and labels are hidden from a screen reader, which
 * would otherwise stop on each number.
 */
@Component({
  selector: 'ui-wizard',
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'hostClass()' },
  template: `
    <view
      class="w-full px-[8%] overflow-hidden"
      [style.mask-image]="edgeMask"
      [accessibility-element]="true"
      [accessibility-label]="indicatorLabel()"
    >
      <!-- Every step is in the row, each a third of the room between the
           indicator's faded sides, and the row slides to bring three into
           view. A native view of its own (not flattened into its parent):
           on Android a flattened view's transition doesn't move it. -->
      <view
        class="flex-row flex"
        [flatten]="false"
        [accessibility-elements-hidden]="true"
        [style]="trackStyle()"
      >
        @for (cell of cells(); track cell.step) {
          <!-- A step off show is clear: the one beside the three on show
               would reach into the indicator's faded side. So a step fades
               as it slides in or out. -->
          <view
            class="shrink-0 flex-col items-center flex"
            [style.transition]="fade()"
            [style.width]="cellWidth()"
            [style.opacity]="cell.opacity"
          >
            <view [class]="cell.circle" [style.transition]="tint()">
              <text
                [class]="cell.numberClass"
                [style.transition]="tint()"
                [style.opacity]="cell.state === 'done' ? 0 : 1"
                >{{ cell.number }}</text
              >
              <!-- The check is over the number, and takes its place. A view
                   around the SVG scales and fades, as its own native view:
                   see the row above. -->
              <view
                class="items-center flex absolute bottom-0 left-0 right-0 top-0 justify-center"
                [flatten]="false"
                [style.transition]="checkTransition()"
                [style.opacity]="cell.state === 'done' ? 1 : 0"
                [style.transform]="
                  cell.state === 'done' ? 'scale(1)' : 'scale(0.6)'
                "
              >
                <svg
                  [attr.content]="checkSvg()"
                  style="width: 16px; height: 16px;"
                />
              </view>
            </view>
            @if (cell.label) {
              <text
                [class]="cell.labelClass"
                [style.transition]="tint()"
                [text-maxline]="2"
                >{{ cell.label }}</text
              >
            }
          </view>
        }
        <!-- The lines, over the row rather than in the steps: the line into
             the first step on show comes from one that's clear. Each is as
             wide as a step, from the middle of one to the middle of the
             next, and its padding keeps it clear of the two circles. -->
        @for (line of lines(); track $index) {
          <view
            class="h-[2px] px-[22px] absolute top-[15px]"
            [style.transition]="fade()"
            [style.left]="line.left"
            [style.width]="cellWidth()"
            [style.opacity]="line.opacity"
          >
            <view [class]="line.fill" [style.transition]="tint()"></view>
          </view>
        }
      </view>
    </view>
    <ng-content />
  `,
})
export class UiWizard {
  /** The current step, counted from 0. */
  readonly step = model(0);
  /**
   * What a screen reader calls the indicator, given the current step
   * (counted from 1), how many there are, and the step's label.
   */
  readonly stepLabel = input<WizardStepLabel>(defaultStepLabel);
  readonly userClass = input<string>('', { alias: 'class' });

  /** The step that next(), previous() or goTo() moved to. */
  readonly changed = output<number>();

  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #resolveColor = injectIconColor();

  /** The steps, in the order the app wrote them. */
  readonly steps = contentChildren(stepType());

  readonly count = computed(() => this.steps().length);

  /**
   * The current step, kept within the steps there are: a `step` past the
   * last shows the last.
   */
  readonly activeIndex = computed(() =>
    Math.min(Math.max(this.step(), 0), Math.max(this.count() - 1, 0)),
  );

  /** The current step's component, or undefined in a wizard with none. */
  readonly activeStep = computed(() => this.steps()[this.activeIndex()]);

  readonly isFirst = computed(() => this.activeIndex() === 0);
  readonly isLast = computed(() => this.activeIndex() >= this.count() - 1);

  /**
   * Which way the wizard last moved: 1 forward, -1 back, and 0 before it has
   * moved, when the first step shown has nowhere to come from. The steps
   * slide in from that side.
   *
   * A step first reads it once it's the current one, after the content query
   * has found the steps. So the 0 it starts from is the step the wizard
   * opened on, not the 0 that activeIndex is before there are steps.
   */
  readonly direction = linkedSignal<number, -1 | 0 | 1>({
    source: this.activeIndex,
    computation: (index, previous) =>
      previous === undefined ? 0 : index > previous.source ? 1 : -1,
  });

  /**
   * The first step on show: the current one, so what's ahead is in view.
   * Toward the end it stops where the last step reaches the third place.
   */
  readonly #firstVisible = computed(() =>
    Math.min(this.activeIndex(), Math.max(this.count() - VISIBLE_STEPS, 0)),
  );

  readonly #animates = computed(() => !this.#settings.reduceMotion());

  protected readonly cells = computed<WizardCell[]>(() => {
    const steps = this.steps();
    const active = this.activeIndex();
    const first = this.#firstVisible();
    const last = first + VISIBLE_STEPS - 1;
    return steps.map((step, index) => {
      const state: WizardStepState =
        index < active ? 'done' : index === active ? 'current' : 'upcoming';
      return {
        step,
        number: index + 1,
        label: step.label(),
        state,
        opacity: index >= first && index <= last ? 1 : 0,
        circle: cn(
          // In px: a control's size, not text that scales.
          'h-[32px] w-[32px] items-center rounded-full flex relative justify-center',
          state === 'upcoming' ? 'bg-muted' : 'bg-primary',
        ),
        numberClass: cn(
          'text-sm font-semibold',
          state === 'upcoming'
            ? 'text-muted-foreground'
            : 'text-primary-foreground',
        ),
        labelClass: cn(
          // Up to two lines, for a label longer than its step is wide.
          'mt-2 w-full text-ellipsis px-1 text-sm text-center',
          state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
          state === 'current' && 'font-medium',
        ),
      };
    });
  });

  /**
   * The lines between the steps. One is done, and the primary color, once
   * the step it leads to is reached.
   *
   * The line into the first step on show comes from a step that isn't, and
   * the line out of the last goes on to one. They're drawn too, and fade out
   * through the indicator's sides: there are steps that way. Lines further
   * off aren't drawn.
   */
  protected readonly lines = computed<WizardLine[]>(() => {
    const count = this.count();
    const active = this.activeIndex();
    const first = this.#firstVisible();
    const last = first + VISIBLE_STEPS - 1;
    return Array.from({ length: Math.max(count - 1, 0) }, (_, index) => ({
      left: `${round(((index + 0.5) / count) * 100)}%`,
      opacity: index >= first - 1 && index <= last ? 1 : 0,
      fill: cn('h-full w-full', index < active ? 'bg-primary' : 'bg-border'),
    }));
  });

  /**
   * The row of steps: as wide as all of them, and moved left by the steps
   * before the first on show. A translate's percentage is of the row's own
   * width, so one step is a share of 100%.
   */
  protected readonly trackStyle = computed(() => {
    const count = this.count();
    return {
      transition: this.#animates() ? SLIDE : 'none',
      width: `${round((Math.max(count, VISIBLE_STEPS) / VISIBLE_STEPS) * 100)}%`,
      transform: `translateX(${round((-this.#firstVisible() / Math.max(count, 1)) * 100)}%)`,
    };
  });

  /**
   * A step's width, as a share of the row: a third of the room between the
   * indicator's sides, or more of it with fewer steps.
   */
  protected readonly cellWidth = computed(
    () => `${round(100 / Math.max(this.count(), 1))}%`,
  );

  // Under Reduce Motion the steps change at once.
  protected readonly fade = computed(() => (this.#animates() ? FADE : 'none'));
  protected readonly tint = computed(() => (this.#animates() ? TINT : 'none'));
  protected readonly checkTransition = computed(() =>
    this.#animates() ? CHECK : 'none',
  );

  /**
   * The check in the color of what sits on the primary, resolved and written
   * into the markup: an SVG can't read a text class or a CSS variable (see
   * icon-theme.ts).
   */
  protected readonly checkSvg = computed(() =>
    // split/join, not replaceAll(), which PrimJS's ES2019 runtime lacks.
    CHECK_SVG.split('currentColor').join(
      this.#resolveColor('var(--primary-foreground)'),
    ),
  );

  protected readonly edgeMask = EDGE_MASK;

  protected readonly indicatorLabel = computed(() =>
    this.stepLabel()(
      this.activeIndex() + 1,
      this.count(),
      this.activeStep()?.label() ?? '',
    ),
  );

  /**
   * 24px between the indicator and the current step. A gap rather than a
   * margin on each step, so one class on the wizard changes it, and the
   * hidden steps, which take no part in the layout, add none.
   */
  protected readonly hostClass = computed(() =>
    cn('flex-col gap-6 flex', this.userClass()),
  );

  /**
   * Moves to the next step. On the last step there's none, and it stays.
   */
  next(): void {
    this.goTo(this.activeIndex() + 1);
  }

  /**
   * Moves back a step. On the first step it stays.
   */
  previous(): void {
    this.goTo(this.activeIndex() - 1);
  }

  /**
   * Moves to a step, counted from 0. A step outside the wizard is the
   * nearest one in it.
   */
  goTo(index: number): void {
    const target = Math.min(Math.max(index, 0), Math.max(this.count() - 1, 0));
    if (target === this.activeIndex()) return;
    this.step.set(target);
    this.changed.emit(target);
  }
}

/**
 * One step of a wizard: its label, which the indicator shows under the
 * step's number, and its content, on screen while it's the current step.
 *
 * The host is the step's panel, styled through `host`. Angular gives a
 * component's host every static attribute the app writes on it, so a class
 * on <ui-wizard-step> lands there.
 *
 * Every step stays rendered and is shown or hidden with the host's
 * `display`, as a tab's panel is (see UiTabsContent): what the user typed in
 * a step is still there when they come back to it, and nothing projected is
 * destroyed and created again.
 */
@Component({
  selector: 'ui-wizard-step',
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'stepClass()',
    // A hidden step takes no room, and the inline display wins over the
    // `flex` in the host's classes.
    '[style.display]': "isActive() ? 'flex' : 'none'",
    // iOS draws a hidden panel's text from its corner, at 0×0: clipping the
    // hidden host hides it.
    '[style.overflow]': "isActive() ? null : 'hidden'",
  },
  template: '<ng-content />',
})
export class UiWizardStep {
  readonly #wizard = inject(UiWizard);
  readonly #settings = inject(LynxAccessibilitySettings);

  /** The step's name, shown under its number in the indicator. */
  readonly label = input('');
  readonly userClass = input<string>('', { alias: 'class' });

  readonly #host = inject(ElementRef).nativeElement;
  #anim?: AnimationHandle;

  protected readonly isActive = computed(
    () => this.#wizard.activeStep() === this,
  );

  /**
   * Slides the step in when the wizard moves to it: from the right going
   * forward, and from the left going back, the way the indicator moved. A
   * field rather than a constructor: Angular's test build keeps a function
   * for a constructor that nothing calls, which an app's coverage report
   * would show as uncovered.
   */
  protected readonly revealing = effect(() => {
    if (!this.isActive()) return;
    // A tick later, so the display has flipped to 'flex' before it animates.
    setTimeout(() => {
      const direction = this.#wizard.direction();
      // The step the wizard opens on is simply there, and under Reduce
      // Motion every step is.
      if (direction === 0 || this.#settings.reduceMotion()) return;
      this.#anim?.cancel();
      this.#anim = directionalSlideIn(this.#host, direction, {
        distance: 24,
        duration: 300,
      });
    }, 0);
  });

  protected readonly stepClass = computed(() =>
    cn('flex-col flex', this.userClass()),
  );
}
