import { GamePlay as GamePlayLib, Hex, HexMap, TP } from "@thegraid/hexlib";
import { TitanHex, TitanMap } from "./titan-hex";
import { Constructor } from "@thegraid/common-lib";


export class GamePlay extends GamePlayLib {
  override hexMap: TitanMap<TitanHex> = new TitanMap(TP.hexRad, true, TitanHex as Constructor<Hex>);
}
