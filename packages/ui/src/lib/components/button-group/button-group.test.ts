import { describe, expect, it } from 'vitest';
import { buttonGroupItemVariants } from './button-group';

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
