// src/data/boids-presets.ts
import type { BoidsParams } from '../components/simulations/boids/boids-controller';

export interface BoidsPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  params: BoidsParams;
  trailsEnabled: boolean;
  trailDecay: number;
  shader?: string; // undefined = use default boids.wgsl
}

export const BOIDS_PRESETS: BoidsPreset[] = [
  {
    id: 'default',
    name: 'Default',
    isDefault: true,
    params: {
      dt: 0.016,
      numParticles: 200,
      attractionRadius: 0.2,
      repulsionRadius: 0.05,
      attraction: 0.3,
      repulsion: 1.5,
      alignment: 0.1,
      friction: 2.0,
      maxSpeed: 0.22,
      mouseRadius: 0.15,
      coneAngle: -0.5,
      size: 0.02,
      shapeId: 0,
      colorR: 0.88,
      colorG: 0.63,
      colorB: 0.25,
    },
    trailsEnabled: false,
    trailDecay: 0.92,
  },
];
