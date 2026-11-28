#!/usr/bin/env node
// Times the AngularLynx app's mount screen in Node, with no device, and says
// where its JavaScript goes (issue #909).
//
// It runs the app's built main-thread script (dist/.lynx/main/main-thread.js)
// in a `vm` context whose `__*` element functions are cheap fakes: plain
// objects in a tree, with no layout and no drawing. What's left is the
// JavaScript the main thread runs to build the screen: Angular's, the
// runtime's and the app's. Each mount is timed from the screen's
// `markEvent('MountStart')` to its `reportFullyDrawn()`, the marks the
// device harnesses read (ios_mount.py, android_mount.py), in the main
// thread's CPU time rather than wall time, so the other work a Mac does
// meanwhile counts for little: two runs of one build agree within about 1%,
// where their wall times drift by 3%.
//
// Run it under `node --jitless`, the closest Node gets to PrimJS, the
// interpreter Lynx runs the main thread on: with V8's JIT, the runtime's
// small functions inline away and the shares look nothing like a phone's.
// Its milliseconds are Node's, not a phone's; compare them only with each
// other, on the same machine.
//
// Build the screen first, not minified, so the profile names the functions
// (BENCH_NO_MINIFY, see ../apps/angular-lynx/lynx.config.mts):
//
//   cd benchmarks/apps/angular-lynx
//   DEBUG=rspeedy BENCH_NO_MINIFY=1 BENCH_SCREEN='mount?kind=view&count=15000' \
//     npx ng build --environment lynx
//
// (DEBUG=rspeedy keeps dist/.lynx/main/main-thread.js, which a production
// build deletes once it's in the bundle.)
//   node --jitless ../../harness/node-mount.mjs --runs 10 --profile
//
// To measure a change, copy the script aside, build again with the change,
// and give both: the runs alternate between them, so both see the machine
// alike, and it prints how far the second's median and fastest run are from
// the first's.
//
//   cp dist/.lynx/main/main-thread.js /tmp/before.js
//   (change the runtime, rebuild it and use-local-packages.mjs, rebuild)
//   node --jitless ../../harness/node-mount.mjs --runs 20 \
//     --script /tmp/before.js --script dist/.lynx/main/main-thread.js
//
// Options:
//   --script <path>   a main-thread script (default: the app's dist); give
//                     two to compare them
//   --runs <n>        mounts of each script to time, each in a fresh
//                     context (default 5)
//   --profile [file]  then profile one more mount of the last script, print
//                     each package's share of it and the runtime's heaviest
//                     functions (with the calls below them, the fake element
//                     functions left out), and save the .cpuprofile if a file
//                     is given. The profiler slows what it samples: its
//                     milliseconds are larger than the timed runs'
//   --top <n>         how many of the runtime's functions to list (default 25)
import { Session } from 'node:inspector';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT = path.join(
  HERE,
  '../apps/angular-lynx/dist/.lynx/main/main-thread.js',
);

const parseArgs = (argv) => {
  const options = { scripts: [], runs: 5, profile: null, top: 25 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--script') options.scripts.push(path.resolve(argv[++i]));
    else if (arg === '--runs') options.runs = Number(argv[++i]);
    else if (arg === '--top') options.top = Number(argv[++i]);
    else if (arg === '--profile') {
      options.profile = next && !next.startsWith('--') ? argv[++i] : '';
    } else throw new Error(`Unknown option ${arg}`);
  }
  if (options.scripts.length === 0) options.scripts.push(DEFAULT_SCRIPT);
  return options;
};

/**
 * The fake element functions: just enough of Lynx's element tree for the
 * runtime's reads (parents, siblings, classes, attributes) to see what its
 * writes did, and nothing else. Counts each call, so a change's saving in
 * native calls shows too.
 */
const makeElementApi = () => {
  let nextId = 1;
  const byId = new Map();
  let page = null;

  const make = (tag) => {
    const element = {
      tag,
      id: nextId++,
      parent: null,
      children: [],
      classes: '',
      attrs: {},
      style: '',
      cssId: 0,
    };
    byId.set(element.id, element);
    return element;
  };
  const detach = (child) => {
    const parent = child.parent;
    if (!parent) return;
    const index = parent.children.indexOf(child);
    if (index !== -1) parent.children.splice(index, 1);
    child.parent = null;
  };
  const sibling = (element, step) => {
    const parent = element.parent;
    if (!parent) return null;
    return parent.children[parent.children.indexOf(element) + step] ?? null;
  };

  const api = {
    __CreatePage: () => (page = make('page')),
    __CreateView: () => make('view'),
    __CreateText: () => make('text'),
    __CreateImage: () => make('image'),
    __CreateScrollView: () => make('scroll-view'),
    __CreateList: () => make('list'),
    __CreateFrame: () => make('frame'),
    __CreateWrapperElement: () => make('wrapper'),
    __CreateElement: (tag) => make(tag),
    __CreateRawText: (text) => {
      const element = make('raw-text');
      element.attrs.text = text;
      return element;
    },
    __GetElementUniqueID: (element) => (element ? element.id : -1),
    __GetElementByUniqueID: (id) => byId.get(id) ?? null,
    __GetPageElement: () => page,
    __GetTag: (element) => element.tag,
    __AppendElement: (parent, child) => {
      detach(child);
      parent.children.push(child);
      child.parent = parent;
      return child;
    },
    __InsertElementBefore: (parent, child, ref) => {
      detach(child);
      const index = ref ? parent.children.indexOf(ref) : -1;
      if (index === -1) parent.children.push(child);
      else parent.children.splice(index, 0, child);
      child.parent = parent;
      return child;
    },
    __RemoveElement: (parent, child) => {
      detach(child);
      return child;
    },
    __ReplaceElement: (fresh, old) => {
      const parent = old.parent;
      if (!parent) return;
      const index = parent.children.indexOf(old);
      detach(fresh);
      parent.children[index] = fresh;
      fresh.parent = parent;
      old.parent = null;
    },
    __GetParent: (element) => element.parent,
    __FirstElement: (element) => element.children[0] ?? null,
    __LastElement: (element) => element.children.at(-1) ?? null,
    __NextElement: (element) => sibling(element, 1),
    __GetChildren: (element) => element.children.slice(),
    __SetClasses: (element, classes) => {
      element.classes = classes;
    },
    __AddClass: (element, name) => {
      element.classes = element.classes ? `${element.classes} ${name}` : name;
    },
    __GetClasses: (element) => element.classes.split(' ').filter(Boolean),
    __SetAttribute: (element, name, value) => {
      element.attrs[name] = value;
    },
    __GetAttributeByName: (element, name) => element.attrs[name],
    __GetAttributes: (element) => ({ ...element.attrs }),
    __GetAttributeNames: (element) => Object.keys(element.attrs),
    __AddInlineStyle: () => {},
    __SetInlineStyles: (element, style) => {
      element.style = style;
    },
    __GetInlineStyles: () => ({}),
    __SetID: (element, id) => {
      element.attrs.id = id;
    },
    __SetCSSId: (elements, cssId) => {
      for (const element of elements) element.cssId = cssId;
    },
    __SetDataset: () => {},
    __AddDataset: () => {},
    __GetDataset: () => ({}),
    __AddEvent: () => {},
    __SetEvents: () => {},
    __GetEvents: () => [],
    __QuerySelector: () => null,
    __QuerySelectorAll: () => [],
    __FlushElementTree: () => {},
  };
  /**
   * Each counts its calls, and every other `__*` function the script names
   * does nothing. Four arguments are as many as any of them takes.
   */
  const counted = (name) => {
    const fn = api[name] ?? (() => undefined);
    const counter = { name, n: 0 };
    counters.push(counter);
    return (a, b, c, d) => {
      counter.n++;
      return fn(a, b, c, d);
    };
  };
  const counters = [];
  const calls = () =>
    new Map(counters.filter((c) => c.n > 0).map((c) => [c.name, c.n]));
  const resetCalls = () => {
    for (const counter of counters) counter.n = 0;
  };
  return { api, counted, calls, resetCalls };
};

/**
 * The main thread's CPU time, in milliseconds: the mount's cost without the
 * time the thread waits while the machine runs other work, which wall time
 * would count.
 */
const cpuNow = () => {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
};

/**
 * One mount, in a fresh context: resolves with its time and native calls.
 */
const mount = (source, filename, { onStart, onEnd } = {}) =>
  new Promise((resolve, reject) => {
    const { api, counted, calls, resetCalls } = makeElementApi();
    let start = 0;
    const shell = {
      invoke(method, name) {
        if (method === 'markEvent' && name === 'MountStart') {
          onStart?.();
          // Counted from here: the calls before are the launch's.
          resetCalls();
          start = cpuNow();
        } else if (method === 'reportFullyDrawn') {
          const ms = cpuNow() - start;
          onEnd?.();
          resolve({ ms, calls: calls() });
        }
      },
    };
    const context = {
      console: {
        log() {},
        info() {},
        debug() {},
        warn() {},
        error: (...args) => console.error('[main thread]', ...args),
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      queueMicrotask,
      performance,
      Promise,
      lynx: {
        module: (name) => (name === 'AngularLynxShell' ? shell : undefined),
        __globalProps: {},
        __initData: {},
        performance: {},
        getJSModule: () => ({ addListener() {}, removeListener() {} }),
        reportError: (error) => reject(error),
      },
      SystemInfo: {
        platform: 'iOS',
        pixelRatio: 3,
        pixelWidth: 1179,
        pixelHeight: 2556,
        lynxSdkVersion: '3.4',
      },
    };
    // The script calls the element functions as globals, so each is a
    // property of the context: the fakes above, and each other `__*`
    // function the script names.
    const names = new Set([
      ...Object.keys(api),
      ...(source.match(/\b__[A-Z][A-Za-z]+\b/g) ?? []),
    ]);
    for (const name of names) context[name] = counted(name);
    vm.createContext(context);
    context.globalThis = context;
    try {
      vm.runInContext(source, context, { filename });
      context.renderPage({});
    } catch (error) {
      reject(error);
    }
  });

/**
 * Which package a line of the bundle is in, from its module comments.
 */
const moduleOfLines = (source) => {
  const owners = [];
  let current = '(app)';
  const lines = source.split('\n');
  for (const line of lines) {
    const concatenated = line.match(/CONCATENATED MODULE: (\S+)/);
    if (concatenated) current = concatenated[1];
    else if (/^"[A-Za-z0-9_$]+"\(/.test(line)) current = '(module)';
    owners.push(current);
  }
  return owners;
};

const packageOf = (module) => {
  const match = module.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (match) return match[1];
  return module.startsWith('./src') ? '(app)' : module;
};

/**
 * Adds up a CPU profile: each package's self time, and each runtime
 * function's total time (calls below it included, the fake native calls
 * left out), as the issue's tables give them.
 */
const summarize = (profile, file, owners, top) => {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id);
  }
  const intervals = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    intervals.set(id, (intervals.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  const where = (node) => {
    const { url, lineNumber, functionName } = node.callFrame;
    if (!url.endsWith(path.basename(file)))
      return { pkg: '(harness)', name: functionName };
    const module = owners[lineNumber] ?? '(unknown)';
    return {
      pkg: packageOf(module),
      name: `${functionName || '(anonymous)'}:${lineNumber + 1}`,
    };
  };
  const harness = path.basename(fileURLToPath(import.meta.url));
  const script = path.basename(file);
  /**
   * Whether a sample is in a fake element function, or the wrapper that
   * counts its calls: walking up from where it was taken, a frame of this
   * file comes before any of the script's. Frames of this file further up,
   * such as the one that calls renderPage(), are the script's callers, and
   * leave its samples counted.
   */
  const insideFake = (id) => {
    for (let at = id; at !== undefined; at = parents.get(at)) {
      const { url } = nodes.get(at).callFrame;
      if (url.endsWith(script)) return false;
      if (url.endsWith(harness)) return true;
    }
    return false;
  };
  const selfByPackage = new Map();
  const totalByFunction = new Map();
  let all = 0;
  for (const [id, micros] of intervals) {
    all += micros;
    const node = nodes.get(id);
    const own = where(node);
    selfByPackage.set(own.pkg, (selfByPackage.get(own.pkg) ?? 0) + micros);
    // A sample in one of the fake element functions (defined in this file)
    // counts for no function's total: the runtime function that called it
    // would otherwise be charged the fake's time, which a phone spends in
    // Lynx's native code instead.
    if (insideFake(id)) continue;
    // Each function on the stack once, for its total.
    const seen = new Set();
    for (let at = id; at !== undefined; at = parents.get(at)) {
      const frame = where(nodes.get(at));
      const key = `${frame.pkg} ${frame.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      totalByFunction.set(key, (totalByFunction.get(key) ?? 0) + micros);
    }
  }
  const ms = (micros) => (micros / 1000).toFixed(1).padStart(8);
  console.log(`\nSelf time by package (of ${ms(all).trim()} ms sampled):`);
  for (const [pkg, micros] of [...selfByPackage].sort((a, b) => b[1] - a[1])) {
    console.log(
      `${ms(micros)} ms  ${((micros / all) * 100).toFixed(1).padStart(5)}%  ${pkg}`,
    );
  }
  console.log(`\nThe runtime's heaviest functions, calls below included:`);
  const runtime = [...totalByFunction]
    .filter(([key]) => key.startsWith('@blotch/angular-lynx '))
    .sort((a, b) => b[1] - a[1])
    .slice(0, top);
  for (const [key, micros] of runtime) {
    console.log(
      `${ms(micros)} ms  ${key.slice('@blotch/angular-lynx '.length)}`,
    );
  }
};

// The screen's calls to the background thread (the shell's module through
// NativeModules, a fetch) have no thread to go to here, and reject: they're
// not part of what the mount builds.
process.on('unhandledRejection', (error) => {
  if (!/background thread/.test(String(error?.message))) throw error;
});

const options = parseArgs(process.argv.slice(2));
const scripts = options.scripts.map((file) => ({
  file,
  source: readFileSync(file, 'utf8'),
  times: [],
  calls: null,
}));

// Runs each script in turn, run after run, so that two builds compared see
// the same machine: on a Mac doing other work, the time a mount takes drifts
// by more than a small change saves.
for (let run = 0; run < options.runs; run++) {
  for (const script of scripts) {
    const result = await mount(script.source, script.file);
    script.times.push(result.ms);
    script.calls = result.calls;
  }
}

const stats = (times) => {
  const sorted = [...times].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)] };
};
for (const script of scripts) {
  const { min, median } = stats(script.times);
  console.log(
    `${path.relative(process.cwd(), script.file)}: median ${median.toFixed(1)} ms, ` +
      `min ${min.toFixed(1)} ms over ${script.times.length} runs`,
  );
}
if (scripts.length === 2) {
  const [a, b] = scripts.map((script) => stats(script.times));
  const change = (x, y) => `${(((y - x) / x) * 100).toFixed(1)}%`;
  console.log(
    `second vs first: median ${change(a.median, b.median)}, min ${change(a.min, b.min)}`,
  );
}
console.log('\nNative calls in the mount:');
for (const script of scripts) {
  if (scripts.length > 1)
    console.log(path.relative(process.cwd(), script.file));
  for (const [name, n] of [...script.calls].sort((x, y) => y[1] - x[1])) {
    console.log(`${String(n).padStart(8)}  ${name}`);
  }
}

// A profile from a run of its own, after the timed ones: the profiler slows
// the code it samples.
if (options.profile !== null) {
  const script = scripts.at(-1);
  let session = null;
  await mount(script.source, script.file, {
    onStart: () => {
      session = new Session();
      session.connect();
      session.post('Profiler.enable');
      session.post('Profiler.setSamplingInterval', { interval: 100 });
      session.post('Profiler.start');
    },
  });
  const profile = await new Promise((resolve, reject) =>
    session.post('Profiler.stop', (error, value) =>
      error ? reject(error) : resolve(value.profile),
    ),
  );
  session.disconnect();
  if (options.profile) writeFileSync(options.profile, JSON.stringify(profile));
  summarize(profile, script.file, moduleOfLines(script.source), options.top);
}
