import { Component, signal, viewChild } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS, LynxAccessibilitySettings } from '@blotch/angular-lynx';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type LynxMainThread,
  lynxMainThread,
} from '../../../test-utils/lynx-main-thread';
import { type WizardStepLabel, UiWizard, UiWizardStep } from './wizard';

const FIVE = ['Account', 'Profile', 'Plan', 'Payment', 'Review'];

/**
 * What the next host starts with: the step a wizard opens on is there from
 * its first render, not set after it.
 */
const opening = { step: 0, labels: FIVE };

@Component({
  imports: [UiWizard, UiWizardStep, LYNX_ELEMENTS],
  template: `
    <ui-wizard [(step)]="step" (changed)="changes.push($event)" class="w-80">
      @for (label of labels(); track label) {
        <ui-wizard-step [label]="label" class="gap-2">
          <text>{{ label }} panel</text>
        </ui-wizard-step>
      }
    </ui-wizard>
  `,
})
class WizardHost {
  readonly step = signal(opening.step);
  readonly labels = signal(opening.labels);
  readonly changes: number[] = [];
  readonly wizard = viewChild.required(UiWizard);
}

/**
 * Accessibility settings, as the host app would report them.
 */
const settingsWith = (reduceMotion: boolean) => ({
  reduceMotion: signal(reduceMotion),
  reduceTransparency: signal(false),
  increaseContrast: signal(false),
});

const renderWizard = async ({
  step = 0,
  labels = FIVE,
  reduceMotion = false,
} = {}) => {
  const settings = settingsWith(reduceMotion);
  opening.step = step;
  opening.labels = labels;
  const result = await render(WizardHost, {
    providers: [{ provide: LynxAccessibilitySettings, useValue: settings }],
  });
  const host = result.componentRef.instance as WizardHost;
  await waitForUpdate();

  /**
   * A step in the indicator: the view around its circle and its label.
   */
  const cell = (label: string) => result.getByText(label).parentElement!;
  const circle = (label: string) => cell(label).firstElementChild!;
  /**
   * The row of steps, which slides.
   */
  const track = () => cell(labels[0]!).parentElement!;
  return {
    ...result,
    host,
    settings,
    wizard: host.wizard(),
    cell,
    circle,
    track,
    /** The indicator: the window the row slides in. */
    indicator: () => track().parentElement!,
    number: (label: string) => circle(label).querySelector('text')!,
    /** The view around a step's check, which fades and scales. */
    check: (label: string) =>
      circle(label).querySelector('svg')!.parentElement!,
    /** The lines between the steps, each around its fill. */
    lines: () =>
      [...track().children].filter((child) =>
        child.classList.contains('h-[2px]'),
      ) as HTMLElement[],
    /** A step's panel: its host, around its projected text. */
    panel: (label: string) => result.getByText(`${label} panel`).parentElement!,
    /** The steps on show, by their labels. */
    shown: () => labels.filter((label) => cell(label).style.opacity === '1'),
    go: async (move: () => void) => {
      move();
      await waitForUpdate();
    },
  };
};

describe('UiWizard', () => {
  it('shows the current step and the two after it', async () => {
    const { shown, track, cell } = await renderWizard();
    expect(shown()).toEqual(['Account', 'Profile', 'Plan']);
    // Five steps, each a third of the window: the row is five thirds of it
    // wide, and a step is a fifth of the row.
    expect(track().style.width).toBe('166.667%');
    expect(cell('Account').style.width).toBe('20%');
    expect(track().style.transform).toBe('translateX(0%)');
  });

  it('slides the steps along as each is done', async () => {
    const { shown, track, wizard, go } = await renderWizard();
    await go(() => wizard.next());
    expect(shown()).toEqual(['Profile', 'Plan', 'Payment']);
    // One step, a fifth of the row.
    expect(track().style.transform).toBe('translateX(-20%)');

    await go(() => wizard.next());
    expect(shown()).toEqual(['Plan', 'Payment', 'Review']);
    expect(track().style.transform).toBe('translateX(-40%)');
  });

  it('keeps the last three on show to the end, and fills them in', async () => {
    const { shown, track, circle, wizard, go } = await renderWizard({
      step: 2,
    });
    await go(() => wizard.next());
    await go(() => wizard.next());
    // Nothing more to slide in.
    expect(shown()).toEqual(['Plan', 'Payment', 'Review']);
    expect(track().style.transform).toBe('translateX(-40%)');
    expect(circle('Plan').classList).toContain('bg-primary');
    expect(circle('Payment').classList).toContain('bg-primary');
    expect(circle('Review').classList).toContain('bg-primary');
  });

  it('fits three steps or fewer without sliding', async () => {
    const { shown, track, cell, lines, wizard, go } = await renderWizard({
      labels: ['Cart', 'Payment'],
    });
    expect(track().style.width).toBe('100%');
    expect(cell('Cart').style.width).toBe('50%');
    expect(lines()).toHaveLength(1);

    await go(() => wizard.next());
    expect(shown()).toEqual(['Cart', 'Payment']);
    expect(track().style.transform).toBe('translateX(0%)');
  });

  it('marks the steps done, current and still to come', async () => {
    const { circle, number, check, getByText } = await renderWizard({
      step: 1,
    });
    // Done: the primary color, with a check in place of its number.
    expect(circle('Account').classList).toContain('bg-primary');
    expect(number('Account').style.opacity).toBe('0');
    expect(check('Account').style.opacity).toBe('1');
    expect(check('Account').style.transform).toBe('scale(1)');
    expect(getByText('Account').classList).toContain('text-foreground');
    expect(getByText('Account').classList).not.toContain('font-medium');

    // Current: the primary color, with its number, and its label stronger.
    expect(circle('Profile').classList).toContain('bg-primary');
    expect(number('Profile').classList).toContain('text-primary-foreground');
    expect(number('Profile').style.opacity).toBe('1');
    expect(check('Profile').style.opacity).toBe('0');
    expect(check('Profile').style.transform).toBe('scale(0.6)');
    expect(getByText('Profile').classList).toContain('font-medium');

    // Still to come: muted.
    expect(circle('Plan').classList).toContain('bg-muted');
    expect(number('Plan').classList).toContain('text-muted-foreground');
    expect(getByText('Plan').classList).toContain('text-muted-foreground');
  });

  it('numbers the steps from 1, in circles 32px across', async () => {
    const { circle, number } = await renderWizard();
    expect(FIVE.map((label) => number(label).textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(circle('Account').classList).toContain('h-[32px]');
    expect(circle('Account').classList).toContain('w-[32px]');
  });

  it("draws a finished step's check in the color of what sits on the primary", async () => {
    const { check } = await renderWizard();
    const svg = check('Account').querySelector('svg')!;
    expect(svg.getAttribute('content')).toContain('stroke="');
    expect(svg.getAttribute('content')).not.toContain('currentColor');
    expect((svg as unknown as HTMLElement).style.width).toBe('16px');
  });

  describe('lines', () => {
    it('joins each step to the next, from the middle of one to the middle of the other', async () => {
      const { lines } = await renderWizard();
      expect(lines().map((line) => line.style.left)).toEqual([
        '10%',
        '30%',
        '50%',
        '70%',
      ]);
      // As wide as a step, and its padding keeps it clear of the circles.
      expect(lines()[0]!.style.width).toBe('20%');
      expect(lines()[0]!.classList).toContain('px-[22px]');
    });

    it('draws the line on to a step that is not on show, and none further off', async () => {
      const { lines } = await renderWizard();
      // Between the three on show, on to the fourth, and not from the
      // fourth to the fifth.
      expect(lines().map((line) => line.style.opacity)).toEqual([
        '1',
        '1',
        '1',
        '0',
      ]);
    });

    it('draws the line in from the steps left behind', async () => {
      const { lines } = await renderWizard({ step: 2 });
      // From the second step, which is no longer on show, into the third.
      expect(lines().map((line) => line.style.opacity)).toEqual([
        '0',
        '1',
        '1',
        '1',
      ]);
    });

    it('fades both sides of the indicator, for the lines that run off it', async () => {
      // jsdom drops a style it doesn't know, such as mask-image: watch what
      // reaches Lynx's inline style API instead.
      const addInlineStyle = vi.spyOn(lynxMainThread(), '__AddInlineStyle');
      const { indicator } = await renderWizard();
      expect(indicator().classList).toContain('px-[8%]');
      expect(indicator().classList).toContain('overflow-hidden');
      expect(addInlineStyle).toHaveBeenCalledWith(
        indicator(),
        'mask-image',
        'linear-gradient(to right, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) 8%, rgba(0, 0, 0, 1) 92%, rgba(0, 0, 0, 0) 100%)',
      );
      addInlineStyle.mockRestore();
    });

    it('colors the lines up to the current step', async () => {
      const { lines } = await renderWizard({ step: 2 });
      expect(lines().map((line) => line.firstElementChild!.className)).toEqual([
        expect.stringContaining('bg-primary'),
        expect.stringContaining('bg-primary'),
        expect.stringContaining('bg-border'),
        expect.stringContaining('bg-border'),
      ]);
    });
  });

  describe('labels', () => {
    it('shows each label under its step, on up to two lines', async () => {
      const { getByText } = await renderWizard();
      expect(getByText('Account').getAttribute('text-maxline')).toBe('2');
      expect(getByText('Account').classList).toContain('text-center');
    });

    it('draws a step with no label as its circle alone', async () => {
      @Component({
        imports: [UiWizard, UiWizardStep],
        template: `
          <ui-wizard>
            <ui-wizard-step />
            <ui-wizard-step />
          </ui-wizard>
        `,
      })
      class UnlabeledHost {}
      const { container } = await render(UnlabeledHost);
      await waitForUpdate();
      const circles = container.querySelectorAll('.h-\\[32px\\]');
      expect(circles).toHaveLength(2);
      // Each step is its circle, with no label after it: the only text is
      // the number.
      expect(circles[0]!.parentElement!.querySelectorAll('text')).toHaveLength(
        1,
      );
    });
  });

  describe('moving', () => {
    it('moves a step forward and back, and says where it went', async () => {
      const { host, wizard, go } = await renderWizard();
      await go(() => wizard.next());
      expect(host.step()).toBe(1);
      await go(() => wizard.next());
      await go(() => wizard.previous());
      expect(host.step()).toBe(1);
      expect(host.changes).toEqual([1, 2, 1]);
    });

    it('stays on the first step going back, and on the last going on', async () => {
      const { host, wizard, go } = await renderWizard();
      expect(wizard.isFirst()).toBe(true);
      expect(wizard.isLast()).toBe(false);
      await go(() => wizard.previous());
      expect(host.step()).toBe(0);

      await go(() => wizard.goTo(4));
      expect(wizard.isFirst()).toBe(false);
      expect(wizard.isLast()).toBe(true);
      await go(() => wizard.next());
      expect(host.step()).toBe(4);
      // Only the move that happened.
      expect(host.changes).toEqual([4]);
    });

    it('goes to the nearest step for one outside the wizard', async () => {
      const { host, wizard, go } = await renderWizard({ step: 2 });
      await go(() => wizard.goTo(99));
      expect(host.step()).toBe(4);
      await go(() => wizard.goTo(-3));
      expect(host.step()).toBe(0);
    });

    it('shows the last step for a step past it, and the first for one before', async () => {
      const { host, shown, panel, go } = await renderWizard({ step: 12 });
      expect(shown()).toEqual(['Plan', 'Payment', 'Review']);
      expect(panel('Review').style.display).toBe('flex');

      await go(() => host.step.set(-2));
      expect(shown()).toEqual(['Account', 'Profile', 'Plan']);
      expect(panel('Account').style.display).toBe('flex');
    });

    it('counts the steps', async () => {
      const { wizard } = await renderWizard();
      expect(wizard.count()).toBe(5);
    });
  });

  describe('panels', () => {
    it("shows only the current step's panel", async () => {
      const { panel, wizard, go } = await renderWizard();
      expect(panel('Account').style.display).toBe('flex');
      expect(panel('Profile').style.display).toBe('none');
      // A hidden panel is clipped, so iOS draws none of its text.
      expect(panel('Profile').style.overflow).toBe('hidden');
      expect(panel('Account').style.overflow).toBe('');

      await go(() => wizard.next());
      expect(panel('Account').style.display).toBe('none');
      expect(panel('Profile').style.display).toBe('flex');
    });

    it("merges a class with each part's own, on that one element", async () => {
      const { container, panel } = await renderWizard();
      // 24px between the indicator and the current step.
      expect(container.querySelector('.flex-col.gap-6.w-80')).not.toBeNull();
      expect(container.querySelectorAll('.w-80')).toHaveLength(1);
      expect(panel('Account').classList).toContain('flex-col');
      expect(panel('Account').classList).toContain('gap-2');
      expect(container.querySelectorAll('.gap-2')).toHaveLength(5);
    });
  });

  describe('accessibility', () => {
    it('reads the indicator as one element: the step, how many, and its label', async () => {
      const { indicator, track, wizard, go } = await renderWizard();
      expect(indicator().getAttribute('accessibility-element')).toBe('true');
      expect(indicator().getAttribute('accessibility-label')).toBe(
        'Step 1 of 5: Account',
      );
      // Its circles and labels aren't read one by one.
      expect(track().getAttribute('accessibility-elements-hidden')).toBe(
        'true',
      );

      await go(() => wizard.next());
      expect(indicator().getAttribute('accessibility-label')).toBe(
        'Step 2 of 5: Profile',
      );
    });

    it('reads a step with no label by its number', async () => {
      @Component({
        imports: [UiWizard, UiWizardStep],
        template: `
          <ui-wizard>
            <ui-wizard-step />
            <ui-wizard-step />
          </ui-wizard>
        `,
      })
      class UnlabeledHost {}
      const { container } = await render(UnlabeledHost);
      await waitForUpdate();
      expect(
        container
          .querySelector('[accessibility-label]')!
          .getAttribute('accessibility-label'),
      ).toBe('Step 1 of 2');
    });

    it('takes the words from the app, such as a translation', async () => {
      @Component({
        imports: [UiWizard, UiWizardStep],
        template: `
          <ui-wizard [step]="1" [stepLabel]="label">
            <ui-wizard-step label="Cart" />
            <ui-wizard-step label="Delivery" />
          </ui-wizard>
        `,
      })
      class WordedHost {
        readonly label: WizardStepLabel = (step, count, label) =>
          `${label}, ${step} / ${count}`;
      }
      const { container } = await render(WordedHost);
      await waitForUpdate();
      expect(
        container
          .querySelector('[accessibility-label]')!
          .getAttribute('accessibility-label'),
      ).toBe('Delivery, 2 / 2');
    });
  });

  it('draws nothing for a wizard with no steps, and stays put', async () => {
    @Component({
      imports: [UiWizard],
      template: `<ui-wizard (changed)="changes.push($event)" />`,
    })
    class EmptyHost {
      readonly changes: number[] = [];
      readonly wizard = viewChild.required(UiWizard);
    }
    const { container, componentRef } = await render(EmptyHost);
    await waitForUpdate();
    const host = componentRef.instance as EmptyHost;
    const indicator = container.querySelector('[accessibility-label]')!;
    expect(indicator.getAttribute('accessibility-label')).toBe('Step 1 of 0');
    // No circles, and no lines.
    expect(indicator.querySelectorAll('.h-\\[32px\\]')).toHaveLength(0);
    expect(indicator.querySelectorAll('.h-\\[2px\\]')).toHaveLength(0);
    expect(host.wizard().activeStep()).toBeUndefined();

    host.wizard().next();
    host.wizard().previous();
    expect(host.changes).toEqual([]);
  });

  describe('motion', () => {
    /** `__ElementAnimate`'s first argument for starting an animation. */
    const START = 0;
    /** `__ElementAnimate`'s first argument for canceling an animation. */
    const CANCEL = 3;

    let animate: MockInstance<LynxMainThread['__ElementAnimate']>;
    beforeEach(() => {
      animate = vi.spyOn(lynxMainThread(), '__ElementAnimate');
    });
    afterEach(() => animate.mockRestore());

    /**
     * The animations started on an element: each one's key and keyframes.
     */
    const startedOn = (element: Element) =>
      animate.mock.calls
        .filter(
          ([target, [operation]]) => target === element && operation === START,
        )
        .map(([, [, key, keyframes]]) => ({ key, keyframes }));

    const slideFrom = (x: number) => [
      { transform: `translateX(${x}px)`, opacity: 0 },
      { transform: 'translateX(0px)', opacity: 1 },
    ];

    it('slides the row, and fades what comes and goes with it', async () => {
      const { track, cell, circle, check, lines } = await renderWizard();
      expect(track().style.transition).toContain('transform 350ms');
      // A step on show fades in once the row has brought it inside: 150ms
      // in, over the 200ms the slide has left.
      expect(cell('Account').style.transition).toMatch(
        /^opacity 200ms .* 150ms$/,
      );
      expect(lines()[0]!.style.transition).toMatch(/^opacity 200ms .* 150ms$/);
      expect((circle('Account') as HTMLElement).style.transition).toContain(
        'background-color 250ms',
      );
      expect(check('Account').style.transition).toContain('transform 250ms');
      // A native view of its own, which Android needs to move it.
      expect(track().getAttribute('flatten')).toBe('false');
    });

    it('fades a step out before the row carries it to the edge, and in once it is inside', async () => {
      const { cell, lines, wizard, go } = await renderWizard();
      // Off show from the start: the fifth step, and the line into it.
      expect(cell('Review').style.transition).toContain('opacity 100ms');
      expect(lines()[3]!.style.transition).toContain('opacity 100ms');

      await go(() => wizard.next());
      await go(() => wizard.next());
      // The first step has gone, and the line out of it, quickly. The fifth
      // has come in after a wait.
      expect(cell('Account').style.opacity).toBe('0');
      expect(cell('Account').style.transition).toContain('opacity 100ms');
      expect(lines()[0]!.style.transition).toContain('opacity 100ms');
      expect(cell('Review').style.opacity).toBe('1');
      expect(cell('Review').style.transition).toMatch(
        /^opacity 200ms .* 150ms$/,
      );
    });

    it('leaves the step the wizard opens on where it is', async () => {
      const { panel } = await renderWizard({ step: 1 });
      // The panel waits a macrotask before it would animate.
      await waitForUpdate();
      expect(startedOn(panel('Profile'))).toEqual([]);
    });

    it('slides a step in from the side the wizard moved from', async () => {
      const { panel, wizard, go } = await renderWizard();
      await waitForUpdate();

      await go(() => wizard.next());
      await waitForUpdate();
      expect(startedOn(panel('Profile')).map((a) => a.keyframes)).toEqual([
        slideFrom(24),
      ]);

      await go(() => wizard.previous());
      await waitForUpdate();
      expect(startedOn(panel('Account')).map((a) => a.keyframes)).toEqual([
        slideFrom(-24),
      ]);

      // Coming back to a step stops the slide it came in on before.
      await go(() => wizard.next());
      await waitForUpdate();
      const [first] = startedOn(panel('Profile'));
      expect(startedOn(panel('Profile')).map((a) => a.keyframes)).toEqual([
        slideFrom(24),
        slideFrom(24),
      ]);
      expect(animate).toHaveBeenCalledWith(panel('Profile'), [
        CANCEL,
        first!.key,
      ]);
    });

    it('changes at once under Reduce Motion', async () => {
      const { track, cell, circle, check, lines, panel, wizard, go } =
        await renderWizard({ reduceMotion: true });
      await waitForUpdate();
      expect(track().style.transition).toBe('none');
      expect(cell('Payment').style.transition).toBe('none');
      expect(lines()[0]!.style.transition).toBe('none');
      expect((circle('Account') as HTMLElement).style.transition).toBe('none');
      expect(check('Account').style.transition).toBe('none');

      animate.mockClear();
      await go(() => wizard.next());
      await waitForUpdate();
      expect(startedOn(panel('Profile'))).toEqual([]);
    });
  });
});
