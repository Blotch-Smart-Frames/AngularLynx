/**
 * Makes `pop()`, `shift()` and `splice()` overwrite the slots an array gives
 * up, so that PrimJS lets go of what the array held there (issue #299).
 *
 * PrimJS, the engine that runs the main thread (and Android's background
 * thread), keeps a fast array's elements in a buffer, and its garbage
 * collector marks every slot of that buffer, not just the ones below
 * `length`. Shrinking an array only lowers its length: `pop()`, `shift()`,
 * `splice()`, a shorter `length` and deleting the last element all leave
 * what they removed in its slot, alive for as long as the array is, until a
 * later push writes over it. Measured on the iOS Simulator (Lynx 4.1), with a
 * `WeakRef` after allocating enough to make PrimJS collect: an object
 * popped from an array that was kept, or cut off by `splice()` or a shorter
 * `length`, stayed; one replaced by assignment was collected.
 *
 * Libraries keep stacks and lists in arrays that live as long as their
 * owner, so this kept whole screens. three.js's renderer pushes each frame's
 * render list onto a stack and pops it when the frame ends, and the popped
 * list still points at the meshes it drew, their scene and, through
 * angular-three, the screen's components and native views. three.js also
 * keeps every renderer that drew a material that's still in use, so a
 * module-level material kept every screen its canvas was ever shown on. On
 * the web the same renderer keeps only itself, its canvas and its GL state.
 *
 * Each method calls the engine's own, then writes `undefined` into the slots
 * the array gave up, one after the other from the new length so that each
 * write appends and the array stays a fast one, and puts the length back.
 * The slots then hold `undefined`, which keeps nothing.
 *
 * JavaScript can't hook a shorter `length` or a `delete`, so those still keep
 * what they cut off: empty a long-lived array with `splice(0)` rather than
 * `length = 0`. Only arrays get the writes (`Array.isArray`), and only
 * extensible ones, as a non-extensible array refuses them; an array-like
 * passed in with `call()` is left to the engine. An array behind a `Proxy`
 * sees the writes through its traps.
 *
 * Nothing changes in the web build: a browser's engine collects what an
 * array gave up.
 *
 * A plain script with no imports, so the tests can run it in a fresh realm.
 * Strict, as the module it's bundled into is.
 */
'use strict';

if (typeof __WEB__ === 'undefined' || !__WEB__) {
  const { isArray } = Array;
  const { defineProperty, isExtensible } = Object;
  const prototype = Array.prototype;
  const pop = prototype.pop;
  const shift = prototype.shift;
  const splice = prototype.splice;

  /**
   * Writes `undefined` into the slots from `array`'s length up to
   * `previousLength`, then puts the length back.
   */
  const clearVacatedSlots = (array, previousLength) => {
    const length = array.length;
    if (length >= previousLength || !isExtensible(array)) return;
    for (let index = length; index < previousLength; index++) {
      array[index] = undefined;
    }
    array.length = length;
  };

  // Object literal methods, so each has the built-in's name and length and
  // can't be called with `new`.
  const methods = {
    pop() {
      if (!isArray(this)) return pop.call(this);
      const previousLength = this.length;
      const value = pop.call(this);
      clearVacatedSlots(this, previousLength);
      return value;
    },
    shift() {
      if (!isArray(this)) return shift.call(this);
      const previousLength = this.length;
      const value = shift.call(this);
      clearVacatedSlots(this, previousLength);
      return value;
    },
    // Passes `arguments` on rather than the two parameters: `splice()` with
    // no arguments removes nothing, while `splice(undefined)` removes
    // everything.
    // eslint-disable-next-line no-unused-vars
    splice(start, deleteCount) {
      if (!isArray(this)) return splice.apply(this, arguments);
      const previousLength = this.length;
      const removed = splice.apply(this, arguments);
      clearVacatedSlots(this, previousLength);
      return removed;
    },
  };
  for (const name of Object.keys(methods)) {
    defineProperty(prototype, name, {
      value: methods[name],
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}
