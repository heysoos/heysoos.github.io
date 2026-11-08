import { c as createComponent, $ as $$Nav, s as siteConfig } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { a as renderTemplate, c as renderSlot, r as renderComponent, d as renderHead, b as addAttribute, m as maybeRenderHead } from './prerender_C0e3ybT5.mjs';
import 'clsx';

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$SimLayout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$SimLayout;
  const { title, description } = Astro2.props;
  const pageTitle = `${title} — ${siteConfig.name}`;
  return renderTemplate(_a || (_a = __template(['<html lang="en" data-astro-cid-5k67uhus> <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="description"', "><title>", `</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><script>
      // Apply saved theme before first paint to avoid a flash.
      try {
        var t = localStorage.getItem('theme');
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
      } catch (e) { /* storage may be blocked */ }
    <\/script>`, "</head> <body data-astro-cid-5k67uhus> ", ' <main class="sim-main" data-astro-cid-5k67uhus> ', " </main></body></html>"])), addAttribute(description || title, "content"), pageTitle, renderHead(), renderComponent($$result, "Nav", $$Nav, { "data-astro-cid-5k67uhus": true }), renderSlot($$result, $$slots["default"]));
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/layouts/SimLayout.astro", void 0);

const $$Controls = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Controls;
  const { simId } = Astro2.props;
  return renderTemplate`${maybeRenderHead()}<div class="controls"${addAttribute(`controls-${simId}`, "id")} data-astro-cid-ugf5jwxs> <button class="ctrl-btn" data-action="play-pause" title="Play/Pause" data-astro-cid-ugf5jwxs> <span class="ctrl-icon" data-astro-cid-ugf5jwxs>⏸</span> </button> <button class="ctrl-btn" data-action="reset" title="Reset" data-astro-cid-ugf5jwxs> <span class="ctrl-icon" data-astro-cid-ugf5jwxs>↺</span> </button> <button class="ctrl-btn" data-action="fullscreen" title="Fullscreen" data-astro-cid-ugf5jwxs> <span class="ctrl-icon" data-astro-cid-ugf5jwxs>⛶</span> </button> <button class="ctrl-btn" data-action="settings" title="Parameters" data-astro-cid-ugf5jwxs> <span class="ctrl-icon" style="font-size:0.85rem;" data-astro-cid-ugf5jwxs>⚙</span> </button> </div>`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/Controls.astro", void 0);

export { $$SimLayout as $, $$Controls as a };
