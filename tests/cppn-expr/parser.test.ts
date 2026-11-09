import { test, expect } from 'vitest';
import { parse, tryParse, astToString } from '../../src/components/simulations/cppn/cppn-expr/parser';

test('precedence: ^ binds tighter than unary minus and *', () => {
  expect(astToString(parse('-x^2*3'))).toBe('-x^2*3');
  expect(parse('-x^2').k).toBe('neg');
  expect(parse('2*x^2').k).toBe('bin');
});

test('functions, arity and constants', () => {
  expect(parse('smoothstep(0, 1, r)').k).toBe('call');
  expect(parse('pi').k).toBe('num');
  expect(tryParse('smoothstep(0, r)')).toEqual({ error: { msg: 'smoothstep takes 3 arguments, got 2', pos: 0 } });
  expect(tryParse('sine(x)')).toEqual({ error: { msg: 'unknown function “sine”', pos: 0 } });
  expect(tryParse('sin(3*x +')).toEqual({ error: { msg: 'expression ends early', pos: 9 } });
  expect(tryParse('x $ y')).toEqual({ error: { msg: 'unexpected “$”', pos: 2 } });
  expect(tryParse('q')).toEqual({ error: { msg: 'unknown variable “q”', pos: 0 } });
});

test('no implicit multiplication', () => {
  expect('error' in tryParse('3x')).toBe(true);
});

test('astToString spacing: + - spaced, * / ^ tight, args joined by comma-space', () => {
  expect(astToString(parse('sin( 3*x+t )'))).toBe('sin(3*x + t)');
  expect(astToString(parse('x - -1.5'))).toBe('x - -1.5');
  expect(astToString(parse('(x + y)*r'))).toBe('(x + y)*r');
  expect(astToString(parse('mix(x,y,r)'))).toBe('mix(x, y, r)');
});
