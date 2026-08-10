import { describe, expect, it, vi } from 'vitest';

// Mock Angular so importing the component module doesn't require the framework
// runtime. Only the exported `cva` variant fn is exercised here; the class field
// initializers (input/output/viewChild/inject) never run because we never
// construct the components.
vi.mock('@angular/core', () => ({
  Component: () => () => {},
  ViewEncapsulation: { None: 0 },
  computed: () => () => {},
  inject: () => ({}),
  input: () => () => {},
  output: () => () => {},
  viewChild: () => () => {},
}));

vi.mock('@blotch/angular-lynx', () => ({
  LYNX_ELEMENTS: [],
}));

const { buttonGroupItemVariants } = await import('./button-group');

describe('buttonGroupItemVariants', () => {
  it('returns default variant and size classes', () => {
    const result = buttonGroupItemVariants();
    expect(result).toContain('bg-secondary');
    expect(result).toContain('h-10');
    expect(result).toContain('px-4');
  });

  it('returns outline variant classes', () => {
    const result = buttonGroupItemVariants({ variant: 'outline' });
    expect(result).toContain('bg-background');
  });

  it('returns small size classes', () => {
    const result = buttonGroupItemVariants({ size: 'sm' });
    expect(result).toContain('h-9');
    expect(result).toContain('px-3');
  });

  it('returns large size classes', () => {
    const result = buttonGroupItemVariants({ size: 'lg' });
    expect(result).toContain('h-11');
    expect(result).toContain('px-6');
  });

  it('always includes base layout classes', () => {
    const result = buttonGroupItemVariants({ variant: 'outline', size: 'lg' });
    expect(result).toContain('flex');
    expect(result).toContain('items-center');
    expect(result).toContain('justify-center');
  });
});
