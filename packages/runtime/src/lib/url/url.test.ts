import { describe, expect, it } from 'vitest';
import { LynxURL } from './url';
import { LynxURLSearchParams } from './url-search-params';

/**
 * Node's `URL` implements the WHATWG URL Standard, so it is the reference the
 * polyfill is checked against: for each input, both must produce the same
 * components, or both must throw.
 */
const NativeURL = globalThis.URL;
const NativeURLSearchParams = globalThis.URLSearchParams;

const COMPONENTS = [
  'href',
  'origin',
  'protocol',
  'username',
  'password',
  'host',
  'hostname',
  'port',
  'pathname',
  'search',
  'hash',
] as const;

const describeUrl = (create: () => Record<string, unknown>) => {
  try {
    const url = create();
    return Object.fromEntries(COMPONENTS.map((key) => [key, url[key]]));
  } catch (error) {
    return { throws: (error as Error).name };
  }
};

const expectSameAsNative = (input: string, base?: string) => {
  expect(
    describeUrl(() => new LynxURL(input, base) as never),
    `new URL(${JSON.stringify(input)}${base === undefined ? '' : `, ${JSON.stringify(base)}`})`,
  ).toEqual(describeUrl(() => new NativeURL(input, base) as never));
};

describe('LynxURL parsing matches the WHATWG URL Standard', () => {
  it.each([
    // What Angular itself parses: the Router's protocol-relative check, and
    // HttpClient's `resolve://` base.
    ['/lazy', 'http://fake'],
    ['/', 'http://fake'],
    ['//evil.com/path', 'http://fake'],
    ['/a/b?x=1#frag', 'http://fake'],
    ['https://api.example.com/users', 'resolve://'],
    ['/users?id=1', 'resolve://'],
    ['users', 'resolve://'],
    // Absolute URLs.
    ['https://example.com'],
    ['HTTPS://EXAMPLE.COM/A/B'],
    ['http://example.com:80/'],
    ['http://example.com:8080/x'],
    ['https://example.com:443'],
    ['ws://example.com:80/socket'],
    ['wss://example.com:443/socket'],
    ['ftp://example.com:21/file'],
    ['http://user:pass@example.com/'],
    ['http://user@example.com/'],
    ['http://:pass@example.com/'],
    ['http://a:p@ss@example.com/'],
    ['http://us er:pa ss@example.com/'],
    ['http://example.com/a b/c"d<e>f`g{h}i^j'],
    ['http://example.com/?q=a b"c#d'],
    ["http://example.com/?q='x'"],
    ["foo://example.com/?q='x'"],
    ['http://example.com/#a b"c<d>e`f'],
    ['http://example.com/café?café#café'],
    ['http://example.com/😀'],
    ['http://example.com/\ud800'],
    ['http://example.com/%7e%2F%zz'],
    ['  \t http://example.com/\na\tb  \u0000'],
    ['http:\\\\example.com\\a\\b'],
    ['http:////example.com/x'],
    ['http://example.com'],
    ['http://example.com?q'],
    ['http://example.com#f'],
    ['http://example.com/a/./b/../c'],
    ['http://example.com/a/b/..'],
    ['http://example.com/a/b/.'],
    ['http://example.com/a/%2e/b/%2E%2e/c/.%2e/%2e.'],
    ['http://example.com/../../a'],
    ['http://example.com/?'],
    ['http://example.com/#'],
    // Hosts.
    ['http://EXAMPLE.com.'],
    ['http://ex%41mple.com/'],
    ['http://münchen.de/'],
    ['http://例。测试/'],
    ['http://éxämple-ü.com/'],
    ['http://xn--nxasmq6b.com/'],
    ['http://ex ample.com/'],
    ['http://exa%mple.com/'],
    ['http://exa<mple.com/'],
    ['http://exa%00mple.com/'],
    ['http://%/'],
    ['http://127.0.0.1/'],
    ['http://127.1/'],
    ['http://0x7f.0.0.1/'],
    ['http://0177.0.0.1/'],
    ['http://2130706433/'],
    ['http://0x/'],
    ['http://00/'],
    ['http://1.2.3.4.5/'],
    ['http://256.0.0.1/'],
    ['http://1.2.3.256/'],
    ['http://1.2.65536/'],
    ['http://1.2.3.4./'],
    ['http://1.2.3.09/'],
    ['http://0x1g/'],
    ['http://1.2.3.foo/'],
    ['http://foo.0x10/'],
    ['http://foo.09/'],
    ['http://foo.1x/'],
    ['http://./'],
    ['http://[::1]/'],
    ['http://[::1]:8080/'],
    ['http://[0:0:0:0:0:0:0:1]/'],
    ['http://[1:0:0:2:0:0:0:3]/'],
    ['http://[1:0:2:0:3:0:4:0]/'],
    ['http://[1:2:3:4:5:6:7:8]/'],
    ['http://[0:0:1:2:3:4:5:6]/'],
    ['http://[1::]/'],
    ['http://[::]/'],
    ['http://[ABCD::EF]/'],
    ['http://[::ffff:192.168.0.1]/'],
    ['http://[::1.2.3.4]/'],
    ['http://[1:2:3:4:5:6:1.2.3.4]/'],
    ['http://[1:2:3:4:5:6:7:1.2.3.4]/'],
    ['http://[::1.2.3]/'],
    ['http://[::1.2.3.4.5]/'],
    ['http://[::1.2.3.256]/'],
    ['http://[::01.2.3.4]/'],
    ['http://[::1.2.3.a]/'],
    ['http://[::1.2..3]/'],
    ['http://[::.1.2.3]/'],
    ['http://[1:2:3:4:5:6:7:8:9]/'],
    ['http://[1:2:3:4:5:6:7]/'],
    ['http://[1::2::3]/'],
    ['http://[:1]/'],
    ['http://[1:]/'],
    ['http://[12345::]/'],
    ['http://[1:2:3:4:5:6:7::]/'],
    ['http://[::1/'],
    ['http://[g::1]/'],
    ['http://[::1]x/'],
    // Ports.
    ['http://example.com:/'],
    ['http://example.com:0080/'],
    ['http://example.com:65535/'],
    ['http://example.com:65536/'],
    ['http://example.com:8a/'],
    ['http://:80/'],
    // Missing or invalid hosts.
    ['http://'],
    ['http:'],
    ['http://user@/'],
    ['foo://user@/'],
    ['foo://:80/'],
    ['https://@example.com'],
    // Non-special schemes.
    ['foo://Example.COM/A?b#c'],
    ['foo://'],
    ['foo://host'],
    ['foo://host:99/'],
    ['foo://ho st/'],
    ['foo://ho%00st/'],
    // A non-ASCII opaque host is percent-encoded, not converted to Punycode.
    ['foo://\u00e9/'],
    ['foo:/a/./b/../c'],
    ['foo:/.//bar'],
    ['foo:/./x'],
    ['foo:'],
    ['mailto:someone@example.com'],
    ['mailto:a b\u0001c?subject=hi there#x'],
    ['data:text/plain,hello world'],
    ['javascript:alert(1)'],
    ['urn:isbn:0451450523'],
    ['a+b.c-d:x'],
    // No scheme, no base.
    ['example.com'],
    [''],
    ['1http://x'],
    // file: URLs.
    ['file:///home/user/file.txt'],
    ['file://localhost/etc/hosts'],
    ['file://LOCALHOST/etc/hosts'],
    ['file://server/share/x'],
    ['file://ser ver/share'],
    ['file:/a/b'],
    ['file:a/b'],
    ['file:'],
    ['file://'],
    ['file://host'],
    ['file://host?q#f'],
    ['file:\\\\host\\x'],
    ['file:///a?q#f'],
    // blob: origins.
    ['blob:https://example.com/550e8400-e29b-41d4-a716-446655440000'],
    ['blob:http://example.com:8080/uuid'],
    ['blob:ftp://example.com/uuid'],
    ['blob:not-a-url'],
  ])('%s %s', (input, base?) => {
    expectSameAsNative(input, base);
  });

  it.each([
    ['', 'http://a/b/c?q#f'],
    ['#x', 'http://a/b/c?q#f'],
    ['?y', 'http://a/b/c?q#f'],
    ['?y#z', 'http://a/b/c?q#f'],
    ['#x?y', 'http://a/b/c?q#f'],
    ['d', 'http://a/b/c?q#f'],
    ['d/', 'http://a/b/c'],
    ['./d', 'http://a/b/c'],
    ['../d', 'http://a/b/c'],
    ['../../../../d', 'http://a/b/c'],
    ['.', 'http://a/b/c'],
    ['..', 'http://a/b/c'],
    ['/d', 'http://a/b/c'],
    ['\\d', 'http://a/b/c'],
    ['//other/d', 'http://a/b/c'],
    ['\\\\other\\d', 'http://a/b/c'],
    ['/\\other/d', 'http://a/b/c'],
    ['///other/d', 'http://a/b/c'],
    ['d?q#f', 'http://a/b/c'],
    ['http:d', 'http://a/b/c'],
    ['http:/d', 'http://a/b/c'],
    ['http:\\\\other\\d', 'http://a/b/c'],
    ['http://other/d', 'http://a/b/c'],
    ['https:d', 'http://a/b/c'],
    ['HTTP:d', 'http://a/b/c'],
    ['d', 'http://user:pass@a:81/b/c'],
    ['/d', 'http://user:pass@a:81/b/c'],
    ['d', 'foo://a/b/c'],
    ['../d', 'foo://a/b/c'],
    ['\\d', 'foo://a/b/c'],
    ['//other/d', 'foo://a/b/c'],
    ['/d', 'foo://a'],
    ['d', 'foo://a'],
    ['', 'foo://a/b'],
    ['d', 'foo:/a/b'],
    ['//h', 'foo:/a/b'],
    ['#x', 'mailto:a@b'],
    ['', 'mailto:a@b'],
    ['d', 'mailto:a@b'],
    ['d', 'file:///a/b'],
    ['/d', 'file://host/a/b'],
    ['//other/d', 'file:///a/b'],
    ['?q', 'file:///a/b'],
    ['#f', 'file:///a/b'],
    ['', 'file:///a/b?q#f'],
    ['file:d', 'file:///a/b'],
    ['file:/d', 'file://host/a/b'],
    ['d', 'not a url'],
  ])('%s against %s', (input, base) => {
    expectSameAsNative(input, base);
  });

  it('accepts objects with a toString(), such as another URL', () => {
    const base = new LynxURL('http://a/b/c');
    expect(new LynxURL({ toString: () => 'd' }, base).href).toBe(
      'http://a/b/d',
    );
  });

  it('serializes with toString() and toJSON()', () => {
    const url = new LynxURL('http://a/b');
    expect(String(url)).toBe('http://a/b');
    expect(JSON.stringify({ url })).toBe('{"url":"http://a/b"}');
  });

  it('reports invalid URLs through canParse() and parse()', () => {
    expect(LynxURL.canParse('http://a/')).toBe(true);
    expect(LynxURL.canParse('/a', 'http://b')).toBe(true);
    expect(LynxURL.canParse('/a')).toBe(false);
    expect(LynxURL.parse('/a', 'http://b')?.href).toBe('http://b/a');
    expect(LynxURL.parse('http://')).toBeNull();
  });

  it('throws a TypeError with the browser message for invalid URLs', () => {
    expect(() => new LynxURL('/no-base')).toThrow(new TypeError('Invalid URL'));
  });
});

type Setter = Exclude<(typeof COMPONENTS)[number], 'origin'>;

const expectSetterLikeNative = (url: string, setter: Setter, value: string) => {
  const apply = (create: () => Record<string, unknown>) =>
    describeUrl(() => {
      const instance = create();
      instance[setter] = value;
      return instance;
    });
  expect(
    apply(() => new LynxURL(url) as never),
    `${url} .${setter} = ${JSON.stringify(value)}`,
  ).toEqual(apply(() => new NativeURL(url) as never));
};

describe('LynxURL setters match the WHATWG URL Standard', () => {
  it.each<[string, Setter, string]>([
    ['http://a/b', 'href', 'https://c/d?e#f'],
    ['http://a/b', 'href', 'not a url'],
    ['http://a/b', 'protocol', 'https'],
    ['http://a/b', 'protocol', 'https:'],
    ['http://a/b', 'protocol', 'https:junk'],
    ['http://a/b', 'protocol', 'HTTPS'],
    ['http://a/b', 'protocol', 'ht tp'],
    ['http://a/b', 'protocol', '1http'],
    ['http://a/b', 'protocol', ''],
    ['http://a/b', 'protocol', 'foo'],
    ['foo://a/b', 'protocol', 'http'],
    ['foo://a/b', 'protocol', 'bar'],
    ['http://a:443/b', 'protocol', 'https'],
    ['http://a:8080/b', 'protocol', 'https'],
    ['http://a/b', 'protocol', 'file'],
    ['http://u@a/b', 'protocol', 'file'],
    ['http://a:81/b', 'protocol', 'file'],
    ['file:///a', 'protocol', 'http'],
    ['file://host/a', 'protocol', 'http'],
    ['http://a/b', 'protocol', 'h\ttp'],
    ['http://a/b', 'username', 'us er@x'],
    ['http://a/b', 'password', 'p:a/ss'],
    ['http://u:p@a/b', 'username', ''],
    ['http://u:p@a/b', 'password', ''],
    ['foo:/a', 'username', 'u'],
    ['foo:///a', 'password', 'p'],
    ['file:///a', 'username', 'u'],
    ['http://a/b', 'host', 'c'],
    ['http://a/b', 'host', 'c:8080'],
    ['http://a:81/b', 'host', 'c'],
    ['http://a/b', 'host', 'c:80'],
    ['http://a/b', 'host', 'c:8080x'],
    ['http://a/b', 'host', 'c:x'],
    ['http://a/b', 'host', 'c:99999'],
    ['http://a/b', 'host', 'c/d?e#f'],
    ['http://a/b', 'host', 'c\\d'],
    ['http://a/b', 'host', '[::1]:81'],
    ['http://a/b', 'host', ''],
    ['http://a/b', 'host', ':81'],
    ['http://a/b', 'host', 'c d'],
    ['http://a/b', 'host', 'C\t.example'],
    ['foo://a/b', 'host', ''],
    ['foo://u@a/b', 'host', ''],
    ['foo://a:81/b', 'host', ''],
    ['foo://a/b', 'host', 'c\\d'],
    ['foo:/a', 'host', 'c'],
    ['mailto:a@b', 'host', 'c'],
    ['file:///a', 'host', 'c'],
    ['file://c/a', 'host', ''],
    ['file:///a', 'host', 'localhost'],
    ['file:///a', 'host', 'c:81'],
    ['http://a/b', 'hostname', 'c'],
    ['http://a/b', 'hostname', 'c:81'],
    ['http://a/b', 'hostname', ''],
    ['http://a/b', 'port', '8080'],
    ['http://a/b', 'port', '80'],
    ['http://a:81/b', 'port', ''],
    ['http://a/b', 'port', '8080abc'],
    ['http://a/b', 'port', 'abc'],
    ['http://a/b', 'port', '99999'],
    ['http://a/b', 'port', '8\t1'],
    ['file:///a', 'port', '81'],
    ['foo:/a', 'port', '81'],
    ['http://a/b', 'pathname', '/c/d'],
    ['http://a/b', 'pathname', 'c/../d'],
    ['http://a/b', 'pathname', ''],
    ['http://a/b', 'pathname', '?#x'],
    ['http://a/b', 'pathname', '\\c\\d'],
    ['foo://a/b', 'pathname', ''],
    ['foo://a/b', 'pathname', 'c'],
    ['foo:/a', 'pathname', ''],
    ['foo:/a', 'pathname', '/x/y'],
    ['mailto:a@b', 'pathname', 'x'],
    ['http://a/b?q', 'search', 'x=1&y=2'],
    ['http://a/b?q', 'search', '?x=1'],
    ['http://a/b?q', 'search', ''],
    ['http://a/b?q', 'search', '?'],
    ['http://a/b', 'search', "a b#c'd"],
    ['foo://a/b', 'search', "a'b"],
    ['http://a/b#f', 'hash', 'g h'],
    ['http://a/b#f', 'hash', '#g'],
    ['http://a/b#f', 'hash', ''],
    ['http://a/b#f', 'hash', '#'],
  ])('%s .%s = %j', (url, setter, value) => {
    expectSetterLikeNative(url, setter, value);
  });
});

describe('LynxURL.searchParams', () => {
  it('reads the query', () => {
    const url = new LynxURL('http://a/?x=1&y=a+b&x=2');
    expect(url.searchParams.getAll('x')).toEqual(['1', '2']);
    expect(url.searchParams.get('y')).toBe('a b');
  });

  it('is the same object for the lifetime of the URL', () => {
    const url = new LynxURL('http://a/?x=1');
    const params = url.searchParams;
    url.search = '?y=2';
    expect(url.searchParams).toBe(params);
    expect(params.get('y')).toBe('2');
    url.href = 'http://b/?z=3';
    expect(params.get('z')).toBe('3');
  });

  it('writes changes back to the URL', () => {
    const url = new LynxURL('http://a/?x=1#f');
    url.searchParams.set('x', 'a b');
    url.searchParams.append('y', 'é&');
    expect(url.href).toBe('http://a/?x=a+b&y=%C3%A9%26#f');
    url.searchParams.delete('x');
    url.searchParams.delete('y');
    expect(url.href).toBe('http://a/#f');
  });
});

describe('LynxURLSearchParams matches the WHATWG URL Standard', () => {
  const snapshot = (
    params: Iterable<[string, string]> & { toString(): string; size: number },
  ) => ({
    entries: [...params],
    string: params.toString(),
    size: params.size,
  });

  it.each<[string, unknown]>([
    ['string', 'a=1&b=2&a=3'],
    ['leading ?', '?a=1'],
    ['empty', ''],
    ['empty pairs', '&&a=1&&'],
    ['no value', 'a&b='],
    ['several =', 'a=b=c'],
    ['plus and escapes', 'a+b=c+d&e=%20%2B%zz%'],
    ['invalid UTF-8', 'a=%FF%C3%28%E2%82%F0%9F%98%80%F0%9F%98'],
    [
      'overlong and surrogate UTF-8',
      'a=%C0%AF%E0%80%AF%ED%A0%80%F4%90%80%80%F5',
    ],
    ['unicode', 'café=ü😀'],
    ['undefined', undefined],
    ['null', null],
    [
      'pairs',
      [
        ['a', '1'],
        ['b', 2],
      ],
    ],
    ['record', { a: '1', b: 2 }],
    ['Map', new Map([['a', '1']])],
    ['serialization', [['a b', "c&d=e*-._~!'()/"]]],
  ])('constructed from %s', (_, init) => {
    expect(snapshot(new LynxURLSearchParams(init as never) as never)).toEqual(
      snapshot(new NativeURLSearchParams(init as never) as never),
    );
  });

  it('can be constructed from another LynxURLSearchParams', () => {
    const copy = new LynxURLSearchParams(new LynxURLSearchParams('a=1&b=2'));
    expect(copy.toString()).toBe('a=1&b=2');
  });

  it('rejects pairs that are not [name, value]', () => {
    expect(() => new LynxURLSearchParams([['a']] as never)).toThrow(TypeError);
    expect(() => new LynxURLSearchParams([['a', 'b', 'c']] as never)).toThrow(
      TypeError,
    );
  });

  it('supports the same operations as the native class', () => {
    const run = (params: any) => {
      const log: unknown[] = [];
      params.append('b', '2');
      params.append('a', '3');
      params.append('c', '4');
      log.push(params.get('a'), params.get('missing'), params.getAll('a'));
      log.push(params.has('a'), params.has('a', '3'), params.has('a', 'x'));
      log.push(params.has('missing'));
      params.set('a', 'new');
      params.set('d', '5');
      log.push(params.toString());
      params.delete('c', 'nope');
      params.delete('c', '4');
      params.append('b', '0');
      params.sort();
      log.push(params.toString(), params.size);
      params.delete('b');
      log.push([...params.keys()], [...params.values()], [...params.entries()]);
      const forEachCalls: unknown[] = [];
      params.forEach(function (this: unknown, value: string, name: string) {
        forEachCalls.push([value, name, this]);
      }, 'thisArg');
      log.push(forEachCalls);
      return log;
    };
    expect(run(new LynxURLSearchParams('a=1'))).toEqual(
      run(new NativeURLSearchParams('a=1')),
    );
  });

  it('passes itself to forEach callbacks', () => {
    const params = new LynxURLSearchParams('a=1');
    params.forEach((_value, _name, self) => {
      expect(self).toBe(params);
    });
  });
});
