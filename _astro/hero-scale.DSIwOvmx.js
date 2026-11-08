function n(a,E){const t=Math.max(0,a)*Math.max(0,E);return t<=0?1:Math.min(1,Math.max(.2,t/144e4))}function r(a,E,t){return Math.max(1,Math.round(a*n(E,t)))}export{r as s};
