import { c as createComponent } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { r as renderComponent, a as renderTemplate, m as maybeRenderHead, b as addAttribute, c as renderSlot } from './prerender_C0e3ybT5.mjs';
import { $ as $$BaseLayout } from './BaseLayout_CxXKHCwC.mjs';

const $$AdminLayout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$AdminLayout;
  const { title, tabs = ["params", "presets"], paramsPaneId, canvasStyle } = Astro2.props;
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": title, "data-astro-cid-2kanml4j": true }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="admin-wrap" data-astro-cid-2kanml4j> <div class="admin-canvas-area" data-astro-cid-2kanml4j> <canvas id="admin-canvas"${addAttribute(canvasStyle, "style")} data-astro-cid-2kanml4j></canvas> <div id="admin-fallback" class="admin-fallback" style="display:none;" data-astro-cid-2kanml4j> <p data-astro-cid-2kanml4j>WebGPU not available.</p> </div> ${renderSlot($$result2, $$slots["canvas-overlay"])} <div class="sim-controls" data-astro-cid-2kanml4j> <button id="btn-play-pause" class="sim-btn" data-astro-cid-2kanml4j>⏸</button> <button id="btn-reset" class="sim-btn" data-astro-cid-2kanml4j>↺</button> </div> </div> <div class="admin-sidebar" data-astro-cid-2kanml4j> <div class="tab-bar" data-astro-cid-2kanml4j> ${tabs.map((tab, i) => renderTemplate`<button${addAttribute(`tab-btn${i === 0 ? " active" : ""}`, "class")}${addAttribute(tab, "data-tab")} data-astro-cid-2kanml4j> ${tab.charAt(0).toUpperCase() + tab.slice(1)} </button>`)} </div> ${tabs.map((tab, i) => renderTemplate`<div${addAttribute(i === 0 && paramsPaneId ? paramsPaneId : `tab-${tab}`, "id")}${addAttribute(`tab-pane${i === 0 ? " params-panel" : ""}`, "class")}${addAttribute(i > 0 ? "display:none;" : "", "style")} data-astro-cid-2kanml4j></div>`)} ${renderSlot($$result2, $$slots["default"])} </div> </div> ` })}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/layouts/AdminLayout.astro", void 0);

export { $$AdminLayout as $ };
