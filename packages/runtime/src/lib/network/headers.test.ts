import { describe, expect, it } from 'vitest';
import { LynxHeaders } from './headers';

describe('LynxHeaders', () => {
  it('takes an object, pairs or another Headers, and lowercases names', () => {
    const fromObject = new LynxHeaders({ 'Content-Type': 'text/plain' });
    const fromPairs = new LynxHeaders([['X-A', '1']]);
    const copy = new LynxHeaders(fromPairs);
    fromPairs.set('x-a', '2');

    expect([...fromObject]).toEqual([['content-type', 'text/plain']]);
    expect([...copy]).toEqual([['x-a', '1']]);
    expect([...new LynxHeaders()]).toEqual([]);
    expect([...new LynxHeaders(null)]).toEqual([]);
  });

  it('rejects pairs that are not pairs, invalid names and values with line breaks', () => {
    expect(() => new LynxHeaders([['a']] as never)).toThrow(TypeError);
    expect(() => new LynxHeaders({ 'bad name': 'x' })).toThrow(TypeError);
    expect(() => new LynxHeaders({ a: 'x\r\ny: z' })).toThrow(TypeError);
  });

  it('trims values', () => {
    expect(new LynxHeaders({ a: ' \t x \n' }).get('A')).toBe('x');
  });

  it('joins repeated names, and lists them sorted', () => {
    const headers = new LynxHeaders();
    headers.append('b', '1');
    headers.append('A', 'x');
    headers.append('B', '2');

    expect(headers.get('b')).toBe('1, 2');
    expect(headers.has('B')).toBe(true);
    expect(headers.get('missing')).toBeNull();
    expect([...headers.keys()]).toEqual(['a', 'b']);
    expect([...headers.values()]).toEqual(['x', '1, 2']);
    expect([...headers.entries()]).toEqual([
      ['a', 'x'],
      ['b', '1, 2'],
    ]);
  });

  it('lists Set-Cookie once per value', () => {
    const headers = new LynxHeaders([
      ['set-cookie', 'a=1'],
      ['Set-Cookie', 'b=2'],
    ]);
    expect(headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect([...headers]).toEqual([
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
    ]);
  });

  it('sets a value in place of the existing ones, or adds it', () => {
    const headers = new LynxHeaders([
      ['a', '1'],
      ['b', '2'],
      ['a', '3'],
    ]);
    headers.set('A', 'new');
    headers.set('c', '4');

    expect([...headers]).toEqual([
      ['a', 'new'],
      ['b', '2'],
      ['c', '4'],
    ]);
  });

  it('deletes every value of a name', () => {
    const headers = new LynxHeaders([
      ['a', '1'],
      ['a', '2'],
      ['b', '3'],
    ]);
    headers.delete('A');
    expect([...headers]).toEqual([['b', '3']]);
  });

  it('calls forEach with value, name and the headers, on thisArg', () => {
    const headers = new LynxHeaders({ a: '1' });
    const calls: unknown[] = [];
    const thisArg = {};
    headers.forEach(function (this: unknown, value, name, parent) {
      calls.push([value, name, parent, this]);
    }, thisArg);
    expect(calls).toEqual([['1', 'a', headers, thisArg]]);
  });
});
