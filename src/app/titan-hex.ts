import { C, Constructor, stime } from "@thegraid/common-lib";
import { Graphics } from "@thegraid/easeljs-module";
import { H, Hex, Hex2, HexDir, HexMap, HexShape, TP } from "@thegraid/hexlib";

class TitanShape extends HexShape {
  hexType: 'A' | 'V' | 'B' = 'B';

  get ym() { return (this.hexType === 'A' ? -1 : 1) }
  y0(x: number) { return this.ym * (-H.sqrt3_2 + 0 * x); } // negative Y is top of hex: 'V'
  y1(x: number) { return this.ym * (H.sqrt3 + H.sqrt3 * x); }
  y2(x: number) { return this.ym * (H.sqrt3 - H.sqrt3 * x); }

  pt0(x: number): [number, number] { return [x, this.y0(x)] } // point on base line
  pt1(x: number): [number, number] { return [x, this.y1(x)] } // point on left line
  pt2(x: number): [number, number] { return [x, this.y2(x)] } // point on right line

  hexk(g: Graphics) {
    const k = .3, dx = k / 2;  // sin(30) === 1/2 !
    const x0 = .5 + k;  // bottom of 'A' (max y)
    const x1 = 1. + dx; // middle of 'A' (y = 0 - dx)
    const x2 = .5 - dx; // narrow of 'A' (min y)
    const p0a = this.pt0(+ x0);
    const p0b = this.pt0(- x0);
    const p1a = this.pt1(-x1);
    const p1b = this.pt1(-x2);
    const p2a = this.pt2(x2);
    const p2b = this.pt2(x1);

    const y01 = this.y0(x0), y02 = this.y2(x2);
    let y0 = Math.min(y01, y02);
    const y1 = Math.max(y01, y02);
    this.setBounds(-x1, y0, 2 * x1, y1 - y0);
    return g.mt(...p0a).lt(...p0b).lt(...p1a).lt(...p1b).lt(...p2a).lt(...p2b).cp();
  }

  /**
   * Draw a Hexagon 1/60th inside the given radius.
   * overrides should include call to setHexBounds(radius, angle)
   * or in other way setBounds().
   * TODO: draw extended hexagon (truncated triangle?)
   */
  override hscgf(color: string, g0 = this.graphics) {
    return (this.hexType === 'B') ? this.bscgf(color, g0) : this.tscgf(color, g0);
  }
  // TitanShape:
  tscgf(color: string, g0 = this.graphics) {
    const rad = Math.floor(this.radius * 59 / 60);
    this.scaleX = rad; this.scaleY = rad;
    return this.hexk(g0.f(color));
  }
  // BlackShape:
  bscgf(color: string, g0 = this.graphics) {
    const rad = Math.floor(this.radius * 59 / 60);
    this.scaleX = this.scaleY = 1;
    return g0.f(color).dp(0, 0, rad, 6, 0, this.tilt); // 30 or 0
  }
}

export class TitanHex extends Hex2 {

  override makeHexShape(shape: Constructor<HexShape> = TitanShape) {
    return super.makeHexShape(shape);
  }

  _isBlack = false;
  get isBlack() { return this._isBlack; }
  set isBlack(v: boolean) {
    this._isBlack = v;
  }

  get hexType() {
    return this.isBlack ? 'B' : (['N', 'ES', 'WS'].includes(this.dirToB) ? 'A' : 'V')
  }

  /** find direction to adjacent Hex with hexType === 'B' */
  get dirToB() {
    let dir = 'N' as HexDir; // NsDir when useEwTopo = false
    // ASSERT: there is at least 1 adjacent BLACK hex:
    this.findLinkHex((lh, d) => (lh?.isBlack ?? false) && (dir = d, true));
    return dir;
  }
}

export class TitanMap<T extends Hex> extends HexMap<T> {
  constructor(radius = TP.hexRad, addToMapCont: boolean, hexC: Constructor<Hex>) {
    super(radius, addToMapCont, hexC);
    console.log(stime(this, `.constructor: TitanMap constructor:`), hexC.name)
  }

  override addToMapCont(hexC?: Constructor<T> | undefined): this {
    this.mapCont.removeAllChildren();
    super.addToMapCont(hexC);
    return this;
  }

  /**
   * make district (a meta-hex) of size nh, a meta-loc: [mr, mc]
   * @param nh size: order of the hex (TP.nHexes = 7)
   * @param district: 0
   * @param mr meta-row: 1
   * @param mc meta-col: 0
   * @returns
   */
  override makeDistrict(nh: number, district: number, mr: number, mc: number): T[] {
    // the nth row starts in column k (and extends to nh + k)
    const kary = [3, 4, 4, 5, 6, 6, 7, 7, 6, 5, 5, 4, 3, 3, 2, 2, 1];
    // even|odd hexes of selected rows are colored BLACK:
    const blk: { [index: number]: number | undefined } = { 2: 0, 3: 1, 5: 0, 6: 1, 8: 0, 9: 1, 11: 0, 12: 1, 14: 0, 15: 1 };
    const hexAry: T[] & { Mr?: number, Mc?: number } = Array<T>();
    hexAry['Mr'] = mr; hexAry['Mc'] = mc;
    const colc = nh;                      // typically: 7
    const rowc = 2 * (nh - 1);
    for (let row = 1; row <= rowc; row++) {
      const k = Math.round(kary[row] * nh / 7); // something reasonable when (nh !== 7)
      const col0 = colc - k;
      const coln = colc + k;
      for (let col = col0; col <= coln; col++) {
        if ((row === rowc) && (col % 2 == 1)) continue;
        const bc = blk[row];
        const bh = (bc !== undefined ) && (col % 2 === bc);
        const hex = this.addHex(row, col, district);
        if (hex instanceof TitanHex && bh) {
          hex.isBlack = true;
          hex.hexShape.paint('rgba(0,0,0,0)', true);
          hex.cont.parent.addChildAt(hex.cont, 0); // put black in the back of hexCont.
        }
        hexAry.push(hex);
      }
    }
    this.forEachHex(hex => {
      this.paintAndCache(hex as any as TitanHex);
    })
    this.addBackgroundHex()
    return hexAry;
  }

  /** set hexShape.hexType; paint(), hex.cont.setBounds(hexShape.getBounds()) */
  paintAndCache(hex: TitanHex) {
    const hexType = hex.hexType, hexShape = hex.hexShape as TitanShape;
    hexShape.hexType = hexType;
    // hex.distText.text = `${hexShape.hexType}`;
    hexShape.paint(undefined, true);
    if (hexShape.hexType === 'A' || hexShape.hexType === 'V' || true) {
      // setBounds from TitanShape:
      const bs = hexShape.getBounds(), s = hexShape.scaleX;
      const b = { x: bs.x * s, y: bs.y * s, width: bs.width * s, height: bs.height * s }
      hex.cont.setBounds(b.x, b.y, b.width, b.height);
      hex.cont.cache(b.x, b.y, b.width, b.height);
    }
  }

  addBackgroundHex(color = C.PURPLE) {
    const ch = this.mapCont.hexMap.centerHex;
    const hexMapBG = new HexShape((TP.nHexes + 5.5) * TP.hexRad, this.topoRot);
    hexMapBG.x = ch.x; hexMapBG.y = ch.y;
    hexMapBG.paint(color);
    this.mapCont.hexCont.addChildAt(hexMapBG, 0);
  }
}
