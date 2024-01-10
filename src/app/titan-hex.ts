import { C, Constructor, RC, S } from "@thegraid/common-lib";
import { H, Hex, Hex2, HexDir, HexMap, HexShape, PaintableShape, TP } from "@thegraid/hexlib";

class TitanShape extends HexShape {
  /**
   * Draw a Hexagon 1/60th inside the given radius.
   * overrides should include call to setHexBounds(radius, angle)
   * or in other way setBounds().
   * TODO: draw extended hexagon (truncated triangle?)
   */
  override hscgf(color: string, g0 = this.graphics) {
    return g0.f(color).dp(0, 0, Math.floor(this.radius * 59 / 60), 6, 0, this.tilt); // 30 or 0
  }
}

export class TitanHex extends Hex2 {
  constructor(map: HexMap<Hex2>, row: number, col: number, name: string) {
    super(map, row, col, name);
  }
  override makeHexShape(shape: Constructor<HexShape> = TitanShape) {
    const hs = new shape(this.radius, this.map.topoRot);
    this.cont.addChildAt(hs, 0);
    this.cont.hitArea = hs;
    hs.paint('grey');
    return hs;
  }

  _isBlack = false;
  get hexType() {
    return this._isBlack ? 'B' : (['N', 'ES', 'WS'].includes(this.dirToB) ? 'A' : 'V')
  }

  /** find direction to adjacent Hex with hexType === 'B' */
  get dirToB() {
    let dir = 'N' as HexDir; // NsDir when useEwTopo = false
    // ASSERT: there is at least 1 adjacent BLACK hex:
    this.findLinkHex((lh, d) => (lh?._isBlack ?? false) && (dir = d, true));
    return dir;
  }
}

export class TitanMap<T extends Hex> extends HexMap<T> {
  constructor(radius = TP.hexRad, addToMapCont: boolean, hexC: Constructor<Hex>) {
    super(radius, addToMapCont, hexC);
  }

  /**
   *
   * @param nh size: order of the hex (TP.nHexes = 7)
   * @param district: 0
   * @param mr meta-row: 1
   * @param mc meta-col: 0
   * @returns
   */
  override makeDistrict(nh: number, district: number, mr: number, mc: number): T[] {
    // the nth row starts in column k (and extends to nh + k)
    const kary = [3, 4, 4, 5, 6, 6, 7, 7, 6, 5, 5, 4, 3, 3];
    // even|odd hexes of selected rows are colored BLACK:
    const blk: { [index: number]: number | undefined } = { 2: 0, 3: 1, 5: 0, 6: 1, 8: 0, 9: 1, 11: 0 };
    const hexAry: T[] & { Mr?: number, Mc?: number } = Array<T>();
    hexAry['Mr'] = mr; hexAry['Mc'] = mc;
    const colc = nh;                      // typically: 7
    const rowc = 2 * (nh - 1);
    for (let row = 1; row <= rowc; row++) {
      const k = kary[row];
      const col0 = colc - k;
      const coln = colc + k;
      for (let col = col0; col <= coln; col++) {
        if ((row === rowc) && (col % 2 == 1)) continue;
        const bc = blk[row];
        const bh = (bc !== undefined ) && (col % 2 === bc);
        const hex = this.addHex(row, col, district);
        if (hex instanceof TitanHex && bh) {
          hex._isBlack = true;
          hex.hexShape.paint(C.BLACK);
        }
        hexAry.push(hex);
      }
    }
    this.forEachHex(hex => {
      this.shapeForHexType(hex as any as TitanHex)
    })
    return hexAry;
  }
  shapeForHexType(hex: TitanHex) {
    const hexType = hex.hexType
    // TODO: select hscgf and updateCache(bounds);

  }
}
