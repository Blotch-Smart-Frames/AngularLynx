// LynxListElement._processUpdate()'s diff as it was before it skipped the
// items before the first change and after the last: every item went through
// the longest-run search, whatever changed. The list specs check, over random
// edits, that the list still sends exactly what this sends.
//
// Not exported from public-api.ts: this is test-only infrastructure, never
// shipped in the published package.
import type {
  ListItemAttributes,
  ListSlot,
} from '../lynx-element/lynx-list-element';
import type { ElementRef } from '../types/lynx';

/**
 * A random whole number below `count` on each call, the same ones for the
 * same seed, so a failure fails the same way on every run. It mixes its state
 * with shifted copies of itself, so its low bits vary as much as its high
 * ones: a multiply-and-add generator's low bits repeat in short cycles,
 * and with `% count` they kept the specs from ever picking some kinds of
 * edit.
 */
export const seededBelow = (seed: number): ((count: number) => number) => {
  let state = seed;
  return (count) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % count;
  };
};

/** What update-list-info held, as the list sends it. */
export type UntrimmedListInfo = {
  insertAction: Array<Record<string, unknown>>;
  removeAction: number[];
  updateAction: Array<Record<string, unknown>>;
};

const longestIncreasing = (sequence: readonly number[]): boolean[] => {
  const inRun = Array.from({ length: sequence.length }, () => false);
  const tails: number[] = [];
  const previous = Array.from({ length: sequence.length }, () => -1);
  for (let i = 0; i < sequence.length; i++) {
    const value = sequence[i]!;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence[tails[middle]!]! < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[i] = tails[low - 1]!;
    tails[low] = i;
  }
  for (
    let i = tails.length > 0 ? tails[tails.length - 1]! : -1;
    i >= 0;
    i = previous[i]!
  ) {
    inRun[i] = true;
  }
  return inRun;
};

const attributesDiffer = (
  a: ListItemAttributes | undefined,
  b: ListItemAttributes | undefined,
): boolean => {
  if (a === b) return false;
  if (!a || !b) return true;
  return (
    a['estimated-main-axis-size-px'] !== b['estimated-main-axis-size-px'] ||
    a['full-span'] !== b['full-span'] ||
    a['sticky-top'] !== b['sticky-top'] ||
    a['sticky-bottom'] !== b['sticky-bottom'] ||
    a.recyclable !== b.recyclable
  );
};

const insertActionOf = (
  slot: ListSlot,
  position: number,
): Record<string, unknown> => {
  if (slot.ref) {
    return {
      position,
      type: 'list-item',
      'item-key':
        (__GetAttributeByName(slot.ref, 'item-key') as string | null) ??
        slot.id.slice(1),
    };
  }
  return {
    position,
    type: slot.type,
    'item-key': slot.key,
    ...slot.attributes,
  };
};

/**
 * What the list sent going from `oldSlots` to `newSlots`, and the elements
 * it marked as no longer appended to the native list; null when it sent
 * nothing.
 */
export const untrimmedListDiff = (
  oldSlots: readonly ListSlot[],
  newSlots: readonly ListSlot[],
): { info: UntrimmedListInfo; noLongerAppended: ElementRef[] } | null => {
  const oldIndexById = new Map<string, number>();
  for (let i = 0; i < oldSlots.length; i++) {
    oldIndexById.set(oldSlots[i]!.id, i);
  }
  const oldIndexOf = newSlots.map((slot) => oldIndexById.get(slot.id) ?? -1);
  const kept: number[] = [];
  for (let i = 0; i < newSlots.length; i++) {
    if (oldIndexOf[i]! >= 0) kept.push(i);
  }
  const staying = longestIncreasing(kept.map((i) => oldIndexOf[i]!));
  const stays = Array.from({ length: newSlots.length }, () => false);
  kept.forEach((newIndex, k) => {
    if (staying[k]) stays[newIndex] = true;
  });

  const keptOldIndices = new Set<number>();
  const stayingOldIndices = new Set<number>();
  for (const i of kept) {
    keptOldIndices.add(oldIndexOf[i]!);
    if (stays[i]) stayingOldIndices.add(oldIndexOf[i]!);
  }
  const removeAction: number[] = [];
  for (let i = 0; i < oldSlots.length; i++) {
    if (!stayingOldIndices.has(i)) removeAction.push(i);
  }

  const insertAction: Array<Record<string, unknown>> = [];
  const updateAction: Array<Record<string, unknown>> = [];
  for (let i = 0; i < newSlots.length; i++) {
    const slot = newSlots[i]!;
    if (!stays[i]) {
      insertAction.push(insertActionOf(slot, i));
    } else if (
      slot.source &&
      attributesDiffer(oldSlots[oldIndexOf[i]!]!.attributes, slot.attributes)
    ) {
      updateAction.push({
        ...insertActionOf(slot, i),
        from: i,
        to: i,
        flush: false,
      });
    }
  }

  if (
    insertAction.length === 0 &&
    removeAction.length === 0 &&
    updateAction.length === 0
  ) {
    return null;
  }
  const noLongerAppended = removeAction
    .filter((index) => oldSlots[index]!.ref && !keptOldIndices.has(index))
    .map((index) => oldSlots[index]!.ref!);
  return {
    info: { insertAction, removeAction, updateAction },
    noLongerAppended,
  };
};
