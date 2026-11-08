import { c as createComponent, s as siteConfig, r as renderScript, $ as $$Nav } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { m as maybeRenderHead, b as addAttribute, u as unescapeHTML, a as renderTemplate, r as renderComponent, c as renderSlot, d as renderHead } from './prerender_C0e3ybT5.mjs';
import 'clsx';

const $$Footer = createComponent(($$result, $$props, $$slots) => {
  const iconMap = {
    github: {
      label: "GitHub",
      handle: (url) => url.replace("https://github.com/", "").replace(/\/$/, ""),
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`
    },
    googleScholar: {
      label: "Scholar",
      handle: () => "Scholar",
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.242 13.769L0 9.5 12 0l12 9.5-5.242 4.269C17.548 11.249 14.978 9.5 12 9.5c-2.977 0-5.548 1.748-6.758 4.269zM12 10a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"/></svg>`
    },
    orcid: {
      label: "ORCID",
      handle: (url) => url.replace("https://orcid.org/", ""),
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zM7.369 4.378c.525 0 .947.431.947.947s-.422.947-.947.947a.95.95 0 0 1-.947-.947c0-.516.422-.947.947-.947zm-.722 3.038h1.444v10.041H6.647V7.416zm3.562 0h3.9c3.712 0 5.344 2.653 5.344 5.025 0 2.578-2.016 5.016-5.325 5.016h-3.919V7.416zm1.444 1.303v7.444h2.297c2.359 0 3.9-1.303 3.9-3.722 0-2.263-1.441-3.722-3.816-3.722h-2.381z"/></svg>`
    },
    twitter: {
      label: "Twitter",
      handle: (url) => "@" + url.split("/").filter(Boolean).pop(),
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`
    },
    instagram: {
      label: "Instagram",
      handle: (url) => "@" + url.split("/").filter(Boolean).pop(),
      icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>`
    }
  };
  const activeLinks = Object.entries(siteConfig.socialLinks).filter(([, url]) => url).map(([key, url]) => ({ key, url, meta: iconMap[key] })).filter(({ meta }) => meta);
  return renderTemplate`${maybeRenderHead()}<footer class="footer" data-astro-cid-sz7xmlte> <div class="footer-inner" data-astro-cid-sz7xmlte> ${activeLinks.length > 0 && renderTemplate`<div class="social-pills" data-astro-cid-sz7xmlte> ${activeLinks.map(({ url, meta }) => renderTemplate`<a${addAttribute(url, "href")} target="_blank" rel="noopener noreferrer" class="pill"${addAttribute(meta.label, "aria-label")} data-astro-cid-sz7xmlte> <span data-astro-cid-sz7xmlte>${unescapeHTML(meta.icon)}</span> <span data-astro-cid-sz7xmlte>${meta.handle(url)}</span> </a>`)} </div>`} <p data-astro-cid-sz7xmlte>&copy; ${(/* @__PURE__ */ new Date()).getFullYear()} ${siteConfig.name}</p> </div> </footer>`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/Footer.astro", void 0);

const $$BackgroundSim = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$BackgroundSim;
  const { sim } = Astro2.props;
  return renderTemplate`${maybeRenderHead()}<canvas id="bg-sim-canvas" data-astro-cid-3yvfcuiv></canvas> <canvas id="bg-sim-debug" aria-hidden="true" data-astro-cid-3yvfcuiv></canvas> <div id="preset-picker" data-astro-cid-3yvfcuiv> <button id="preset-trigger" title="Switch preset" aria-label="Switch boids preset" data-astro-cid-3yvfcuiv> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-3yvfcuiv> <polygon points="22,12 8,4 8,20" data-astro-cid-3yvfcuiv></polygon> <line x1="1" y1="9" x2="6" y2="9" stroke-opacity="0.45" data-astro-cid-3yvfcuiv></line> <line x1="1" y1="12" x2="6" y2="12" stroke-opacity="0.75" data-astro-cid-3yvfcuiv></line> <line x1="1" y1="15" x2="6" y2="15" stroke-opacity="0.45" data-astro-cid-3yvfcuiv></line> </svg> </button> <div id="preset-menu" role="menu" aria-hidden="true" data-astro-cid-3yvfcuiv></div> </div>  ${renderScript($$result, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/BackgroundSim.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/BackgroundSim.astro", void 0);

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$BaseLayout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$BaseLayout;
  const {
    title = siteConfig.name,
    description = siteConfig.description,
    backgroundSim
  } = Astro2.props;
  const pageTitle = title === siteConfig.name ? title : `${title} — ${siteConfig.name}`;
  return renderTemplate(_a || (_a = __template(['<html lang="en" data-astro-cid-37fxchfa> <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="description"', "><title>", `</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><script>
      // Apply saved theme before first paint to avoid a flash.
      try {
        var t = localStorage.getItem('theme');
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
      } catch (e) { /* storage may be blocked */ }
    <\/script>`, "</head> <body data-astro-cid-37fxchfa> ", " ", " <main data-astro-cid-37fxchfa> ", " </main> ", "  ", "</body></html>"])), addAttribute(description, "content"), pageTitle, renderHead(), backgroundSim && renderTemplate`${renderComponent($$result, "BackgroundSim", $$BackgroundSim, { "sim": backgroundSim, "data-astro-cid-37fxchfa": true })}`, renderComponent($$result, "Nav", $$Nav, { "data-astro-cid-37fxchfa": true }), renderSlot($$result, $$slots["default"]), renderComponent($$result, "Footer", $$Footer, { "data-astro-cid-37fxchfa": true }), renderScript($$result, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/layouts/BaseLayout.astro?astro&type=script&index=0&lang.ts"));
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/layouts/BaseLayout.astro", void 0);

export { $$BaseLayout as $ };
