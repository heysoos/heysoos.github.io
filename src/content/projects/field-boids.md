---
title: "Field Boids"
description: "Boids at physarum scale — millions of agents steering by a shared density and momentum field instead of pairwise neighbours."
simulation: "field-boids"
order: 5
---

The same three rules as boids — separation, alignment, cohesion — but each agent reads a texture instead of a neighbour list. Every frame the flock deposits its density and momentum into a field; every agent then samples that field in a cone ahead of it. No spatial grid, no sorting: the cost is linear in the number of agents, so the flock can be a million strong.

Turning up *memory* lets the field persist between frames, sliding the model from instantaneous boids toward a physarum-style transport network.

> **Controls**
> - Open <span class="ctrl-preview">⚙</span> to tune the forces, radii, and particle count
> - Field — memory (trail persistence) and splat size
> - View — density, flow (hue by heading), or raw points
