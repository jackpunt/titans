import { C, Constructor, F, RC, XY, stime } from "@thegraid/common-lib";
import { CenterText } from "@thegraid/easeljs-lib";
import { Graphics, Point } from "@thegraid/easeljs-module";
import { CircleShape, H, Hex, Hex2, HexDir, HexMap, HexShape, NsDir, TP } from "@thegraid/hexlib";
import { GS } from "./game-setup";

type TerrId = 'U' | 'N' | 'M' | 'K' | 'P' | 'D' | 'W' | 'H' | 'T' | 'B' | 'J' | 'S';
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
    const k = GS.hexk, dx = k / 2;  // sin(30) === 1/2 !
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
  terrId: TerrId = 'B'; // assume BLACK until assigned.
  topDir: NsDir = 'N';  // assume 'N' until assigned.

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

  get color() { return this.hexShape.colorn; }

  /** rcText always visible */
  override showText(vis = this.rcText.visible): void {
    this.rcText.visible = vis;
    this.cont.updateCache();
  }

  // TODO: include in next hexlib
  override edgePoint(dir: HexDir, k = 1, point: XY = new Point()) {
    const a = H.nsDirRot[dir as NsDir] * H.degToRadians, h = k * this.radius * H.sqrt3_2;
    point.x = this.hexShape.x + Math.sin(a) * h;
    point.y = this.hexShape.y - Math.cos(a) * h;
    return point as Point;
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
    const kval = (row: number) => {
      const k = Math.round(kary[row + 7 - nh] * nh / 7); // something reasonable when (nh !== 7)
      return [nh - k, nh + k] as [number, number];
    }
    // even|odd hexes of selected rows are colored BLACK:
    const blk: { [index: number]: number | undefined } = { 2: 0, 3: 1, 5: 0, 6: 1, 8: 0, 9: 1, 11: 0, 12: 1, 14: 0, 15: 1 };
    const hexAry: T[] & { Mr?: number, Mc?: number } = Array<T>();
    hexAry['Mr'] = mr; hexAry['Mc'] = mc;
    const rowc = 2 * (nh - 1);
    for (let row = 1; row <= rowc; row++) {
      const [col0, coln] = kval(row);
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
    this.labelHexes();
    return hexAry;
  }
  showVis(vis = true) {
    this.forEachHex<T>(hex => (hex as any as Hex2).showText(vis))
  }

  labelHexes() {
    // let sn = 1; .slice(sn, sn + 1) + sn
    this.rings.forEach((ring, n0) => {
      let n = n0 + 1, d = 0;
      this.ringWalk(n, (h: Hex, dir) => {
        const k = d % ring.length; // k: 0..n-1, d: 0..2*n-1,
        const m = d % (ring.length / 2);
        const hex = h as TitanHex;
        const id = ring[k]
        const diri = H.nsDirs.indexOf(dir as NsDir); // [N, EN, ES, S, WS, WN]
        const doff = [0, 1, 4, d + Math.floor(d / 3) * 3, [1,4,0,5,][m], [4,0,1,2,0][m], 0][n];
        const topDir = H.nsDirs[(diri + doff) % 6]; // turn right ...
        // (n == 3) && console.log(stime(this, `.label:`), { d, k, dir, doff, topDir });
        hex.rcText.text += `-r${n}`
        this.setTerrain(hex, id, k, topDir);
        d = d + 1;
      })
    })
    const dirs: NsDir[][] = [['EN', 'ES'], ['ES', 'S'], ['S', 'WS'], ['WS', 'WN'], ['WN', 'N'], ['N', 'EN']];
    let hex = this[1][3] as any as TitanHex;  // upper-left corner
    this.edge.forEach((line, nl) => {
      line.forEach((id, n) => {
        const dir = dirs[nl][n % 2];
        const diri = H.nsDirs.indexOf(dir as NsDir); // [N, EN, ES, S, WS, WN]
        const doff = [1, 1, 5, 1, 1, 1, 5][n];
        const topDir = H.nsDirs[(diri + doff) % 6]; // turn right ...
        this.setTerrain(hex, id, -nl, topDir);
        hex = hex.links[dir] as TitanHex;
      })
    })
  }

  /** set color, distText, and top-mark on hex, based on Id
   * @param id the designated TerrId
   * @param ring identifies which ring is being placed, < 0 for edge strips.
   * @param topDir identifies edge at top of BattleMap
   */
  setTerrain(hex: TitanHex, id: TerrId, ring = 0, topDir: NsDir = 'N') {
    const color = this.terrainColor[id], hexType = hex?.hexType, tname = this.terrainNames[id];
    // console.log(stime(this, '.labelHexes'), { k: ring, id, color, hexType, hexid: hex?.Aname, hex });
    if (hex === undefined) debugger;
    if (id === 'K' && hexType !== 'B') debugger;
    if (id !== 'K' && hexType === 'B') debugger;
    if (id !== 'K') {
      hex.hexShape.paint(color);
      // if (id === 'S' || id === 'J') hex.distText.color = C.WHITE;
      // if (id === 'P') hex.rcText.color = C.BLACK;
      if (hex.terrId === 'B') {      // do += only once!
        hex.terrId = id;
        hex.rcText.y += TP.hexRad * (hexType === 'V' ? .5 : 0);
        hex.topDir = topDir;
        const textRot = { N: 0, S: 0, EN: 60, ES: -60, WN: -60, WS: 60 };
        const tmark = new CenterText(`${123}`, F.fontSpec(16 * TP.hexRad / 60));
        tmark.rotation = textRot[topDir];
        hex.edgePoint(topDir, 1.05, tmark);
        hex.cont.addChild(tmark);
        // position label [distText]
        const ldir = H.dirRevNS[topDir];
        hex.edgePoint(ldir, .7, hex.distText);
        hex.distText.rotation = textRot[ldir];
        hex.distText.font = F.fontSpec(18 * TP.hexRad / 60);
      }
      hex.distText.text = tname;
      hex.distText.visible = true;
    }
  }

  terrainNames = {
    P: 'PLAINS', J: 'JUNGLE', B: 'BRUSH', M: 'MARSH', S: 'SWAMP', D: 'DESERT',
    U: 'TUNDRA', T: 'TOWER', W: 'WOODS', H: 'HILLS', N: 'MOUNTAINS', K: 'BLACK',
  }
  terrainColorColossus = {
    P: 'yellow', J: 'darkgreen', B: 'lime', M: 'indianred', S: 'blue', D: '#FFA200',
    U: 'skyblue', T: 'lightgrey', W: 'olive', H: 'brown', N: 'red', K: 'BLACK', // redbrown, transparent
  }
  terrainColorOrig = {
    P: 'gold', J: 'limegreen', B: '#BACD32', B1: 'yellowgreen', M: 'peru', S: 'skyblue', D: 'darkorange', //'#FFA200',
    U: '#D0D0F0', T: '#E0E0D0', W: '#DDD88A', H: 'saddlebrown', N: '#FF343C', K: 'BLACK', // redbrown, transparent
  }
  terrainColor = this.terrainColorOrig;

  ids: 'U' | 'N' | 'M' | 'K' | 'P' | 'D' | 'W' | 'H' | 'T' | 'B' | 'J' ;
  // step = 'N', startDir = 'ES'
  rings: TerrId[][] = [
    ['U', 'N'], // [u, n] * 3
    ['M', 'K', 'P', 'K'],  // r2: [mk,pk] * 3
    ['K', 'D', 'W', 'K', 'S', 'H'], // r3: [kdw, ksh] * 3
    ['T', 'P', 'K', 'B', 'T', 'M', 'K', 'B'],  // r4: [tpkb,tmkb] * 3
    ['M', 'K', 'J', 'H', 'K', 'P', 'K', 'J', 'W', 'K'],  // r5: [mkjhk,pkjwk] * 3
    // r6: [ksmkmb,kjbkpb,kdbkmb,ksbkpb,kjbkmb,kdbkpb] Use this.edge to fill outer rings.
  ]
  // r7: [...pd...,...ms...,...pj...,...md...,...pw...,...mj...]
  edge: TerrId[][] = [
    ['M', 'J', 'P', 'B', 'M', 'S', 'B', ], // en,es
    ['P', 'D', 'M', 'B', 'P', 'J', 'B', ], // s,es
    ['M', 'S', 'P', 'B', 'M', 'D', 'B', ], // ws,s
    ['P', 'J', 'M', 'B', 'P', 'S', 'B', ], // wn,ws
    ['M', 'D', 'P', 'B', 'M', 'J', 'B', ], // n,wn
    ['P', 'S', 'M', 'B', 'P', 'D', 'B', ], // en,n
  ];

  /**
   *
   * @param n number of Hex to create
   * @param rc {row, col} of current Hex of interest
   * @param dir after Hex at rc, move rc by dir to next hex of interest
   * @param f do 'whatever' and return the Hex at rc
   * @returns RC of (n+1)th Hex on the line (where you typically change to next dir)
   */
  forHexesOnLine(n: number, rc: RC, dir: HexDir, f: (rc: RC) => Hex): RC {
    for (let i = 0; i < n; i++) {
      rc = this.nextRowCol(f(rc), dir);
    }
    return rc;
  }

  /**
   * Apply f to each Hex on nth ring (starting from WS going N, then EN, ES, S, WS, WN)
   * @param n ring number
   * @param f (Hex) => void
   */
  ringWalk(n: number, f: (hex: Hex, dir: HexDir) => void) {
    const dirs = this.linkDirs;     // HexDirs of the extant Topo.
    const startDir = dirs[4]; // 'W' or 'WS' (so newHexesOnLine goes proper direction from each 'dirs')
    const startHex = this.centerHex.nextHex(startDir, n) as Hex;
    let rc = { row: startHex.row, col: startHex.col };
    dirs.forEach(dir => {
      rc = this.forHexesOnLine(n, rc, dir, (rc) => {
        const hex = this[rc.row][rc.col];
        f(hex, dir);
        return hex;
      });
    })
    return rc;
  }

  /** set hexShape.hexType; paint(), hex.cont.setBounds(hexShape.getBounds()) */
  paintAndCache(hex: TitanHex) {
    const hexType = hex.hexType, hexShape = hex.hexShape as TitanShape;
    hexShape.hexType = hexType;
    hexShape.paint(undefined, true);
    if (hexShape.hexType === 'A' || hexShape.hexType === 'V' || true) {
      // setBounds from TitanShape:
      const bs = hexShape.getBounds(), s = hexShape.scaleX;
      const b = { x: bs.x * s, y: bs.y * s, width: bs.width * s, height: bs.height * s }
      hex.cont.setBounds(b.x, b.y, b.width, b.height);
      hex.cont.cache(b.x, b.y, b.width, b.height);
    }
  }

  addBackgroundHex(color = GS.bgHexColor) {
    const ch = this.mapCont.hexMap.centerHex;
    const hexMapBG = new HexShape((TP.nHexes * 1.8) * TP.hexRad, this.topoRot);
    hexMapBG.x = ch.x; hexMapBG.y = ch.y;
    hexMapBG.paint(color);
    this.mapCont.hexCont.addChildAt(hexMapBG, 0);
  }
}
