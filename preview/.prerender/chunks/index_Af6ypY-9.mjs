import { c as createComponent } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { r as renderComponent, a as renderTemplate, m as maybeRenderHead } from './prerender_C0e3ybT5.mjs';
import { $ as $$BaseLayout } from './BaseLayout_CxXKHCwC.mjs';
import { $ as $$SimulationCard } from './SimulationCard_CcP16FN5.mjs';
import { g as getCollection } from './_astro_content_CVRrWmNN.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const projects = await getCollection("projects");
  const sorted = projects.sort((a, b) => a.data.order - b.data.order);
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "Gallery", "data-astro-cid-avfgzb42": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="content-width section" data-astro-cid-avfgzb42> <p class="section-label" data-astro-cid-avfgzb42>Gallery</p> <h1 data-astro-cid-avfgzb42>Simulation Art</h1> <div class="gallery-grid" data-astro-cid-avfgzb42> ${sorted.map((project) => renderTemplate`${renderComponent($$result2, "SimulationCard", $$SimulationCard, { "title": project.data.title, "description": project.data.description, "slug": project.data.simulation, "thumbnail": project.data.thumbnail, "data-astro-cid-avfgzb42": true })}`)} </div> </div> ` })}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/gallery/index.astro", void 0);

const $$file = "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/gallery/index.astro";
const $$url = "/C:/Program%20Files/Git/preview/gallery";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
