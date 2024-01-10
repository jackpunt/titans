import { GameSetup as GameSetup0, Scenario as Scenario0, TP } from '@thegraid/hexlib';

export interface Scenario extends Scenario0 {

};

/** initialize & reset & startup the application/game. */
export class GameSetup extends GameSetup0 {

  override initialize(canvasId: string): void {
    // TitanHex uses NsTopo, size 7.
    TP.useEwTopo = false;
    TP.nHexes = 7;
    super.initialize(canvasId);
    return;
  }

}
