import { describe, expect, it, beforeEach } from 'vitest';
import { dismissToast, toast, toasts } from './toast-state';

describe('toast-state', () => {
  beforeEach(() => {
    toasts.set([]);
  });

  it('toast() appends a new entry with defaults', () => {
    const id = toast({ title: 'Hello' });
    const list = toasts();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(id);
    expect(list[0]!.title).toBe('Hello');
    expect(list[0]!.variant).toBe('default');
    expect(list[0]!.duration).toBe(5000);
  });

  it('toast() accepts overrides for variant, duration, and action', () => {
    const onAction = () => {};
    const id = toast({
      title: 'Danger',
      variant: 'destructive',
      duration: 1000,
      action: { label: 'Undo', onAction },
    });
    const [entry] = toasts();
    expect(entry!.id).toBe(id);
    expect(entry!.variant).toBe('destructive');
    expect(entry!.duration).toBe(1000);
    expect(entry!.action).toEqual({ label: 'Undo', onAction });
  });

  it('dismissToast() removes only the entry with the matching id', () => {
    const a = toast({ title: 'A' });
    const b = toast({ title: 'B' });
    dismissToast(a);
    expect(toasts().map((t) => t.id)).toEqual([b]);
  });

  it('dismissToast() with an unknown id leaves the queue untouched', () => {
    toast({ title: 'A' });
    const before = toasts().length;
    dismissToast('never-existed');
    expect(toasts()).toHaveLength(before);
  });

  it('successive toast() calls produce monotonically-unique ids', () => {
    const a = toast({ title: 'A' });
    const b = toast({ title: 'B' });
    const c = toast({ title: 'C' });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
