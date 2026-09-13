// src/lib/sim-page/sim-setup/index.ts
import type { BoidsController } from '../../../components/simulations/boids/boids-controller';
import type { CPPNController } from '../../../components/simulations/cppn/cppn-controller';
import type { NCAController } from '../../../components/simulations/nca/nca-controller';
import type { FieldBoidsController } from '../../../components/simulations/field-boids/field-boids-controller';
import { setupBoids } from './boids';
import { setupCPPN } from './cppn';
import { setupNCA } from './nca';
import { setupFieldBoids } from './field-boids';

type AnyController = { init(c: HTMLCanvasElement): Promise<boolean>; start(): void; stop(): void; reset(): void };

/**
 * Returns true if the sim has a settings panel (controls bar should show ⚙ button).
 * Returns false for unknown sims or sims without panels.
 */
export async function setupSim(
  sim: string,
  ctrl: AnyController,
  panelContent: HTMLElement,
  panel: HTMLElement,
  shaderPanelEl: HTMLElement,
): Promise<boolean> {
  switch (sim) {
    case 'boids':
      await setupBoids(ctrl as BoidsController, panelContent, panel, shaderPanelEl);
      return true;
    case 'cppn':
      await setupCPPN(ctrl as CPPNController, panelContent, panel);
      return true;
    case 'nca':
      setupNCA(ctrl as NCAController, panelContent, panel);
      return true;
    case 'field-boids':
      await setupFieldBoids(ctrl as FieldBoidsController, panelContent, panel);
      return true;
    default:
      return false;
  }
}
