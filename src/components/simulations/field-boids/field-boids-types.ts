// src/components/simulations/field-boids/field-boids-types.ts

export interface FieldBoidsParams {
  dt: number;
  numParticles: number;
  attractionRadius: number;
  repulsionRadius: number;
  attraction: number;
  repulsion: number;
  alignment: number;
  friction: number;
  maxSpeed: number;
  coneAngle: number;      // dot-product FOV threshold, -1 = full circle
  noise: number;
  mouseRadius: number;
  memory: number;         // 0 = field cleared every frame, →1 = long trails
  splatSize: number;      // gaussian sigma in field texels
  viewMode: number;       // 0 density, 1 flow (hue by direction), 2 points
  exposure: number;       // density → brightness gain
  pointAlpha: number;     // per-point alpha in points view
}

export interface FieldBoidsPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  params: FieldBoidsParams;
}

export const DEFAULT_FIELD_BOIDS_PARAMS: FieldBoidsParams = {
  dt: 0.016,
  numParticles: 500000,
  attractionRadius: 0.15,
  repulsionRadius: 0.03,
  attraction: 0.3,
  repulsion: 1.5,
  alignment: 0.1,
  friction: 2.0,
  maxSpeed: 0.22,
  coneAngle: -0.5,
  noise: 0.0,
  mouseRadius: 0.15,
  memory: 0.0,
  splatSize: 1.5,
  viewMode: 0,
  exposure: 2.0,
  pointAlpha: 0.15,
};
