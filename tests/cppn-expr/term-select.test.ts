import { describe, it, expect } from 'vitest';
import { termAt } from '../../src/components/simulations/cppn/cppn-expr/term-select';

const pick = (s: string, pos: number) => { const r = termAt(s, pos); return r && s.slice(r[0], r[1]); };

describe('termAt', () => {
  const s = 'sin(3*x) + cos(y*abs(r))';
  it('function name selects the call', () => { expect(pick(s, 1)).toBe('sin(3*x)'); expect(pick(s, 0)).toBe('sin(3*x)'); });
  it('open paren selects the call', () => expect(pick(s, 3)).toBe('sin(3*x)'));
  it('close paren selects the call', () => { expect(pick(s, 7)).toBe('sin(3*x)'); expect(pick(s, 8)).toBe('sin(3*x)'); });
  it('nested call', () => { expect(pick(s, 18)).toBe('abs(r)'); expect(pick(s, 23)).toBe('cos(y*abs(r))'); });
  it('variables and numbers give a caret', () => { expect(pick(s, 6)).toBeNull(); expect(pick(s, 5)).toBeNull(); expect(pick('x + y', 0)).toBeNull(); });
  it('bare parens', () => expect(pick('(x+y)*2', 0)).toBe('(x+y)'));
  it('unclosed runs to the end', () => expect(pick('sin(x', 0)).toBe('sin(x'));
});
