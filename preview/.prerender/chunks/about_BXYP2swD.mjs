import { c as createComponent, s as siteConfig } from './global_DpHWrXiA.mjs';
import 'piccolore';
import { r as renderComponent, a as renderTemplate, m as maybeRenderHead } from './prerender_C0e3ybT5.mjs';
import { $ as $$BaseLayout } from './BaseLayout_CxXKHCwC.mjs';

const $$About = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "About", "data-astro-cid-kh7btl4r": true }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<div class="content-width section" data-astro-cid-kh7btl4r> <p class="section-label" data-astro-cid-kh7btl4r>About</p> <h1 data-astro-cid-kh7btl4r>${siteConfig.name}</h1> <div class="bio" data-astro-cid-kh7btl4r> <p data-astro-cid-kh7btl4r>
I am a researcher working at the intersection of physics, computer science, artificial life, and machine learning. My work focuses on understanding how complexity emerges from simple systems.
</p> <h2 data-astro-cid-kh7btl4r>Research Trajectory</h2> <p data-astro-cid-kh7btl4r>
My journey began in astrophysics (BSc), where I developed a foundation in mathematical physics. During my Master's in physics, I studied integrated information theory, the Ising model, and critical brain theory — exploring the hypothesis that the brain operates near a critical phase transition.
</p> <p data-astro-cid-kh7btl4r>
I then moved into artificial life, experimenting with evolutionary algorithms, small embodied neural networks, and their relationship to criticality. My PhD in computer science at the University of Tubingen focused on models of self-organization — how complexity emerges from simple systems, and nature-inspired approaches to machine learning and AI.
</p> <p data-astro-cid-kh7btl4r>
Most recently, during my post-doc at INRIA Bordeaux, I worked on open-endedness through autotelic exploration of complex systems using vision-language models and foundation models.
</p> <p data-astro-cid-kh7btl4r><a href="/resume.pdf" class="resume-link" target="_blank" data-astro-cid-kh7btl4r>Download CV (PDF)</a></p> <h2 data-astro-cid-kh7btl4r>As an Artist</h2> <p data-astro-cid-kh7btl4r>
The simulations and computational systems I study are also often my artistic medium. I create generative and interactive art using code, through particle systems or other strange shaders to experiment with complex collective systems and their interactivity.
</p> </div> </div> ` })}`;
}, "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/about.astro", void 0);

const $$file = "C:/Users/Heysoos/Documents/Pycharm Projects/website/src/pages/about.astro";
const $$url = "/C:/Program%20Files/Git/preview/about";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$About,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
