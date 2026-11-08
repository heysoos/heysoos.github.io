import { c as createComponent, s as siteConfig } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { r as renderComponent, a as renderTemplate, m as maybeRenderHead } from './prerender_C0e3ybT5.mjs';
import { $ as $$BaseLayout } from './BaseLayout_CxXKHCwC.mjs';
import { $ as $$PublicationCard } from './PublicationCard_Dk7kbPdO.mjs';
import { $ as $$SimulationCard } from './SimulationCard_CcP16FN5.mjs';
import { g as getCollection } from './_astro_content_CVRrWmNN.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const featuredPubs = (await getCollection("publications")).filter((p) => p.data.featured).sort((a, b) => b.data.year - a.data.year).slice(0, 5);
  const projects = (await getCollection("projects")).sort((a, b) => a.data.order - b.data.order);
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "backgroundSim": "boids" , "data-astro-cid-j7pv25f6": true }, { "default": async ($$result2) => renderTemplate`${maybeRenderHead()}<section class="hero" data-astro-cid-j7pv25f6> ${ false} <div class="hero-content" data-astro-cid-j7pv25f6> <div class="hero-text" data-astro-cid-j7pv25f6> <h1 data-astro-cid-j7pv25f6>${siteConfig.name}</h1> <p class="tagline" data-astro-cid-j7pv25f6>${siteConfig.tagline}</p> </div> </div> </section> <section class="section fade-in" data-astro-cid-j7pv25f6> <div class="content-width" data-astro-cid-j7pv25f6> <p class="section-label" data-astro-cid-j7pv25f6>About</p> <p class="about-teaser" data-astro-cid-j7pv25f6>
Researcher at the intersection of computational neuroscience, artificial life, and machine learning.
        Studying how complexity emerges from simple systems — from critical phase transitions to open-ended evolution.
</p> <a href="/about" class="section-link" data-astro-cid-j7pv25f6>Read more →</a> </div> </section> ${featuredPubs.length > 0 && renderTemplate`<section class="section fade-in" data-astro-cid-j7pv25f6> <div class="content-width" data-astro-cid-j7pv25f6> <p class="section-label" data-astro-cid-j7pv25f6>Selected Publications</p> ${featuredPubs.map((pub) => renderTemplate`${renderComponent($$result2, "PublicationCard", $$PublicationCard, { "title": pub.data.title, "authors": pub.data.authors, "journal": pub.data.journal, "year": pub.data.year, "doi": pub.data.doi, "url": pub.data.url, "tags": pub.data.tags, "data-astro-cid-j7pv25f6": true })}`)} <a href="/publications" class="section-link" data-astro-cid-j7pv25f6>All publications →</a> </div> </section>`}<section class="section fade-in" data-astro-cid-j7pv25f6> <div class="content-width" data-astro-cid-j7pv25f6> <p class="section-label" data-astro-cid-j7pv25f6>Simulation Art</p> <div class="gallery-teaser" data-astro-cid-j7pv25f6> ${projects.map((project) => renderTemplate`${renderComponent($$result2, "SimulationCard", $$SimulationCard, { "title": project.data.title, "description": project.data.description, "slug": project.data.simulation, "thumbnail": project.data.thumbnail, "data-astro-cid-j7pv25f6": true })}`)} </div> <a href="/gallery" class="section-link" data-astro-cid-j7pv25f6>View gallery →</a> </div> </section> ` })}  ${ false}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/index.astro", void 0);

const $$file = "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/index.astro";
const $$url = "/C:/Program%20Files/Git/preview";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
