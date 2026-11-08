import { A as AstroError, I as InvalidComponentArgs, h as createRenderInstruction, m as maybeRenderHead, b as addAttribute, a as renderTemplate } from './prerender_C0e3ybT5.mjs';
import 'piccolore';
import 'clsx';

function validateArgs(args) {
  if (args.length !== 3) return false;
  if (!args[0] || typeof args[0] !== "object") return false;
  return true;
}
function baseCreateComponent(cb, moduleId, propagation) {
  const name = moduleId?.split("/").pop()?.replace(".astro", "") ?? "";
  const fn = (...args) => {
    if (!validateArgs(args)) {
      throw new AstroError({
        ...InvalidComponentArgs,
        message: InvalidComponentArgs.message(name)
      });
    }
    return cb(...args);
  };
  Object.defineProperty(fn, "name", { value: name, writable: false });
  fn.isAstroComponentFactory = true;
  fn.moduleId = moduleId;
  fn.propagation = propagation;
  return fn;
}
function createComponentWithOptions(opts) {
  const cb = baseCreateComponent(opts.factory, opts.moduleId, opts.propagation);
  return cb;
}
function createComponent(arg1, moduleId, propagation) {
  if (typeof arg1 === "function") {
    return baseCreateComponent(arg1, moduleId, propagation);
  } else {
    return createComponentWithOptions(arg1);
  }
}

async function renderScript(result, id) {
  const inlined = result.inlinedScripts.get(id);
  let content = "";
  if (inlined != null) {
    if (inlined) {
      content = `<script type="module">${inlined}</script>`;
    }
  } else {
    const resolved = await result.resolve(id);
    content = `<script type="module" src="${result.userAssetsBase ? (result.base === "/" ? "" : result.base) + result.userAssetsBase : ""}${resolved}"></script>`;
  }
  return createRenderInstruction({ type: "script", id, content });
}

const siteConfig = {
  name: "Sina Khajehabdollahi",
  tagline: "Physics · Computer Science · Artificial Life · Emergence · Art",
  description: "Personal portfolio and research website of Sina Khajehabdollahi — physicist, computer scientist, artificial life researcher, and computational artist.",
  email: "",
  socialLinks: {
    github: "https://github.com/heysoos/",
    googleScholar: "https://scholar.google.com/citations?user=OwyqJJ4AAAAJ&hl=en",
    orcid: "",
    twitter: "https://x.com/sinak12345",
    instagram: "https://www.instagram.com/psych_ai_delic"
  },
  navItems: [
    { label: "About", href: "/about" },
    { label: "Publications", href: "/publications" },
    { label: "Gallery", href: "/gallery" },
    { label: "Contact", href: "/contact" }
  ]};

const $$Nav = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$props, $$slots);
  Astro2.self = $$Nav;
  const currentPath = Astro2.url.pathname;
  return renderTemplate`${maybeRenderHead()}<nav class="nav" data-astro-cid-dmqpwcec> <div class="nav-inner" data-astro-cid-dmqpwcec> <a href="/" class="nav-logo" data-astro-cid-dmqpwcec>${siteConfig.name.toUpperCase()}</a> <div class="nav-right" data-astro-cid-dmqpwcec> <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false" data-astro-cid-dmqpwcec> <span class="nav-toggle-bar" data-astro-cid-dmqpwcec></span> <span class="nav-toggle-bar" data-astro-cid-dmqpwcec></span> <span class="nav-toggle-bar" data-astro-cid-dmqpwcec></span> </button> <ul class="nav-links" data-astro-cid-dmqpwcec> ${siteConfig.navItems.map((item) => renderTemplate`<li data-astro-cid-dmqpwcec> <a${addAttribute(item.href, "href")}${addAttribute([{ active: currentPath.startsWith(item.href) }], "class:list")} data-astro-cid-dmqpwcec> ${item.label} </a> </li>`)} </ul> <button class="theme-toggle" type="button" aria-label="Toggle color theme" title="Toggle day/night" data-astro-cid-dmqpwcec> <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-astro-cid-dmqpwcec> <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" data-astro-cid-dmqpwcec></path> </svg> <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-astro-cid-dmqpwcec> <circle cx="12" cy="12" r="4" data-astro-cid-dmqpwcec></circle> <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" data-astro-cid-dmqpwcec></path> </svg> </button> </div> </div> </nav>  ${renderScript($$result, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/Nav.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/components/Nav.astro", void 0);

export { $$Nav as $, createComponent as c, renderScript as r, siteConfig as s };
