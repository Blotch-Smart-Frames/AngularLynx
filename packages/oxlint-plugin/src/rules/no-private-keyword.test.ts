import { describe, expect, it, vi } from 'vitest';
import rule from './no-private-keyword.mjs';

const createContext = () => ({ report: vi.fn() });

describe('no-private-keyword', () => {
  it('ignores members with no accessibility modifier', () => {
    const context = createContext();
    const visitors = rule.create(context as never);

    visitors.PropertyDefinition({
      key: { type: 'Identifier', name: 'foo' },
    } as never);

    expect(context.report).not.toHaveBeenCalled();
  });

  it('ignores public members', () => {
    const context = createContext();
    const visitors = rule.create(context as never);

    visitors.PropertyDefinition({
      accessibility: 'public',
      key: { type: 'Identifier', name: 'foo' },
    } as never);

    expect(context.report).not.toHaveBeenCalled();
  });

  it('ignores private members with a computed (non-identifier) key, since they cannot use # syntax', () => {
    const context = createContext();
    const visitors = rule.create(context as never);

    visitors.PropertyDefinition({
      accessibility: 'private',
      key: { type: 'Literal', value: 'foo' },
    } as never);
    visitors.MethodDefinition({
      accessibility: 'private',
      key: { type: 'MemberExpression' },
    } as never);

    expect(context.report).not.toHaveBeenCalled();
  });

  it('reports a private property with an identifier key', () => {
    const context = createContext();
    const visitors = rule.create(context as never);
    const node = {
      accessibility: 'private',
      key: { type: 'Identifier', name: 'secret' },
    };

    visitors.PropertyDefinition(node as never);

    expect(context.report).toHaveBeenCalledWith({
      node,
      messageId: 'useHash',
      data: { name: 'secret' },
    });
  });

  it('reports a private method with an identifier key', () => {
    const context = createContext();
    const visitors = rule.create(context as never);
    const node = {
      accessibility: 'private',
      key: { type: 'Identifier', name: 'helper' },
    };

    visitors.MethodDefinition(node as never);

    expect(context.report).toHaveBeenCalledWith({
      node,
      messageId: 'useHash',
      data: { name: 'helper' },
    });
  });
});
