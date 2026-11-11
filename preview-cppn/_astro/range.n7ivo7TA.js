const Ot={spatial:"#8a8178",dynamic:"#7cb87a",smooth:"#e4833f",discrete:"#5aa0d8"},N=(t,e,s)=>Math.min(s,Math.max(e,t)),j=(t,e)=>t/(e+1e-6*(e<0?-1:1)),Q=(t,e)=>(t===0?0:Math.sign(t))*Math.pow(Math.abs(t),e),ct=`
fn safeDiv(a: f32, b: f32) -> f32 { return a / (b + select(1e-6, -1e-6, b < 0.0)); }
fn safePow(a: f32, b: f32) -> f32 { return select(sign(a), 0.0, a == 0.0) * pow(abs(a), b); }
fn sstep(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp(safeDiv(x - e0, e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
`,S=[{name:"sin",arity:1,group:"smooth",desc:"sine wave",sig:"sin(x)",js:Math.sin,wgsl:"sin(a)"},{name:"cos",arity:1,group:"smooth",desc:"cosine wave",sig:"cos(x)",js:Math.cos,wgsl:"cos(a)"},{name:"tanh",arity:1,group:"smooth",desc:"soft clip to ±1",sig:"tanh(x)",js:t=>Math.tanh(N(t,-15,15)),wgsl:"tanh(clamp(a, -15.0, 15.0))"},{name:"gauss",arity:1,group:"smooth",desc:"bump exp(−x²)",sig:"gauss(x)",js:t=>Math.exp(-t*t),wgsl:"exp(-a * a)"},{name:"abs",arity:1,group:"smooth",desc:"fold negatives up",sig:"abs(x)",js:Math.abs,wgsl:"abs(a)"},{name:"sqrt",arity:1,group:"smooth",desc:"root of |x|",sig:"sqrt(x)",js:t=>Math.sqrt(Math.abs(t)),wgsl:"sqrt(abs(a))"},{name:"exp",arity:1,group:"smooth",desc:"exponential growth",sig:"exp(x)",js:t=>Math.exp(N(t,-20,20)),wgsl:"exp(clamp(a, -20.0, 20.0))"},{name:"log",arity:1,group:"smooth",desc:"log of |x|",sig:"log(x)",js:t=>Math.log(Math.abs(t)+1e-6),wgsl:"log(abs(a) + 1e-6)"},{name:"length",arity:2,group:"smooth",desc:"distance √(a²+b²)",sig:"length(a, b)",js:(t,e)=>Math.hypot(t,e),wgsl:"length(vec2f(a, b))"},{name:"min",arity:2,group:"smooth",desc:"lower of two",sig:"min(a, b)",js:(t,e)=>Math.min(t,e),wgsl:"min(a, b)"},{name:"max",arity:2,group:"smooth",desc:"higher of two",sig:"max(a, b)",js:(t,e)=>Math.max(t,e),wgsl:"max(a, b)"},{name:"pow",arity:2,group:"smooth",desc:"sign(a)·|a|^b",sig:"pow(a, b)",js:Q,wgsl:"safePow(a, b)"},{name:"mix",arity:3,group:"smooth",desc:"blend a→b by k",sig:"mix(a, b, k)",js:(t,e,s)=>t+(e-t)*s,wgsl:"mix(a, b, c)"},{name:"smoothstep",arity:3,group:"smooth",desc:"soft edge e0→e1",sig:"smoothstep(e0, e1, x)",js:(t,e,s)=>{const a=N(j(s-t,e-t),0,1);return a*a*(3-2*a)},wgsl:"sstep(a, b, c)"},{name:"mod",arity:2,group:"discrete",desc:"wrap a into [0, b)",sig:"mod(a, b)",js:(t,e)=>t-e*Math.floor(j(t,e)),wgsl:"a - b * floor(safeDiv(a, b))"},{name:"sign",arity:1,group:"discrete",desc:"−1, 0 or 1",sig:"sign(x)",js:t=>Math.sign(t),wgsl:"sign(a)"},{name:"atan2",arity:2,group:"discrete",desc:"angle of (x, y)",sig:"atan2(y, x)",js:(t,e)=>Math.atan2(t,e),wgsl:"atan2(a, b)"},{name:"fract",arity:1,group:"discrete",desc:"sawtooth x − ⌊x⌋",sig:"fract(x)",js:t=>t-Math.floor(t),wgsl:"fract(a)"},{name:"floor",arity:1,group:"discrete",desc:"round down (stairs)",sig:"floor(x)",js:t=>Math.floor(t),wgsl:"floor(a)"},{name:"step",arity:2,group:"discrete",desc:"0 below edge, 1 above",sig:"step(edge, x)",js:(t,e)=>e<t?0:1,wgsl:"step(a, b)"},{name:"tan",arity:1,group:"typed",desc:"tangent (clamped ±20)",sig:"tan(x)",js:t=>N(Math.tan(t),-20,20),wgsl:"clamp(tan(a), -20.0, 20.0)"},{name:"atan",arity:1,group:"typed",desc:"arctangent",sig:"atan(x)",js:t=>Math.atan(t),wgsl:"atan(a)"},{name:"clamp",arity:3,group:"typed",desc:"limit x to [lo, hi]",sig:"clamp(x, lo, hi)",js:(t,e,s)=>N(t,Math.min(e,s),Math.max(e,s)),wgsl:"clamp(a, min(b, c), max(b, c))"}],pt=["+","-","*","/","^"],I={"+":(t,e)=>t+e,"-":(t,e)=>t-e,"*":(t,e)=>t*e,"/":j,"^":Q},ft={"+":"a + b","-":"a - b","*":"a * b","/":"safeDiv(a, b)","^":"safePow(a, b)"},R=["x","y","r","a","t","px","py"],Et={x:"horizontal",y:"vertical",r:"radius",a:"angle (seam at ±π)",t:"time, wraps every 60 s",px:"pointer x",py:"pointer y"},V={pi:Math.PI,e:Math.E},u={END:0,PUSH_CONST:1,PUSH_VAR:2,NEG:3,ADD:8,SUB:9,MUL:10,DIV:11,POW:12,FN0:16},lt=new Map(S.map(t=>[t.name,t]));function H(t){return lt.get(t)}class T extends Error{msg;pos;constructor(e,s){super(e),this.msg=e,this.pos=s}}function M(t,e){throw new T(t,e)}function ut(t){const e=[];let s=0;for(;s<t.length;){const a=t[s];if(a===" "||a==="	"||a===`
`){s++;continue}if(a>="0"&&a<="9"||a==="."&&t[s+1]>="0"&&t[s+1]<="9"){const o=/^\d*\.?\d*(?:[eE][+-]?\d+)?/.exec(t.slice(s));e.push({t:"num",v:parseFloat(o[0]),pos:s}),s+=o[0].length;continue}if(/[A-Za-z_]/.test(a)){const o=/^[A-Za-z_][A-Za-z0-9_]*/.exec(t.slice(s));e.push({t:"id",v:o[0],pos:s}),s+=o[0].length;continue}if("+-*/^(),".includes(a)){e.push({t:"op",v:a,pos:s}),s++;continue}M(`unexpected “${a}”`,s)}return e.push({t:"end",v:"",pos:t.length}),e}function mt(t){const e=ut(t);let s=0;const a=()=>e[s],o=c=>{const m=e[s];return m.t==="op"&&m.v===c},n=()=>e[s++],i=()=>{const c=a();c.t==="end"&&M("expression ends early",c.pos),M(`unexpected “${c.v}”`,c.pos)};function r(){let c=l();for(;o("+")||o("-");)c={k:"bin",op:n().v,a:c,b:l()};return c}function l(){let c=p();for(;o("*")||o("/");)c={k:"bin",op:n().v,a:c,b:p()};return c}function p(){return o("-")?(n(),{k:"neg",a:p()}):f()}function f(){const c=h();return o("^")?(n(),{k:"bin",op:"^",a:c,b:p()}):c}function h(){const c=a();if(c.t==="end"&&M("expression ends early",c.pos),c.t==="num")return n(),{k:"num",v:c.v};if(c.t==="op"){c.v!=="("&&i(),n();const x=r();return o(")")||i(),n(),x}n();const m=c.v;if(o("(")){n();const x=H(m);x||M(`unknown function “${m}”`,c.pos);const d=[];if(!o(")"))for(d.push(r());o(",");)n(),d.push(r());return o(")")||i(),n(),d.length!==x.arity&&M(`${m} takes ${x.arity} argument${x.arity===1?"":"s"}, got ${d.length}`,c.pos),{k:"call",fn:m,args:d}}if(m in V)return{k:"num",v:V[m]};if(R.includes(m))return{k:"var",name:m};H(m)&&M(`${m} needs arguments`,c.pos),M(`unknown variable “${m}”`,c.pos)}const g=r();return a().t!=="end"&&i(),g}function At(t){try{return{ast:mt(t)}}catch(e){if(e instanceof T)return{error:{msg:e.msg,pos:e.pos}};throw e}}const tt={"+":1,"-":1,"*":2,"/":2,"^":4},C=3;function D(t){return t.k==="bin"?tt[t.op]:t.k==="neg"?C:9}function ht(t){if(Number.isInteger(t))return String(t);const e=t.toFixed(3).replace(/0+$/,"").replace(/\.$/,"");return e==="-0"?"0":e}function P(t){switch(t.k){case"num":return ht(t.v);case"var":return t.name;case"neg":{const e=P(t.a);return"-"+(D(t.a)<C?`(${e})`:e)}case"bin":{const e=tt[t.op],s=D(t.a),a=D(t.b),o=t.op==="^"?s<=e:s<e,n=t.op==="^"?a<C:a<e||a===e&&(t.op==="-"||t.op==="/"),i=o?`(${P(t.a)})`:P(t.a),r=n?`(${P(t.b)})`:P(t.b);return t.op==="+"||t.op==="-"?`${i} ${t.op} ${r}`:`${i}${t.op}${r}`}case"call":return`${t.fn}(${t.args.map(P).join(", ")})`}}const y=8,E=64,F=16,z=1e4,gt={"+":u.ADD,"-":u.SUB,"*":u.MUL,"/":u.DIV,"^":u.POW},dt=new Map(S.map((t,e)=>[t.name,u.FN0+e]));function Dt(t){const e=new Float32Array(E*4);let s=0,a=0;const o=r=>{throw new T(r,0)},n=(r,l=0,p=1,f=0)=>{s>=E-1&&o("expression too long"),e[s*4]=r,e[s*4+1]=l,s++,a+=p-f,a>F&&o("expression too deep")},i=r=>{switch(r.k){case"num":n(u.PUSH_CONST,r.v);break;case"var":n(u.PUSH_VAR,R.indexOf(r.name));break;case"neg":i(r.a),n(u.NEG,0,1,1);break;case"bin":i(r.a),i(r.b),n(gt[r.op],0,1,2);break;case"call":{for(const p of r.args)i(p);const l=dt.get(r.fn);l===void 0&&o(`unknown function “${r.fn}”`),n(l,0,1,r.args.length);break}}};return i(t),e[s*4]=u.END,s++,{ops:e,length:s}}const xt=["a","b","c"];function wt(){return`
fn finiteClamp(v: f32) -> f32 {
  let f = select(0.0, v, v == v && abs(v) < 1e30);
  return clamp(f, -${z.toFixed(1)}, ${z.toFixed(1)});
}
`}function vt(){const t=[u.ADD,u.SUB,u.MUL,u.DIV,u.POW];let e="";return e+=`      case ${u.PUSH_CONST}u: { st[sp] = op.y; sp++; }
`,e+=`      case ${u.PUSH_VAR}u: {
        var v = 0.0;
        switch u32(op.y) {
`,["x","y","r","a","t","px","py"].forEach((a,o)=>{e+=`          case ${o}u: { v = ${a}; }
`}),e+=`          default: { v = 0.0; }
        }
        st[sp] = v; sp++;
      }
`,e+=`      case ${u.NEG}u: { st[sp - 1u] = -st[sp - 1u]; }
`,pt.forEach((a,o)=>{e+=`      case ${t[o]}u: { let b = st[sp - 1u]; let a = st[sp - 2u]; sp--; st[sp - 1u] = ${ft[a]}; }
`}),S.forEach((a,o)=>{const n=u.FN0+o,i=a.arity;let r="";for(let l=i-1;l>=0;l--)r+=`let ${xt[l]} = st[sp - ${i-l}u]; `;i>1&&(r+=`sp -= ${i-1}u; `),r+=`st[sp - 1u] = ${a.wgsl};`,e+=`      case ${n}u: { ${r} }
`}),`
@group(0) @binding(2) var<storage, read> prog : array<vec4f>;
${ct}
fn evalProgram(slot: u32, x: f32, y: f32, r: f32, a: f32, t: f32, px: f32, py: f32) -> f32 {
  var st: array<f32, ${F}>;
  var sp = 0u;
  let base = slot * ${E}u;
  for (var i = 0u; i < ${E}u; i++) {
    let op = prog[base + i];
    let code = u32(op.x);
    if (code == ${u.END}u) { break; }
    switch code {
${e}      default: { }
    }
  }
  return select(0.0, st[max(sp, 1u) - 1u], sp > 0u);
}
`}const U=16;function et(t){const{layers:e}=t,s=e[0].width,a=0,o=y*s;let n=o+U*s;const i=[],r=[];for(let p=0;p<e.length-1;p++)i.push(n),n+=e[p].width*e[p+1].width,r.push(n),n+=e[p+1].width;const l=n;return n+=e[e.length-1].width*3,{wInOffset:a,wzOffset:o,hiddenWeightOffsets:i,hiddenBiasOffsets:r,outWeightOffset:l,totalCount:n}}function jt(t){const e=t.layers[0].width;return et(t).totalCount-(y-3)*e}function Ct(t,e){const s=et(e),a=e.layers[0].width,o=new Float32Array(s.totalCount),n=3*a;for(let r=0;r<n;r++)o[r]=t[r];const i=(y-3)*a;for(let r=n;r<t.length;r++)o[r+i]=t[r];return o}function Rt(t,e,s,a){for(let o=a;o<y-1;o++){const n=e.wInOffset+o*s,i=e.wInOffset+(o+1)*s;for(let r=0;r<s;r++)t[n+r]=t[i+r]}t.fill(0,e.wInOffset+(y-1)*s,e.wInOffset+y*s)}const Tt=["tanh","sin","cos","abs","sigmoid"];function q(t,e){const s=t<4?"acts0":"acts1",a="xyzw"[t%4];return`act(params.${s}.${a}, ${e})`}const $=-1;function*_(t,e){for(let s=0;s<t;s+=4)yield[e(s),s+1<t?e(s+1):$,s+2<t?e(s+2):$,s+3<t?e(s+3):$]}function*W(t,e){const{layers:s}=t,a=s[0].width;for(let n=0;n<a;n++)yield*_(y,i=>e.wInOffset+i*a+n),yield*_(U,i=>e.wzOffset+i*a+n);for(let n=0;n<s.length-1;n++){const i=s[n].width,r=s[n+1].width,l=e.hiddenWeightOffsets[n],p=e.hiddenBiasOffsets[n];for(let f=0;f<r;f++)yield[p+f,$,$,$],yield*_(i,h=>l+h*r+f)}const o=s[s.length-1].width;for(let n=0;n<3;n++)yield*_(o,i=>e.outWeightOffset+i*3+n)}function yt(t,e){let s=0;for(const a of W(t,e))s++;return s}function Ft(t,e,s){const a=new Float32Array(yt(t,e)*4);let o=0;for(const n of W(t,e)){for(let i=0;i<4;i++){const r=n[i],l=r===$?0:s[r]??0;a[o*4+i]=isFinite(l)?l:0}o++}return a}function Y(t,e,s,a){let o=a;for(let n=0;n<t;n+=4){const i=r=>r<t?e(r):"0.0";o+=` + dot(vec4f(${i(n)},${i(n+1)},${i(n+2)},${i(n+3)}), wv[${s()}])`}return o}function Ut(t,e){const{layers:s}=t,a=W(t,e),o=()=>{if(a.next().done)throw new Error("CPPN codegen: slot order out of sync");return n++};let n=0,i=`
fn sigmoid_f(x: f32) -> f32 { return 1.0 / (1.0 + exp(-x)); }

struct Params {
  resolution : vec2f,
  time       : f32,
  scale      : f32,
  z          : array<f32, ${U}>,
  acts0      : vec4<u32>,
  acts1      : vec4<u32>,
  view       : vec4f,          // world centre x, y (high f32), zoom, centre x low bits
  numInputs  : u32,
  exprTime   : f32,            // wrapped expression clock, 0..2π
  normFlag   : u32,
  viewLoY    : f32,            // centre y low bits (hi + lo ≈ an f64 centre)
  pointer    : vec4f,          // pointer x, y in world space
  norm       : array<vec4f, 4>, // per input (mid, half), two inputs per vec4
}

// tanh is evaluated as (e^2x-1)/(e^2x+1) on most GPUs and overflows to
// inf/inf = NaN past |x| ~ 44 (black pixels when zoomed far out); tanh(15)
// is already 1.0 in f32, so clamp. sigmoid is clamped the same way.
fn act(id: u32, x: f32) -> f32 {
  switch id {
    case 0u: { return tanh(clamp(x, -15.0, 15.0)); }
    case 1u: { return sin(x); }
    case 2u: { return cos(x); }
    case 3u: { return abs(x); }
    default: { return sigmoid_f(clamp(x, -40.0, 40.0)); }
  }
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> wv : array<vec4f>;
${vt()}
${wt()}
@vertex
fn vertexMain(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 6>(
    vec2f(-1.0,-1.0), vec2f(1.0,-1.0), vec2f(-1.0,1.0),
    vec2f(-1.0,1.0),  vec2f(1.0,-1.0), vec2f(1.0,1.0)
  );
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) fragPos: vec4f) -> @location(0) vec4f {
  let aspect = params.resolution.x / params.resolution.y;
  let uv     = fragPos.xy / params.resolution;
  // View: the screen maps to a window of the coordinate plane centred on
  // view.xy with half-extent (aspect·scale, scale) / zoom, so zooming
  // samples the function at a new scale instead of magnifying pixels.
  // The low bits join the small screen offset before the big centre, so the
  // view pans smoothly at any zoom (cx itself is still one f32 per pixel).
  let cx     = params.view.x + (params.view.w + (uv.x * 2.0 - 1.0) * aspect * params.scale / params.view.z);
  let cy     = params.view.y + (params.viewLoY + (uv.y * 2.0 - 1.0) * params.scale / params.view.z);
  let cr     = sqrt(cx * cx + cy * cy);
  let ca     = atan2(cy, cx);
  // Expression inputs: one bytecode program per slot, unused slots read 0.
  var inp: array<f32, ${y}>;
  for (var i = 0u; i < ${y}u; i++) {
    if (i < params.numInputs) {
      var v = finiteClamp(evalProgram(i, cx, cy, cr, ca, params.exprTime, params.pointer.x, params.pointer.y));
      if (params.normFlag != 0u) {
        let n = params.norm[i / 2u];
        let odd = (i & 1u) == 1u;
        let mid = select(n.x, n.z, odd);
        let half = select(n.y, n.w, odd);
        v = (v - mid) / half;
      }
      inp[i] = v;
    } else {
      inp[i] = 0.0;
    }
  }
  let in0    = vec4f(inp[0], inp[1], inp[2], inp[3]);
  let in1    = vec4f(inp[4], inp[5], inp[6], inp[7]);
  let z0     = vec4f(params.z[0],  params.z[1],  params.z[2],  params.z[3]);
  let z1     = vec4f(params.z[4],  params.z[5],  params.z[6],  params.z[7]);
  let z2     = vec4f(params.z[8],  params.z[9],  params.z[10], params.z[11]);
  let z3     = vec4f(params.z[12], params.z[13], params.z[14], params.z[15]);

`;const r=s[0].width;for(let f=0;f<r;f++){let h=`dot(in0, wv[${o()}]) + dot(in1, wv[${o()}])`;for(const g of["z0","z1","z2","z3"])h+=` + dot(${g}, wv[${o()}])`;i+=`  let h0_${f} = ${q(0,h)};
`}i+=`
`;for(let f=0;f<s.length-1;f++){const h=s[f].width,g=s[f+1].width;for(let c=0;c<g;c++){const m=`wv[${o()}].x`,x=Y(h,d=>`h${f}_${d}`,o,m);i+=`  let h${f+1}_${c} = ${q(f+1,x)};
`}i+=`
`}const l=s.length-1,p=s[l].width;for(let f=0;f<3;f++){const h=Y(p,g=>`h${l}_${g}`,o,"0.0");i+=`  let rgb_${f} = sigmoid_f(clamp(${h}, -40.0, 40.0));
`}if(!a.next().done)throw new Error("CPPN codegen: unconsumed weight slots");return i+=`
  return vec4f(rgb_0, rgb_1, rgb_2, 1.0);
}
`,i}const Z={speed:.05,spread:1.3,depth:.2,falloff:.8,bands:4},Mt=["x","y","r"];function Wt(t){const e=t;let s;if(e.motion)s={...Z,...e.motion};else if(e.zBands&&e.zBands.length>0){const a=e.zBands.slice(0,Math.min(4,e.numBands??e.zBands.length)),o=(p,f,h)=>{const g=p.length,c=p.map(v=>Math.log(Math.max(v,1e-4)));if(g===1)return[p[0],1];const m=(g-1)/2,x=c.reduce((v,it)=>v+it,0)/g;let d=0,G=0;for(let v=0;v<g;v++)d+=(v-m)*(c[v]-x),G+=(v-m)**2;const L=Math.min(Math.log(h),Math.max(Math.log(f),d/G));return[Math.exp(x-L*m),Math.exp(L)]},[n,i]=o(a.map(p=>p.freq),1,2.5),[r,l]=o(a.map(p=>p.amplitude),.3,1);s={speed:n,spread:i,depth:r,falloff:l,bands:a.length}}else s={...Z};return{zDim:e.zDim??16,layers:e.layers.map(a=>({...a})),distribution:{...e.distribution},scale:e.scale,zScale:e.zScale??1,motion:s,inputs:e.inputs&&e.inputs.length>0?e.inputs.slice(0,8):[...Mt],normalizeInputs:e.normalizeInputs??!1}}function bt(t,e,s=0,a=0,o=0){return{x:t,y:e,r:Math.hypot(t,e),a:Math.atan2(e,t),t:s,px:a,py:o}}const $t=[I["+"],I["-"],I["*"],I["/"],I["^"]];function Pt(t,e){const s=new Float64Array(F);let a=0;const o=t.ops;for(let i=0;i<t.length;i++){const r=o[i*4],l=o[i*4+1];if(r===u.END)break;if(r===u.PUSH_CONST){s[a++]=l;continue}if(r===u.PUSH_VAR){s[a++]=e[R[l|0]];continue}if(r===u.NEG){s[a-1]=-s[a-1];continue}if(r>=u.ADD&&r<=u.POW){const f=s[--a],h=s[a-1];s[a-1]=$t[r-u.ADD](h,f);continue}const p=S[r-u.FN0];if(!p)break;if(p.arity===1)s[a-1]=p.js(s[a-1]);else if(p.arity===2){const f=s[--a];s[a-1]=p.js(s[a-1],f)}else{const f=s[--a],h=s[--a];s[a-1]=p.js(s[a-1],h,f)}}const n=a>0?s[a-1]:0;return Number.isFinite(n)?n<-z?-z:n>z?z:n:0}const X={x:[-1,1],y:[-1,1],r:[0,Math.SQRT2],a:[-Math.PI,Math.PI],t:[0,2*Math.PI],px:[-1,1],py:[-1,1]},w=1e6,A=(...t)=>[Math.min(...t),Math.max(...t)],J=([t,e],s,a)=>[Math.min(a,Math.max(s,t)),Math.min(a,Math.max(s,e))],b=([t,e])=>t>=0?[t,e]:e<=0?[-e,-t]:[0,Math.max(-t,e)],k=t=>([e,s])=>A(t(e),t(s)),B=(t,e)=>A(t[0]*e[0],t[0]*e[1],t[1]*e[0],t[1]*e[1]),st=(t,e)=>[t[0]+e[0],t[1]+e[1]],at=(t,e)=>[t[0]-e[1],t[1]-e[0]],zt=([t,e])=>t>0||e<0,nt=([t,e])=>[Number.isNaN(t)?-w:Math.max(-w,t),Number.isNaN(e)?w:Math.min(w,e)];function Nt(t,e){return zt(e)?B(t,[1/e[1],1/e[0]]):[-w,w]}function ot(t,e){const s=b(t),a=nt(A(Math.pow(s[0],e[0]),Math.pow(s[0],e[1]),Math.pow(s[1],e[0]),Math.pow(s[1],e[1])));return t[0]>=0?a:t[1]<=0?[-a[1],-a[0]]:[-a[1],a[1]]}function K(t,[e,s]){if(s-e>=2*Math.PI)return[-1,1];const a=[t(e),t(s)],o=Math.ceil(e/(Math.PI/2)),n=Math.floor(s/(Math.PI/2));for(let r=o;r<=n;r++)a.push(t(r*Math.PI/2));const i=A(...a);return[Math.max(-1,i[0]),Math.min(1,i[1])]}const rt={sin:([t])=>K(Math.sin,t),cos:([t])=>K(Math.cos,t),tanh:([t])=>k(Math.tanh)(J(t,-15,15)),gauss:([t])=>{const e=b(t);return[Math.exp(-e[1]*e[1]),Math.exp(-e[0]*e[0])]},abs:([t])=>b(t),sqrt:([t])=>k(Math.sqrt)(b(t)),exp:([t])=>k(Math.exp)(J(t,-20,20)),log:([t])=>k(e=>Math.log(e+1e-6))(b(t)),length:([t,e])=>{const s=b(t),a=b(e);return[Math.hypot(s[0],a[0]),Math.hypot(s[1],a[1])]},min:([t,e])=>[Math.min(t[0],e[0]),Math.min(t[1],e[1])],max:([t,e])=>[Math.max(t[0],e[0]),Math.max(t[1],e[1])],pow:([t,e])=>ot(t,e),mix:([t,e,s])=>st(t,B(at(e,t),s)),smoothstep:()=>[0,1],mod:([,t])=>t[0]>0?[0,t[1]]:t[1]<0?[t[0],0]:[-w,w],sign:([t])=>[Math.sign(t[0]),Math.sign(t[1])],atan2:()=>[-Math.PI,Math.PI],fract:()=>[0,1],floor:([t])=>[Math.floor(t[0]),Math.floor(t[1])],step:()=>[0,1],tan:()=>[-20,20],atan:([t])=>k(Math.atan)(t),clamp:([t,e,s])=>{const a=[Math.min(e[0],s[0]),Math.min(e[1],s[1])],o=[Math.max(e[0],s[0]),Math.max(e[1],s[1])];return[Math.min(Math.max(t[0],a[0]),o[0]),Math.min(Math.max(t[1],a[1]),o[1])]}};for(const t of S)if(!rt[t.name])throw new Error(`interval: no range rule for ${t.name}`);function It(t,e=X){const s=a=>{switch(a.k){case"num":return[a.v,a.v];case"var":return e[a.name]??X[a.name];case"neg":{const o=s(a.a);return[-o[1],-o[0]]}case"bin":{const o=s(a.a),n=s(a.b);switch(a.op){case"+":return st(o,n);case"-":return at(o,n);case"*":return B(o,n);case"/":return Nt(o,n);case"^":return ot(o,n)}}case"call":{const o=rt[a.fn];return o?o(a.args.map(s)):[-w,w]}}};return nt(s(t))}function kt(t){const e=new Set,s=a=>{a.k==="var"?e.add(a.name):a.k==="neg"?s(a.a):a.k==="bin"?(s(a.a),s(a.b)):a.k==="call"&&a.args.forEach(s)};return s(t),e}const O=24,St=Array.from({length:8},(t,e)=>2*Math.PI*e/8),_t=[[0,0],[-1,-1],[1,-1],[-1,1],[1,1]];function Bt(t,e){const s=kt(e),a=s.has("t")?St:[0],o=s.has("px")||s.has("py")?_t:[[0,0]];let n=1/0,i=-1/0;for(const p of a)for(const[f,h]of o)for(let g=0;g<O;g++)for(let c=0;c<O;c++){const m=-1+2*c/(O-1),x=-1+2*g/(O-1),d=Pt(t,bt(m,x,p,f,h));d<n&&(n=d),d>i&&(i=d)}const[r,l]=It(e);return n=Math.max(n,r),i=Math.min(i,l),n<=i||(n=Math.min(n,i),i=n),{lo:n,hi:i,mid:(n+i)/2,half:Math.max((i-n)/2,1e-6)}}export{Tt as A,pt as B,V as C,Mt as D,Ot as G,y as M,S as O,R as V,U as Z,Et as a,P as b,et as c,Dt as d,Pt as e,Ct as f,Bt as g,E as h,It as i,Ut as j,Ft as k,jt as l,bt as m,Wt as n,H as o,mt as p,Z as q,Rt as r,At as t};
