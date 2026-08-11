import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', () => ({
  Component: () => () => {},
  ViewEncapsulation: { None: 0 },
  computed: () => () => {},
  input: () => () => {},
  output: () => () => {},
}));

vi.mock('@blotch/angular-lynx', () => ({
  LYNX_ELEMENTS: [],
}));

const { buttonVariants } = await import('./button');

describe('buttonVariants', () => {
  it('returns default variant and size classes', () => {
    const result = buttonVariants();
    expect(result).toContain('bg-primary');
    expect(result).toContain('h-10');
    expect(result).toContain('px-4');
  });

  it('returns destructive variant classes', () => {
    const result = buttonVariants({ variant: 'destructive' });
    expect(result).toContain('bg-destructive');
  });

  it('returns outline variant classes', () => {
    const result = buttonVariants({ variant: 'outline' });
    expect(result).toContain('border');
    expect(result).toContain('bg-background');
  });

  it('returns secondary variant classes', () => {
    const result = buttonVariants({ variant: 'secondary' });
    expect(result).toContain('bg-secondary');
  });

  it('returns ghost variant classes', () => {
    const result = buttonVariants({ variant: 'ghost' });
    expect(result).toContain('bg-transparent');
  });

  it('returns small size classes', () => {
    const result = buttonVariants({ size: 'sm' });
    expect(result).toContain('h-9');
    expect(result).toContain('px-3');
  });

  it('returns large size classes', () => {
    const result = buttonVariants({ size: 'lg' });
    expect(result).toContain('h-11');
    expect(result).toContain('px-8');
  });

  it('returns icon size classes', () => {
    const result = buttonVariants({ size: 'icon' });
    expect(result).toContain('h-10');
    expect(result).toContain('w-10');
  });

  it('always includes base classes', () => {
    const result = buttonVariants({ variant: 'ghost', size: 'sm' });
    expect(result).toContain('flex');
    expect(result).toContain('items-center');
    expect(result).toContain('rounded-md');
  });
});
