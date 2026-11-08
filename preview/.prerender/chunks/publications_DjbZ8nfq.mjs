import { c as createComponent, r as renderScript } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { r as renderComponent, a as renderTemplate, m as maybeRenderHead, b as addAttribute } from './prerender_C0e3ybT5.mjs';
import { $ as $$BaseLayout } from './BaseLayout_CxXKHCwC.mjs';
import { $ as $$PublicationCard } from './PublicationCard_Dk7kbPdO.mjs';
import { g as getCollection } from './_astro_content_CVRrWmNN.mjs';

const $$Publications = createComponent(async ($$result, $$props, $$slots) => {
  const publications = await getCollection("publications");
  const sorted = publications.sort((a, b) => b.data.year - a.data.year);
  const byYear = {};
  for (const pub of sorted) {
    if (!byYear[pub.data.year]) byYear[pub.data.year] = [];
    byYear[pub.data.year].push(pub);
  }
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
  const slugify = (tag) => tag.toLowerCase().replace(/\s+/g, "-");
  const allTags = [...new Set(sorted.flatMap((p) => p.data.tags))].sort();
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "Publications", "data-astro-cid-f3fmnth3": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="pub-page section" data-astro-cid-f3fmnth3> <aside class="pub-sidebar" data-astro-cid-f3fmnth3> <div class="sidebar-label" data-astro-cid-f3fmnth3>topic</div> <nav class="tag-list" aria-label="Filter publications by topic" data-astro-cid-f3fmnth3> <button class="tag-btn active" data-tag="all" aria-pressed="true" data-astro-cid-f3fmnth3>all papers</button> ${allTags.map((tag) => renderTemplate`<button class="tag-btn"${addAttribute(slugify(tag), "data-tag")} aria-pressed="false" data-astro-cid-f3fmnth3>${tag}</button>`)} </nav> <div class="sidebar-divider" data-astro-cid-f3fmnth3></div> <div class="sidebar-label" data-astro-cid-f3fmnth3>year</div> <nav class="tag-list" aria-label="Filter publications by year" data-astro-cid-f3fmnth3> ${years.map((y) => renderTemplate`<button class="tag-btn"${addAttribute(String(y), "data-year")} aria-pressed="false" data-astro-cid-f3fmnth3>${y}</button>`)} </nav> </aside> <div class="pub-content" data-astro-cid-f3fmnth3> <p class="section-label" data-astro-cid-f3fmnth3>Publications</p> <h1 data-astro-cid-f3fmnth3>Research Papers</h1> ${years.map((year) => renderTemplate`<section class="year-section"${addAttribute(String(year), "aria-label")} data-astro-cid-f3fmnth3> <div class="year-label" data-astro-cid-f3fmnth3>${year}</div> ${byYear[year].map((pub) => renderTemplate`${renderComponent($$result2, "PublicationCard", $$PublicationCard, { "title": pub.data.title, "authors": pub.data.authors, "journal": pub.data.journal, "year": pub.data.year, "doi": pub.data.doi, "url": pub.data.url, "tags": pub.data.tags, "data-astro-cid-f3fmnth3": true })}`)} </section>`)} </div> </div> ` })}  ${renderScript($$result, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/publications.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/publications.astro", void 0);

const $$file = "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/publications.astro";
const $$url = "/C:/Program%20Files/Git/preview/publications";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Publications,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
