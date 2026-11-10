// Tap-to-select for the phone expression field: a tap on a function name or
// a parenthesis selects the whole term, `fn(` through its matching `)`, so
// it can be wrapped in another function or deleted in one go. Variables and
// numbers return null (a plain caret).

const ID = /[A-Za-z_0-9]/;
const ALPHA = /[A-Za-z_]/;

function matchClose(s: string, open: number): number {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')' && --d === 0) return i;
  }
  return s.length - 1;   // unclosed: to the end
}
function matchOpen(s: string, close: number): number {
  let d = 0;
  for (let i = close; i >= 0; i--) {
    if (s[i] === ')') d++;
    else if (s[i] === '(' && --d === 0) return i;
  }
  return 0;
}

/** The [start, end) of the term a tap at caret `pos` lands on, or null. */
export function termAt(s: string, pos: number): [number, number] | null {
  const c = s[pos] ?? '', p = s[pos - 1] ?? '';
  let open: number;
  if (c === '(') open = pos;
  else if (c === ')') open = matchOpen(s, pos);
  else if (ALPHA.test(c) || ALPHA.test(p)) {
    let a = pos, z = pos;
    while (a > 0 && ID.test(s[a - 1])) a--;
    while (z < s.length && ID.test(s[z])) z++;
    if (s[z] !== '(' || !ALPHA.test(s[a])) return null;   // a variable, not a call
    open = z;
  } else if (p === ')') open = matchOpen(s, pos - 1);
  else if (p === '(') open = pos - 1;
  else return null;
  if (s[open] !== '(') return null;
  let start = open;
  while (start > 0 && ID.test(s[start - 1])) start--;
  return [start, matchClose(s, open) + 1];
}
