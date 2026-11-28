# x-list Investigation

**Status:** Resolved. Lists render on iOS, Android and the web; the sections after "Lazy items and view recycling" are the history of getting there (the crashes came from keying a `WeakSet` on element refs inside `componentAtIndex`, see `create-list-element.ts`).

## Lazy items and view recycling (`*lynxListFor`, 2026-11-14)

`@for` in a `<list>` builds every item's Angular view and elements up front; the native list draws only the items near the screen, and every view stays. `*lynxListFor` (`packages/runtime/src/lib/list-for/`) builds an item's view only when native asks for it, and reuses views native let go of, following React Lynx's protocol (`lynx-stack/packages/react/runtime/src/snapshot/list/list.ts`):

- **The list's model.** `LynxListElement` diffs _slots_: each element child (static `<list-item>`, `@for` item) and each item of a `*lynxListFor` run, which sits where the directive's anchor comment sits among the children (`attachItemSource`). A run gives each item's key (`trackBy`), reuse type and layout attributes (`itemAttributes`) without a view; `commit()` fixes the run that `componentAtIndex` indexes into until the next update, and the list's `committedSlot(index)` maps native's index to a slot.
- **The diff.** Identity is `#<unique id>` for an element, `<run>|<type>|<key>` for a run's item. The items outside the longest run that kept their order (LIS) are moves, sent as a removal and an insertion of the same `item-key`, as React Lynx sends them: native keeps the item's holder by key and asks for it again. (Before, a reordered `@for` sent nothing, and native kept the old order.) A run's item whose attributes changed gets an `updateAction` with `flush: false`.
- **componentAtIndex.** For a run's item, `ListItemViews.bind()` gives the item its own view back if native let go of it and nothing reused it yet, takes the oldest pooled view of its type otherwise (React's recycle map is insertion-ordered too), or builds one (`TemplateRef.createEmbeddedView`, then `ViewContainerRef.insert`, which reaches the list as an `appendChild` it skips: the root is marked `_ownedByListSource`). It sets the context, runs `detectChanges()` (unless the view was bound ahead for the item and nothing changed since, below), and componentAtIndex appends a new element and flushes with the operation id, as for an element child. If native asks for an item whose element it still holds (a move, or a cell bound anew), the item gets another view, as React's `takeElements()` clones: one element in two cells would show one empty. `enableReuseNotification` passes `listReuseNotification` when an element shows another item.
- **enqueueComponent.** The view goes to its type's pool, still claimed by its item. An item with `recyclable: false` keeps its view out of the pool (the platform lists on iOS and Android ignore the attribute; Lynx's C++ list honors it).
- **No other flush inside componentAtIndex.** The item is built inside native's layout pass (sync list) or a native task of its own (`enable-async-list`). `bindListItem()` (`lynx-render-lifecycle.ts`) marks the scope: `LynxRendererFactory2.end()`, which the item's `detectChanges()` runs, commits removals, flow and text normalization but doesn't flush; a list inside the item sets its `update-list-info` without a root flush (React's `ensureElements` → `flushWithId`), so the item's own flush lays it out; `scheduleSettleFlush()` schedules nothing (Lynx's main thread runs a call's microtasks before it returns to native, so a settle flush would land in the layout pass). Calls waiting for a flush (`afterNextFlush`) get one on a `setTimeout` after (`settleAfterListItems`).
- **Views stay attached to change detection**, in the pool too. `reattach()` and every view insert notify Angular's scheduler, and a tick with nothing to check still runs `begin()`/`end()`: a tick would have followed every item native asked for while scrolling. A pooled view is checked with its parent on its last item; there are a handful. (`end()` no longer flushes for a cycle that wrote nothing, see below, but the tick itself still costs a timer task.)
- **Under `enable-async-list`**, componentAtIndex and enqueueComponent read only what the last update committed, so a call that arrives between the directive's `ngDoCheck` and the next update, or after the directive is destroyed (bind gives `null`), still answers for the items native was told about.
- **An edit that keeps every key, type and layout attribute** (a row replaced by a changed copy, a refetch of the same rows) has nothing for native: `ListItemViews.setItems()` commits the items itself and the directive doesn't schedule the list, whose update would collect and diff every item to send nothing.
- **Lynx for Web** calls componentAtIndex for every inserted position in a microtask after `update-list-info`, and enqueueComponent only for removals, so every item gets a view there.

Measured on the iOS Simulator (Lynx Explorer 4.1, iPhone 18 Pro, iOS 27), 1,000 rows of `examples/element-list` (a row component with two texts and a tap target), a fresh Explorer process for each run. The simulator runs on the Mac's CPU, shared with other simulators, so read the numbers against each other:

|                                                                      | `@for`       | `*lynxListFor` |
| -------------------------------------------------------------------- | ------------ | -------------- |
| Rows built at launch                                                 | 1,000        | 14             |
| Rows built after flinging to the last row                            | 1,000        | 19–28          |
| App component created → list's first `bindlayoutcomplete` (5–6 runs) | 726–1,164 ms | 39–87 ms       |
| Explorer's memory footprint with the list shown (`footprint`)        | 307 MB       | 92–93 MB       |
| The same after flinging to the last row                              | 560–745 MB   | 110–114 MB     |
| componentAtIndex per call while flinging, average                    | 5.3–9.1 ms   | 3.8–9.5 ms     |
| … of which the item's `__FlushElementTree` (instrumented runs)       | 9.0 ms       | 4.4–8.4 ms     |
| … calls over 16 ms, of ~1,000 (instrumented runs)                    | 76           | 37–45          |

The native flush of the item is most of componentAtIndex's cost either way; checking a reused row's view (`detectChanges()`) adds 0.7–1 ms on the simulator. Both modes have the odd call of several hundred ms, all of it inside the native flush. A recording of 12 flings (`simctl io recordVideo`) shows the same frame pacing for both, 56–57 changed frames a second while the list moves, with the recorder's own noise bigger than any difference.

The example switches between the two and counts the rows built.

## Binding the next row ahead, while the engine thread is idle (2026-11-28, #888)

`componentAtIndex` runs inside the list's layout pass, and the list waits for it. Most of its JavaScript was the row's check (`ListItemViews.bind()` → `detectChanges()`, about 82 µs for the benchmark's row under `node --jitless`, see #885 below). While the list scrolls, the next item native asks for is predictable, and the view it will get is usually in the pool already: native let go of a row scrolled away a frame or two before. So the row can be bound before native asks for it.

- **When.** After componentAtIndex shows a `*lynxListFor` item, the list sets a `setTimeout` (`LynxListElement.noteItemShown`, also from `componentAtIndexes`), which runs once native's layout pass has returned: a microtask would still run inside it. One timer per list, shared by every componentAtIndex before it fires. Only a componentAtIndex sets the next one, so it stops when the list does.
- **What.** The item after the last one native asked for, in the direction it last went (down or up the list). `ListItemViews.bindAhead()` takes the oldest view of the item's type from the pool, gives it the item, checks it as `bind()` does (out of change detection, then reattached), and puts it back in the pool as the newest, claimed by the item. It never builds a view: that would cost memory for an item native may never ask for. It skips an item that has a view (on screen, or its own in the pool), and one with `recyclable: false`, which keeps any view it gets out of the pool.
- **Then componentAtIndex** finds the item's view in the pool as for an item native asks for back, and only appends and flushes it, with `listReuseNotification`, since native last saw its element show another item. If the view's item, index or items changed since (`#show` marks it `stale`), it's checked as before.
- **A wrong guess** leaves a view checked for an item native doesn't show, claimed by it in the pool, which any item can take, as any pooled view: it costs only the check. A check that throws ahead leaves the view out of the pool and out of change detection, as a bind whose check throws already did: Angular stores a binding's new value before it sets the input, so an input setter that threw has its value cached in the view, and a later check of any item with the same value (the item, or the same object under another key) wouldn't set it, nor throw. The componentAtIndex that asks for the item checks it in another view, and throws there, as it would have.
- **What native gets.** The check ahead runs outside `bindListItem()`, as any check outside a list item, so its `end()` flushes the whole tree, outside the layout pass. That commits what the check wrote to an element native has let go of, as an update to a pooled row's item already did: on iOS the platform list keeps each element's UI, and its `listReuseNotification` (`listWillReuseNode:` → `onListCellPrepareForReuse:`) only resets a `<scroll-view>`'s offset, so committing a row's new props before it doesn't undo them. Native lays the row out with that flush, so the item's flush in componentAtIndex has less to do too.

Measured on the iOS Simulator (iPhone 18 Pro, iOS 27), the benchmark Pokédex built from master and from this change, the scroll test's 4 swipes with a Time Profiler trace each, 3 rounds alternating (`ComponentAtIndex` and `SetTimeTask` are the engine thread's tasks, split into JavaScript and layout):

| Per 4-swipe trace                                   | master          | binding ahead   |
| --------------------------------------------------- | --------------- | --------------- |
| `componentAtIndex`, JavaScript                      | 20, 32, 30 ms   | 10, 5, 10 ms    |
| `componentAtIndex`, layout                          | 18, 26, 22 ms   | 10, 3, 6 ms     |
| Timer tasks, JavaScript                             | 7, 9, 7 ms      | 23, 33, 28 ms   |
| Timer tasks, layout                                 | 2, 2, 0 ms      | 22, 29, 17 ms   |
| Instructions retired per swipe (XCTCPUMetric), mean | 651M (592–700M) | 651M (617–687M) |

So componentAtIndex, which the list's layout waits for, takes about a third of what it did (about 49 ms per trace down to 15), and the work it lost runs in the timer tasks after it: the same instructions in all. Under `node --jitless` against `list-for.test.ts`'s fake list (the benchmark's row, a 10-row window, 4,000 binds, 3 rounds alternating), componentAtIndex went from 88–95 µs a row to 4.2–4.5 µs, with 96–104 µs and 99–103 µs of JavaScript per row in all. The scroll test's screenshots show the rows as on master. The engine thread also runs Lynx's animator, so the work still costs a frame there; what changes is that the list no longer waits for it.

## Binding more than one row ahead: nothing left to bind (2026-11-28, #901)

Binding one row per idle moment left some rows to be checked inside `componentAtIndex`. #901 asked whether native asks for several rows per frame in a fling, so that binding as many rows ahead as it asked for since the last idle moment would catch them. It doesn't, and the rows that miss can't be bound ahead from the pool anyway. So the runtime still binds one row ahead.

**The setup.** A throwaway build of the benchmark Pokédex (`benchmarks/apps/angular-lynx`, master's packages packed in) counted, in the runtime's packed copy:

- each `*lynxListFor` row native asked for, and whether its view was checked ahead;
- how many it asked for between two bind-ahead timers;
- why a guess bound nothing (its item had a view, or no view was free);
- the views built.

An overlay showed the counts in the screenshots. On the iOS Simulator (iPhone 18 Pro, iOS 27), the scroll test ran its 5 swipes (a warm-up and 4 measured). On the Android emulator (the E2E tests' AVD, 1080×2400), 5 swipes of `adb shell input swipe` over 60 ms each threw the list about five times as far. A variant gave the rows 36 px rather than 106, so a fling crosses about three times as many. A second build bound as many rows ahead as native asked for since the last timer (up to 4), from the pool, without taking a view bound ahead for another of them.

**Per 5 swipes, on master** (the first screen's rows left out; ranges are 2 runs):

|                                       | iOS, the benchmark's rows | iOS, 36 px rows | Android |
| ------------------------------------- | ------------------------- | --------------- | ------- |
| Rows native asked for while scrolling | 38–39                     | 111–112         | 243     |
| … whose view was checked ahead        | 35–36                     | 75–77           | 221–223 |
| … that needed a new view (built)      | 3                         | 35–36           | 20–22   |
| Idle moments with 2 rows asked for    | 0                         | 1–2             | 14–16   |
| Idle moments with 1                   | 38–39                     | 107–110         | 211–215 |

- **Native asks for one row per idle moment.** On iOS it did for every row of the benchmark's flings, and for all but one or two rows in about 110 with rows a third as tall. On Android it asked for two in about 6% of the idle moments, in flings far faster than the iOS test's.
- **Every row that misses needs a new view.** A guess never found its item with a view already, and every row that wasn't checked ahead was one native asked for while the pool was empty: the first rows to scroll in (the 3 on iOS), or, with shorter rows or faster flings, a list that needs more views than it has built so far. Binding ahead takes only a view native let go of, so binding further ahead has nothing to bind them with. Building a view ahead would cost memory for an item native may never ask for, which #888 declined.
- **The multi-row build changed nothing measurable.** On Android it found a view checked ahead for 176 of 193 rows (91.2%), against 90.9–91.8% on master. Its second guesses mostly found no free view (9 of the 12 idle moments with two rows). On the iOS Simulator the share swung from run to run on both builds (39–91 of 112 with 36 px rows on it, 60–90 on master). That build is on the branch [`fix/al-901-multirow-archive`](https://github.com/Blotch-Smart-Frames/AngularLynx/tree/fix/al-901-multirow-archive) ([`984297f3`](https://github.com/Blotch-Smart-Frames/AngularLynx/commit/984297f3), on master `b8aab286`), with no PR.
- **Android takes a row checked ahead as iOS does.** Its platform list (`UIListAdapter` in `lynx-family/lynx`'s `platform/android`) lets go of a row's element when its view leaves the window (`onViewDetachedFromWindow` → `recycleHolderComponent` → enqueueComponent). When it asks for the element again, it puts the same `UIComponent`, props and all, in the new holder. The reuse notification (`LynxUIOwner.reuseListNode` → `onListCellPrepareForReuse`) only resets a `<scroll-view>`'s offset, so it doesn't undo the props the whole-tree flush committed before it. The screenshots after the Android flings show every row's name, number, sprite and type dots agreeing.

These are counts, not times: with the same rows checked ahead, `componentAtIndex` has the same work on both builds, so this didn't take Time Profiler traces. Each count is one run on a Mac shared with other simulators.

## What a rebound row costs, and what its shape changes (2026-11-28, #885)

After #884, the runtime's own share of a rebound row is small. Most of `componentAtIndex`'s JavaScript is Angular checking the row (`ListItemViews.bind()` → `detectChanges()`), and the runtime can't make a view cheaper to check. What a row's template asks for decides most of it.

**The setup.** This is a throwaway bench on `list-for.test.ts`'s fake native list. It runs under `node --jitless`, the closest Node gets to PrimJS, which has no JIT, with Angular in production mode. The row is the benchmark Pokédex's `PokemonItem`: a sprite, two texts, an `@if` around an `@for` of one or two type dots tracked by type, and a `FavouriteButton` child, both components with signal inputs. Native asks for 8,000 rows through a 10-row window over 1,000 items, so each bind reuses the view of a row 10 back.

**Where a bind goes** (~82 µs): Angular's refresh is about three quarters of it (`refreshView`, `executeTemplate`, the templates, signal inputs, `computed`). The `@for` of dots alone is about 30% (`ɵɵrepeater` → `reconcile`). A reused row's next Pokémon mostly has other types, and Angular's `@for` never gives a view to another key. So the row destroys one or two dot views and creates others on most binds, with their elements. In a CPU profile of the run, the `@for` took 223 of 727 ms, about 100 ms of it creating views, with the removals' commit at the end of the cycle on top. The runtime's `end()` is about 9%.

**The same row in other shapes** (µs per bind, the best of 4 runs on a loaded Mac):

| Row                                                                                       |  µs | vs the first row |
| ----------------------------------------------------------------------------------------- | --: | ---------------: |
| `PokemonItem` as in the benchmark                                                         |  83 |                  |
| … without the `@if` (the `@for` over `types() ?? []`)                                     |  82 |              −1% |
| … with the heart inlined rather than a `FavouriteButton` component                        |  79 |              −5% |
| … with the dots tracked by `$index`                                                       |  64 |             −22% |
| … tracked by `$index`, without the `@if`                                                  |  61 |             −27% |
| … tracked by `$index`, without the `@if`, the heart inlined                               |  54 |             −35% |
| … two dot views written out, hidden with `display: none` when there's no type (no `@for`) |  46 |             −45% |
| … two dot views written out, the heart inlined                                            |  40 |             −52% |

- **An `@for` whose keys change from item to item is a row's biggest single cost**, about 30% of the bind here. Tracking by `$index` keeps the views and updates their bindings in place. That's the right track for values with no identity of their own, such as a row's tags, dots or stars: nothing in them keeps state that should follow a value. Writing out a short list with a known maximum skips the embedded views altogether.
- **A child component costs a view check and its input writes**: the heart was 5%. A small leaf with no state of its own can be inlined, though a component doesn't cost much on its own.
- **An `@if` that stays true costs almost nothing.** It only costs when it flips, since flipping destroys or creates its view.

The benchmark app keeps `track type`. The ReactLynx app keys its `PokemonTypeDot`s by type (`key={type}`), so tracking by `$index` would have the Angular app do less than its rival does.

**The tick after each bind.** Before #877, every bind of this row notified Angular's scheduler about five times: three times from signal input writes, and once each from the `@for` view it attaches and the one it detaches. One tick follows each batch of binds, on the scheduler's timer. In the bench, a tick run after every bind cost 11.5 µs, 14% of the bind. On the Simulator, each row bound while the list scrolls gets a tick of its own (#894, below). The runtime can't drop the tick: it runs the `afterNextRender`/`afterRenderEffect` callbacks a row registered. Since #877 (the next section), the tick no longer walks down from the root to the rebound rows, and `end()` no longer flushes the whole tree after rows that wrote only inside their items. What's left is Angular's own bookkeeping.

On the Simulator the tick happens, but a Time Profiler trace can't single it out. #856's probe counted about 86 ticks in 5 swipes. Angular races a `setTimeout` against `requestAnimationFrame` for each tick, so a tick runs in either Lynx's timer task (`SetTimeTask`) or its frame callback. The timer task also runs the runtime's other timers, and the trace names no JavaScript functions. The traces below put 2–10 ms per 4-swipe trace in the timer task's JavaScript: the most that the ticks run from the timer cost. Timing the tick itself on a device takes a probe built into the app (there's no console in a Release build). These traces predate #877, which changed what the tick does. #894 timed the tick itself, below.

**On the iOS Simulator** the shapes barely show. That's the benchmark app's scroll test, 4 swipes, 3 rounds alternating. Each build was the benchmark app on master before #877, with its dots as in the benchmark, tracked by `$index`, or written out as two views. XCTCPUMetric instructions per swipe averaged about 660M, 649M (−2%) and 632M (−4%). That's inside the first build's own spread from swipe to swipe (602–723M), with ReactLynx at about 460M (#856). The Time Profiler put 15–29 ms of each 4-swipe trace in `componentAtIndex`'s JavaScript for every build, and 2–10 ms in the timer task's. A swipe binds only a handful of rows, so their checks are a small part of what the engine thread does in it. A cheaper row matters most where native waits for it: in the layout pass, as a row scrolls in.

**Binding ahead** of `componentAtIndex` moves this work out of the layout pass without removing it (#888, above).

## The tick after a bind: no walk from the root, and no flush for an item's own writes (2026-11-28, #877)

After componentAtIndex binds a `*lynxListFor` row, Angular has a tick scheduled. The row's check sets its child component's signal input, which marks the child for check and, through `markAncestorsForTraversal`, every view above the row up to the root, and notifies the scheduler. The tick then walked down from the root along those marks to find the row checked already, ran `begin()`/`end()` and the after-render hooks, and `end()` flushed the whole tree, since the row's writes counted as unflushed.

- **The row is checked out of change detection.** `ListItemViews.bind()` detaches the view, calls `detectChanges()`, then reattaches it, so the marks stop at the view: Angular's walk breaks at a view that isn't attached. `reattach()` notifies the scheduler, so a tick still follows every bind, as it did after most of them. It refreshes no view, and calls `begin()`/`end()` once (`synchronizeOnce`'s `!ranDetectChanges` branch). A rebind whose check throws leaves the view as it was: attached, or out of change detection if its item was gone.
- **A bind's writes inside its item count as flushed by the item's flush.** While a list item is bound (`bindListItemElement`, around `bindListItem`), each write a `LynxElement` counts notes where it is (`#noteBindingWrite`): it walks up from the element through `#jsParent` (or `_virtualParent`) to the `<list-item>` the run named (`setBoundListItem`). The walk also stops, as inside, at an element in no tree yet (`#jsParent` undefined: the view the run is building), since the insert that places it is itself a write to the new parent. A walk that reaches the page, or an element whose place the runtime doesn't know (`#jsParent` null), counts as outside, and so does any write counted without an element: `scheduleSettleFlush()`'s other callers (a page's color scheme or safe area, a gesture, a layout read) and a main-thread script's animation (`countNativeWrite`). An insert also checks the parent the child is moved from. Writes waiting from before the bind count too, unless the last bind left them (the next item of a batch). After componentAtIndex's flush, `settleAfterListItems()` marks the tree flushed if nothing was outside; otherwise it leaves it for the next cycle and the next event, as before. The note (`itemsLeftWork`) stays until a flush of the whole tree, so an item built inside another's flush doesn't mark the outer one's work flushed.

Measured under `node --jitless` against `list-for.test.ts`'s fake list, Angular in production mode, with a PokemonItem-like row (an `@if`/`@for` of type dots, a heart child, both with inputs that set signals), a 10-row window, 8,000 binds and `appRef.tick()` after each, three rounds alternating:

|                                  | Before       | After        |
| -------------------------------- | ------------ | ------------ |
| Bind (componentAtIndex), per row | 75.5–78.2 µs | 77.3–84.2 µs |
| The tick after it                | 13.5–14.1 µs | 10.9–11.9 µs |
| Whole-tree flushes per bind      | 1.00         | 0            |

What's left of the tick is Angular's: its scheduler and `afterTick` subscribers, and `end()`'s commit passes with nothing to commit. A row whose check marks nothing (no child components) used to schedule no tick, and now gets one from its `reattach()`, with nothing to flush. The fake flushes cost nothing here, so the table shows none of the native flush's cost; #871 found empty flushes too cheap for the simulator to tell apart.

## The tick after a bind, timed on the Simulator (2026-11-28, #894)

On the iOS Simulator, the tick after a bind takes about 65 µs on master, and #889 (#877) halved it. That's under 4% of what `componentAtIndex` spends on the row it bound: of the two, the bind is what costs. The probe didn't measure the engine thread's whole time per swipe, so this doesn't say what share of it either takes (the Time Profiler traces in #885 above put 15–29 ms of each 4-swipe trace in `componentAtIndex`'s JavaScript).

**The setup.** This was a throwaway build of the benchmark app (`benchmarks/apps/angular-lynx`), on master and on master with #889's runtime changes reverted. It wraps three things:

- `ApplicationRef._tick()`, which Angular's zoneless scheduler calls from its timer or its frame callback.
- The list's `componentAtIndex`. Native gets it from `__CreateList`, and again from `__UpdateListCallbacks` on every list update, so the probe wraps both.
- `__FlushElementTree()`, telling a tree flush (no element) from an item's.

A tick is "after a bind" when `componentAtIndex` ran since the tick before. A later run of master also tagged each tick with Angular's notification sources (`ChangeDetectionScheduler.notify()`). It shows the totals in an overlay above the list. The scroll test's screenshots before and after its swipes give the difference: 5 swipes (a warm-up and 4 measured), 3 rounds alternating, a Release build on the iPhone 18 Pro Simulator (iOS 27).

**The clock.** `performance.now()` on the main thread, the runtime's own (`canvas/dom-globals.ts`), was then built on `Date.now()`, so it stepped in whole milliseconds, longer than most ticks. The probe used `__date_clock()` instead. That's a main-thread global of the engine, which isn't documented, and it returns microseconds since the epoch. Since #896, `performance.now()` reads it too.

**Per 5 swipes** (each run bound 38 rows; the ranges are the 3 runs of each build):

|                                     | master         | #889 reverted                            |
| ----------------------------------- | -------------- | ---------------------------------------- |
| Ticks after a bind                  | 38             | 38                                       |
| … their time                        | 2.4–2.8 ms     | 5.2–6.1 ms                               |
| … per tick                          | 63–74 µs       | 138–161 µs                               |
| … tree flushes in them              | 0              | 38, 0.7–0.9 ms in all (about 20 µs each) |
| `componentAtIndex`                  | 67–73 ms       | 69–81 ms                                 |
| … of which the item's flush         | 36–37 ms       | 38–41 ms                                 |
| Other ticks, each with a tree flush | 10, 4.5–4.8 ms | 10, 4.4–5.2 ms                           |

- **Every row bound while the list scrolls gets its own tick.** Native asks for the rows one at a time as they come on screen, and each bind's tick runs before the next bind. Only the 10 rows of the first screen shared ticks (2 for 10 binds).
- **#889 saved about 90 µs per tick, about 3.4 ms per 5 swipes.** Only about 20 µs of that was the tree flush, which had nothing to commit. The rest was Angular's walk down from the root to the rebound row. A bind still notifies the scheduler about 7 times: about 3 marks from its signal input writes (`MarkAncestorsForTraversal`), 2.4 view attaches (its `reattach()` and the `@for`'s new dots) and 1.1 detaches (the dots it drops).
- **What's left is Angular's own bookkeeping**, at about 4% of the 1.8–1.9 ms a bind takes here. The item's native flush is about half of `componentAtIndex`, and Angular's check of the row is most of the rest (see #885 above).
- **The other ticks come from the row's pressed state.** Each swipe's finger lands on a row, and `PokemonItem` sets `pressing` on `bindtouchstart` and clears it on `bindtouchend`/`bindtouchcancel`. That's two listener ticks per swipe (Angular's `Listener` notification), each with a tree flush, at about 0.46 ms each.

XCTCPUMetric's instructions per swipe didn't tell the two builds apart: about 751M on master and 757M with #889 reverted, probe included. The difference is under 1%, inside the spread from swipe to swipe.

## No flush for a cycle that wrote nothing (2026-11-28, #856)

Angular ends as many change detection cycles that change nothing as ones that do. A tick that refreshes no view still calls the renderer's `begin()` and `end()` (`synchronizeOnce`'s `!ranDetectChanges` branch), and one runs after most `*lynxListFor` binds: a reused row whose `@if` lets go of a view makes Angular's `detachViewFromDOM` notify the scheduler. `end()` flushed the whole tree every time. In the benchmark Pokédex (iOS Simulator, 5 swipes) a probe counted 38 rows bound, 38 detail responses, about 86 ticks and about 86 cycles that wrote nothing, each with its flush.

`end()` now flushes only when something was written since the last flush of the whole tree, a list has an `update-list-info` to send, or a call waits for a flush (`needsTreeFlush()`, `hasPendingListUpdates()`). For that, `nativeWriteEpoch` counts every write: the ones that leave their flush to their caller, as before, and the ones that call `scheduleSettleFlush()`, which now counts itself. `markTreeFlushed()` also clears `settleSkippedForListItem`, since a whole-tree flush carries whatever a list item left. What componentAtIndex wrote still counts: the items' flushes commit the items only, and a bind can write outside its item (a directive reaching another element, an overlay it opens), so the cycle after a bind still flushes the tree. Telling an item's writes from the others would take a walk up from each element written to, on every bind (#871's review). #877 does that walk, below.

Empty flushes turned out cheap: skipping them made no difference to CPU per swipe that the simulator could measure. Most of what AngularLynx's engine thread did beyond ReactLynx's was the rows fetching their details as they were bound, a tick, flush and layout per response while the list scrolled, where ReactLynx fetches a page's details when it arrives. The benchmark app now does that too (`benchmarks/apps/angular-lynx`): about 850M instructions per swipe went down to about 690M, against ReactLynx's 460M. What's left is mostly Angular checking each bound row on the main thread.

## One flush for every list a cycle changes (2026-11-16)

`LynxRendererFactory2.end()` used to flush the tree, then each list the cycle changed set its `update-list-info` and flushed from the root with `triggerLayout`: N + 1 whole-tree flushes for N lists. Outside a cycle, the settle flush came first and then a flush per list. Each one is a native patch pass (resolve, `FinishTasmOperation`, layout) that also queues UI-thread work.

Now the lists send their `update-list-info` (and their callbacks) right before the one flush (`flushTreeWithListUpdates()`, `lynx-element/list-updates.ts`), as React Lynx does: `updateMainThread.ts` and `renderPage` call `__pendingListUpdates.flush()`, which only sets each list's attribute, then make one `__FlushElementTree(__page, flushOptions)`. The settle flush carries lists changed outside a cycle (a lazy route's static `<list-item>`s); lists changed in one task outside a cycle with no settle flush share one microtask's flush; the lists the first render changes wait for it, as before, and then share one flush.

- **Why one flush does what the N + 1 did.** Native resolves everything dirty from the root first, the lists' `update-list-info` included, then lays out once; each list asks for its items in that layout. componentAtIndex appends an item and flushes it with the operation id, which is what commits the item's subtree: until then the item isn't in the page's tree, and a root flush walks only the tree (`Element::FlushActionsAsRoot`), so the bare flush before never committed it. A flush with no options lays out by default (`trigger_layout_ = true`, `core/public/pipeline_option.h`), but inside a pipeline context it takes that context's options (`renderer_functions.cc`, `FiberFlushElementTree`); the merged flush passes `{ triggerLayout: true }` when lists were sent, as theirs did.
- **Unchanged:** no flush while a `*lynxListFor` item is being built (`bindListItem`), never an empty `update-list-info`, and the UI method calls waiting for a flush run after it, once lists have their items.
- **A list that throws** while its update is sent (native refusing its `update-list-info`) doesn't cost the flush: the other lists are sent, the flush is made, the calls waiting for it run, and then the first error is thrown. Before, `end()`'s bare flush had already gone out by then.
- **A UI method on a list, in the cycle that changes the list, now reaches it after the list's new items.** `invoke()` calls `__InvokeUIMethod` at once, and with pending invokes native keeps the call until the element's next flush, where it runs after the element's props (`FlushPendingInvokeTasks`, `fiber_element.cc`). The bare flush used to be that flush, so a `scrollToPosition` from a view effect (a chat scrolling to its newest row) reached the list while it still had its old items, and the update came with the next flush. Now the call and the `update-list-info` go in the same flush, the call after: React Lynx's order, and what an app means. `list-update-flush.test.ts` pins it.
- **A list made and filled in one cycle** goes out in the same flush that makes it, as React Lynx's first screen does. The crash `list-item.md` once blamed on that (H1, H2) was the `WeakSet` keyed on element refs, fixed since; the probe below made and filled two lists in one cycle on iOS without a problem.

Measured with a probe app on the iOS Simulator (Lynx Explorer 4.1, iPhone 18 Pro, iOS 27), which wrapped `__FlushElementTree` to count the calls with no element (whole tree) and time them. Screen: a `*lynxListFor` list, an `@for` list, and a `*lynxListFor` list whose items each hold a horizontal `@for` list; a step adds a row to the three lists and a chip to every nested list. The Mac was heavily loaded (load average 30–44), so the times are ranges:

|                                                                        | Before            | After                            |
| ---------------------------------------------------------------------- | ----------------- | -------------------------------- |
| Whole-tree flushes, one step (3 lists + 3 nested lists shown)          | 7 (6 with layout) | 1                                |
| Two lists made and filled in one cycle (`@if`)                         | 3 (2 with layout) | 1                                |
| Navigating to a lazy route with two lists (static + `@for`)            | 8 (6 with layout) | 2 (the settle flush, the tick's) |
| A row added to both of its lists                                       | 3 (2 with layout) | 1                                |
| 30 steps in a row with `ApplicationRef.tick()`, per step (6 runs each) | 12.3–29.2 ms      | 8.1–12.7 ms (one run 32 ms)      |

Rows appeared, scrolled and updated the same before and after, on iOS and in the web preview (where Lynx for Web asks for items in a microtask after `update-list-info`, whatever the flushes). `end()` itself costs the same JS either way: under `node --jitless` against fake native functions, a cycle changing 2–4 lists ran within noise of before, with K + 1 flushes down to 1.

## Problem

`x-list` in `elements-showcase.component.ts` crashes when the Layout Elements Section loads:

```html
<x-list class="mini-list">
  @for (i of [1, 2, 3]; track i) {
  <list-item class="list-item">
    <x-text>List Item {{ i }}</x-text>
  </list-item>
  }
</x-list>
```

The `list-example` component also has its x-list commented out — it has never worked.

## Current Implementation

### Architecture

Lynx's native `x-list` is a **virtualized list** driven by engine callbacks, not a simple container. It works fundamentally differently from web DOM:

1. **Native engine calls `componentAtIndex(listRef, listId, cellIndex, opId)`** to request the element ID at a given index
2. **`update-list-info` attribute** tells the engine which indices exist (insertAction/removeAction/updateAction)
3. **`enqueueComponent`** signals items scrolled off-screen (recycling — currently disabled)

### How Angular's `LynxListElement` bridges this

Since Angular's `Renderer2` uses normal `appendChild()` / `insertBefore()`, `LynxListElement` intercepts these calls:

1. `appendChild()` → adds child to a **JS-level virtual linked list** (not the native tree)
2. `_scheduleUpdate()` → batches via `setTimeout(0)`, then:
   - Filters out Angular comment nodes (from `@for`/`@if`)
   - Sets `item-key` attribute on each list-item
   - Pre-appends children to the native list tree via `__AppendElement`
   - Sets `update-list-info` with `insertAction` array
   - Calls `__FlushElementTree()`
3. `componentAtIndex` → returns `__GetElementUniqueID(uiChildren[cellIndex])`

### Key files

| File                                                       | Role                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `packages/runtime/src/lib/lynx-document.ts` (lines 59–118) | Creates native list, registers callbacks, sets config |
| `packages/runtime/src/lib/lynx-element.ts` (lines 201–353) | `LynxListElement` — virtual tree, batching, flush     |
| `packages/runtime/src/lib/types/lynx.ts` (lines 109–123)   | `__CreateList` type signature                         |

## Fixes Already Applied (didn't resolve crash)

### 1. Added `type` field to `insertAction`

The React Lynx reference always includes a `type` (reuse-identifier) in each insertAction entry. Added `type: '__angular_list_item'` to match.

### 2. Set required `list-type` and `span-count` attributes

Lynx docs state these are required on x-list. Added defaults: `list-type="single"`, `span-count=1`.

## Remaining Hypotheses

### H1: `__FlushElementTree()` needs list-specific arguments

Current code calls `__FlushElementTree()` with no arguments. But the type signature shows:

```typescript
function __FlushElementTree(
  element?: ElementRef,
  options?: {
    triggerLayout?: boolean;
    operationID?: number;
    elementID?: number;
    listID?: number;
    // ...
  },
): void;
```

The React Lynx reference calls it with the **list element** and `{ listID, elementID, operationID, triggerLayout: true }`. Without `listID`, the native engine may not know this flush is list-related and may skip calling `componentAtIndex`.

**Potential fix:**

```typescript
const listId = __GetElementUniqueID(this.element);
__FlushElementTree(this.element, {
  triggerLayout: true,
  listID: listId,
});
```

### H2: Pre-appending children before `update-list-info` causes the issue

The current flow:

1. `__AppendElement(list, child)` for each child
2. `__SetAttribute(list, 'update-list-info', {...})`
3. `__FlushElementTree()`

But the React Lynx reference does it differently inside `componentAtIndex`:

1. Appends child to list
2. Calls `__FlushElementTree(child, { listID, ... })`

The native engine might not support pre-appending all children before the flush. It may expect children to be appended **during** `componentAtIndex` (one at a time, per-item flush).

**Potential fix:** Instead of pre-appending, do the append + flush inside `componentAtIndex`:

```typescript
const componentAtIndex = (listRef, listId, cellIndex, opId) => {
  const uiChildren = listEl.getUIChildren();
  if (cellIndex < uiChildren.length) {
    const child = uiChildren[cellIndex];
    if (!listEl.isAppendedToNative(child)) {
      __AppendElement(listEl.element, child);
      listEl.markAppendedToNative(child);
      __FlushElementTree(child, {
        triggerLayout: true,
        operationID: opId,
        elementID: __GetElementUniqueID(child),
        listID: listId,
      });
    }
    return __GetElementUniqueID(child);
  }
  return undefined;
};
```

**Risk:** The existing code comments warn that calling `__AppendElement` or `__FlushElementTree` inside `componentAtIndex` is "re-entrant and crashes on device." However, this is exactly what the React Lynx reference does. The previous crash may have been from calling `__FlushElementTree()` without arguments (full tree flush) inside the callback, rather than flushing just the child element.

### H3: `update-list-info` format is wrong

The exact format expected might differ from what we send. Current:

```json
{
  "insertAction": [
    { "position": 0, "type": "__angular_list_item", "item-key": "123" }
  ],
  "removeAction": [],
  "updateAction": []
}
```

Possible issues:

- Maybe the value needs to be a JSON **string**, not an object
- Maybe `position` should be string type
- Maybe additional fields are needed (e.g., `estimatedMainAxisSizePx`)

### H4: `setTimeout(0)` timing issue in Lynx runtime

Lynx's JS runtime may not support standard `setTimeout` semantics. The batching approach relies on `setTimeout(0)` firing after Angular's synchronous render completes. If Lynx's runtime executes `setTimeout(0)` callbacks differently (or the native list attempts to render before the callback fires), children won't be ready.

**Potential fix:** Use `queueMicrotask()` instead (fires sooner, before any native layout pass):

```typescript
queueMicrotask(() => {
  /* ... */
});
```

Or use `Promise.resolve().then(...)`.

### H5: The native list needs explicit height on list-items

The CSS sets `.mini-list { height: 120px }` but list-items only have `padding: 8px`. If the native engine needs `estimated-main-axis-size-px` on each `list-item` element (not just `estimatedItemSize` on the list config), items may have zero height causing layout failures.

## Fixes Applied

### Round 2 — Root causes from Lynx docs + React Lynx reference

After reading the official Lynx docs ([`lynx-website/docs/en/api/elements/built-in/list.mdx`](https://github.com/lynx-family/lynx-website/blob/main/docs/en/api/elements/built-in/list.mdx)) and confirming against the React Lynx codebase:

1. **Missing required `scroll-orientation` attribute** — The Lynx docs mark `scroll-orientation` as Required on `<list>`. We only set `list-type` and `span-count`. Added `scroll-orientation: "vertical"` default.

2. **Removed invalid `__SetConfig()` call** — `recycleEnabled`, `estimatedItemSize`, `overscrollEnabled` are NOT valid list config properties. React Lynx never uses `__SetConfig` for lists (confirmed via grep). Removed entirely.

3. **Fixed `__FlushElementTree()` call** (H1) — Replaced bare `__FlushElementTree()` with `__FlushElementTree(this.element, { triggerLayout: true, listID })`. React Lynx always passes element + list-specific options. The bare call flushed the entire page causing re-entrant crashes when `componentAtIndex` did its own per-item flush.

4. **Added `recyclable: false`** on each list-item — Since we don't implement recycling in `enqueueComponent`, tell the native engine not to recycle items.

## Next Steps (if still crashing)

1. **Try `queueMicrotask`** instead of `setTimeout(0)` — more predictable timing in Lynx runtime.
2. **Add `estimated-main-axis-size-px`** on each list-item — Lynx docs say "strongly recommended".
3. **Add on-screen debug logging** to see which stage fails.

## Reference: React Lynx approach (production-proven)

[`lynx-stack/packages/react/runtime/src/snapshot/snapshot/list.ts`](https://github.com/lynx-family/lynx-stack/blob/main/packages/react/runtime/src/snapshot/snapshot/list.ts)

React Lynx renders items **lazily inside `componentAtIndex`**:

1. `componentAtIndex(cellIndex)` is called by native engine
2. It calls `ensureElements()` to render the component tree for that item
3. Calls `__AppendElement(list, root)` to attach item to list
4. Calls `__FlushElementTree(root, { triggerLayout: true, operationID, elementID, listID })`
5. Returns `__GetElementUniqueID(root)`

Key difference: React never pre-appends all children. It renders on-demand per `componentAtIndex` call. The `update-list-info` insertAction tells the engine _how many_ items exist, then the engine calls `componentAtIndex` for each visible index.
