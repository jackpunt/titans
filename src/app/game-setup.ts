import { C, Constructor } from '@thegraid/common-lib';
import { AliasLoader, GameSetup as GameSetupLib, Hex, Scenario as Scenario0, TP } from '@thegraid/hexlib';
import { TitanHex, TitanMap } from './titan-hex';
import { Params } from '@angular/router';

// type Params = {[key: string]: any;}; // until hexlib supplies
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
    super.initialize(canvasId);
    return;
  }

  override loadImagesThenStartup(qParams: Params = []) {

    const loader = AliasLoader.loader ?? (AliasLoader.loader = new AliasLoader());
    loader.imageArgs.ext = 'gif';
    const names = Object.values(TitanMap.terrainNames);
    const names_i = names.map(name => `${name}_i`);
    loader.fnames = names.concat(names_i).concat(['Recycle']);
    super.loadImagesThenStartup(qParams);    // loader.loadImages(() => this.startup(qParams));
  }

  override startup(qParams?: { [key: string]: any; } | undefined): void {
    const loader = AliasLoader.loader
    const brush = loader.getImage('Brush');
    this.hexMap = new TitanMap<Hex & TitanHex>(TP.hexRad, true, TitanHex as Constructor<Hex>)
    this.nPlayers = Math.min(TP.maxPlayers, qParams?.['n'] ? Number.parseInt(qParams?.['n']) : 2);
    this.startScenario({turn: 0, Aname: 'defaultScenario'});
  }

}
