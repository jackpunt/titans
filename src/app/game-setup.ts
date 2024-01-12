import { C, Constructor } from '@thegraid/common-lib';
import { GameSetup as GameSetupLib, Hex, Scenario as Scenario0, TP } from '@thegraid/hexlib';
import { TitanHex, TitanMap } from './titan-hex';

export interface Scenario extends Scenario0 {

};

export class GS {
  static hexk = .3;
  static transp = 'rgba(0,0,0,0)';
  static bgHexColor = C.BLACK;
  static blkHexColor = GS.transp;
  static exitDir = -1;
}

/** initialize & reset & startup the application/game. */
export class GameSetup extends GameSetupLib {

  override initialize(canvasId: string, qParams = []): void {
    // TitanHex uses NsTopo, size 7.
    TP.useEwTopo = false;
    TP.nHexes = 7;
    // TP.bgColor = 'BLACK'; // use addBackgroundHex()
    super.initialize(canvasId);
    return;
  }

  override startup(qParams?: { [key: string]: any; } | undefined): void {
    this.hexMap = new TitanMap<Hex>(TP.hexRad, true, TitanHex as Constructor<Hex>)
    this.nPlayers = Math.min(TP.maxPlayers, qParams?.['n'] ? Number.parseInt(qParams?.['n']) : 2);
    this.startScenario({turn: 0, Aname: 'defaultScenario'});
  }

}
