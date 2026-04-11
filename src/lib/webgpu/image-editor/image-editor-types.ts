// src/lib/webgpu/image-editor/image-editor-types.ts

export interface ImageTransform {
  offsetX: number; // canvas pixels from left
  offsetY: number; // canvas pixels from top
  scaleX:  number; // rendered width in canvas pixels
  scaleY:  number; // rendered height in canvas pixels
}

// 0–5 match the imageForceMode uniform value read in boids.wgsl
export const ProcessingMode = {
  LuminanceAttract:  0,
  LuminanceRepel:    1,
  GradientFlow:      2,
  GradientAttract:   3,
  Threshold:         4,
  SDF:               5,
} as const;
export type ProcessingMode = typeof ProcessingMode[keyof typeof ProcessingMode];

export const BrushMode = {
  Paint:      'paint',
  ErasePaint: 'erase-paint',
  MaskImage:  'mask-image',
  Blur:       'blur',
} as const;
export type BrushMode = typeof BrushMode[keyof typeof BrushMode];

export interface BrushOptions {
  mode:     BrushMode;
  x:        number;  // canvas pixels
  y:        number;  // canvas pixels
  radius:   number;  // canvas pixels
  softness: number;  // 0 = hard edge, 1 = full feather
}

export interface ProcessingParams {
  mode:       ProcessingMode;
  blurRadius: number;   // 0 = skip blur pass
  threshold:  number;   // [0,1], used by Threshold and SDF modes
  invert:     boolean;
}

export interface ImageEditorState {
  hasImage:   boolean;
  hasPaint:   boolean;  // paintCanvasTexture is non-empty
  transform:  ImageTransform;
  params:     ProcessingParams;
}
