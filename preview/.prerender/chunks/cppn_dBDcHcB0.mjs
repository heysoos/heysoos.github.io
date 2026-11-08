import { c as createComponent, r as renderScript } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { r as renderComponent, a as renderTemplate } from './prerender_C0e3ybT5.mjs';
import { $ as $$AdminLayout } from './AdminLayout_D9F9SdxI.mjs';

const $$Cppn = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "AdminLayout", $$AdminLayout, { "title": "CPPN Admin" })} ${renderScript($$result, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/admin/cppn.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/admin/cppn.astro", void 0);

const $$file = "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/admin/cppn.astro";
const $$url = "/C:/Program%20Files/Git/preview/admin/cppn";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Cppn,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
