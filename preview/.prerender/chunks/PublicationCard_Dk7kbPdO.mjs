import { c as createComponent } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { m as maybeRenderHead, b as addAttribute, a as renderTemplate, r as renderComponent, F as Fragment } from './prerender_C0e3ybT5.mjs';

const $$PublicationCard = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$PublicationCard;
  const { title, authors, journal, year, doi, url, tags = [] } = Astro2.props;
  const link = doi ? `https://doi.org/${doi}` : url;
  const isMe = (a) => a.includes("Khajehabdollahi");
  const slugify = (tag) => tag.toLowerCase().replace(/\s+/g, "-");
  const dataTagsValue = tags.map(slugify).join(" ");
  const journalLabels = {
    "ALIFE": "ALIFE",
    "ICLR": "ICLR",
    "Entropy": "ENTROPY",
    "Brain Connectivity": "BRAIN CONN.",
    "IEEE Symposium on Artificial Life": "IEEE ALIFE"
  };
  const journalChip = journalLabels[journal] ?? null;
  return renderTemplate`${maybeRenderHead()}<article class="pub-entry"${addAttribute(dataTagsValue, "data-tags")}${addAttribute(String(year), "data-year")} data-astro-cid-trdbdie4> <h3 class="pub-title" data-astro-cid-trdbdie4> ${link ? renderTemplate`<a${addAttribute(link, "href")} target="_blank" rel="noopener" data-astro-cid-trdbdie4>${title}</a>` : title} </h3> <p class="pub-authors" data-astro-cid-trdbdie4> ${authors.map((a, i) => renderTemplate`${renderComponent($$result, "Fragment", Fragment, { "data-astro-cid-trdbdie4": true }, { "default": ($$result2) => renderTemplate`${isMe(a) ? renderTemplate`<strong data-astro-cid-trdbdie4>${a}</strong>` : a}${i < authors.length - 1 ? ", " : ""}` })}`)} </p> <p class="pub-meta" data-astro-cid-trdbdie4> ${journalChip ? renderTemplate`<span class="pub-journal-chip" data-astro-cid-trdbdie4>${journalChip}</span>` : renderTemplate`<span class="pub-journal" data-astro-cid-trdbdie4>${journal}</span>`}
&middot; ${year} </p> ${tags.length > 0 && renderTemplate`<div class="pub-tags" data-astro-cid-trdbdie4> ${tags.map((tag) => renderTemplate`<a class="pub-tag"${addAttribute(slugify(tag), "data-slug")}${addAttribute(`/publications#tag=${slugify(tag)}`, "href")} data-astro-cid-trdbdie4>${tag}</a>`)} </div>`} </article>`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/PublicationCard.astro", void 0);

export { $$PublicationCard as $ };
