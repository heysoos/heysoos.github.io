import { c as createComponent, r as renderScript } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { r as renderComponent, a as renderTemplate } from './prerender_C0e3ybT5.mjs';
import { $ as $$AdminLayout } from './AdminLayout_D9F9SdxI.mjs';

const $$FieldBoids = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "AdminLayout", $$AdminLayout, { "title": "Field Boids Admin" })} ${renderScript($$result, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/admin/field-boids.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/admin/field-boids.astro", void 0);

const $$file = "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/admin/field-boids.astro";
const $$url = "/C:/Program%20Files/Git/preview/admin/field-boids";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$FieldBoids,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
