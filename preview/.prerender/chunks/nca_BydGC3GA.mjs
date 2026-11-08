import { c as createComponent, r as renderScript } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { r as renderComponent, a as renderTemplate, m as maybeRenderHead } from './prerender_C0e3ybT5.mjs';
import { $ as $$AdminLayout } from './AdminLayout_D9F9SdxI.mjs';

const $$Nca = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "AdminLayout", $$AdminLayout, { "title": "NCA Admin", "tabs": ["params"], "paramsPaneId": "params-panel", "canvasStyle": "image-rendering: pixelated;", "data-astro-cid-nxwgrday": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="save-section" data-astro-cid-nxwgrday> <input id="preset-name" type="text" placeholder="Preset name…" data-astro-cid-nxwgrday> <button id="btn-save" class="sim-btn" data-astro-cid-nxwgrday>Save Preset</button> <div id="save-status" class="save-status" data-astro-cid-nxwgrday></div> </div> ` })}  ${renderScript($$result, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/admin/nca.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/admin/nca.astro", void 0);

const $$file = "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/admin/nca.astro";
const $$url = "/C:/Program%20Files/Git/preview/admin/nca";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Nca,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
