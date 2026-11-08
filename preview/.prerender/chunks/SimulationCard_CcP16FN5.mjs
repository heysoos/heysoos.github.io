import { c as createComponent, r as renderScript } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { m as maybeRenderHead, b as addAttribute, a as renderTemplate, r as renderComponent } from './prerender_C0e3ybT5.mjs';
import 'clsx';

const $$SimulationPreview = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$SimulationPreview;
  const { simulation } = Astro2.props;
  return renderTemplate`${maybeRenderHead()}<div class="preview-wrap"${addAttribute(simulation, "data-preview-sim")} data-astro-cid-exjhz56w> <div class="preview-placeholder" data-astro-cid-exjhz56w></div> <canvas class="preview-canvas" data-astro-cid-exjhz56w></canvas> </div>  ${renderScript($$result, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/SimulationPreview.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/SimulationPreview.astro", void 0);

const $$SimulationCard = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$SimulationCard;
  const { title, description, slug } = Astro2.props;
  return renderTemplate`${maybeRenderHead()}<a${addAttribute(`/gallery/${slug}`, "href")} class="sim-card" data-astro-cid-ehn3irwf> <div class="sim-card-preview" data-astro-cid-ehn3irwf> ${renderComponent($$result, "SimulationPreview", $$SimulationPreview, { "simulation": slug, "data-astro-cid-ehn3irwf": true })} </div> <div class="sim-card-body" data-astro-cid-ehn3irwf> <h3 data-astro-cid-ehn3irwf>${title}</h3> <p data-astro-cid-ehn3irwf>${description}</p> </div> </a>`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/SimulationCard.astro", void 0);

export { $$SimulationCard as $ };
