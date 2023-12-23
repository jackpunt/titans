import { Card, HouseToken, SlotInfo, Stack } from "./card";
import { stime } from '@thegraid/common-lib';
import { CardContainer, CCopts, ContainerAt } from "./card-container";
import { CardEvent } from "./card-event";
import { ValueCounter } from "./value-counter";
import { Player, PlayerState } from "./player";
import { C, F, S, WH } from "./basic-intfs"
import { Table } from "./table";
import { GamePlay } from "./game-play";
import { TP } from "./table-params";
import { Text } from "@thegraid/easeljs-module" // TODO: use @thegraid/easeljs-module

type IMoveRec = {
  id?: number,
  name?: string, row: number, col: number, dist: number, dir: string, phys?: number
  // if 'done' do not continueMove; record is obsolete, preempted by a Transit/moveTo
  done?: boolean, card: Card, start?: boolean,
  fromTransit?: string,     // transitTo sets IMoveRec.fromTransit to card.name, avoid spurious isLoopMov
  playerStates?: PlayerState[]
}
/** card: Card we are on; dist: Distance remaining to move; dir: Direction of entry to Card.
 * include row & col so we can use single descontruct, versus card.slotInfo
 * but assert that {row, col} in CardRec == {row, col} from SlotInfo
 */
export class MoveRec implements IMoveRec {
  dir: string;
  dist: number;
  name?: string;
  row: number;
  col: number;
  phys?: number;

  id?: number;
  start?: boolean;
  done?: boolean;           // if 'done' do not continueMove; record is obsolete, preempted by a Transit/moveTo
  fromTransit?: string;     // transitTo sets to card.name, avoid spurious isLoopMov
  playerStates?: PlayerState[];
  card: Card;

  static moveRecId: number = 0; // reset by player.newHistory()
  /** uniform way to create a MoveRec, with serial number [id] */
  constructor(init: IMoveRec) {
    this.dir = init.dir
    this.dist = init.dist
    this.name = init.name
    this.row = init.row
    this.col = init.col

    if (init.id !== undefined) { console.log(stime(this, ".constructor: inr already has id="), init.id, init)}
    this.id = ++MoveRec.moveRecId
    this.done = init.done
    this.card = init.card
    this.start = init.start
    this.fromTransit = init.fromTransit
    this.playerStates = init.playerStates
  }
}
export interface SiteInfo extends SlotInfo {
  cost?: number
  card?: Card
}
export class MainMap extends CardContainer {
  table: Table
  _gamePlay: GamePlay
  radius = TP.hexRad;

  constructor(source: Stack | Card[] | WH, opts?: CCopts) {
    super(source, opts)
    this.allowDropOnCard = this._allowDropOnCard // rely on markLegalPlacements
  }

  get gamePlay() { return this._gamePlay }

  filterTiles(filter: (c: Card) => boolean, ...except: string[]): Card[] {
    let cards = this.children as Card[]
    return cards.filter((c: Card) => (c instanceof Card && c.isTile(...except)) && filter(c))
  }
  nextAlignmentCard(alignDeck: CardContainer = this.table.alignDeck) {
    let alignCard = alignDeck.bottomCardOfStack()
    alignDeck.addCard(alignCard); // bring to top of stack
    this.setAlignment(alignCard)
  }
  /**  based on card.props.align: [ RR RR RR RR ] or [ RL RL RL RL ] */
  setAlignment(card: Card) {
    let rvec = card.props["align"]
    this.setAlignmentSpec(rvec)
  }
  /** build a twistMap for the given Alignment */
  setAlignmentSpec(rvec: string[]) {
    let vecRef = { N: 0, E: 1, S: 2, W: 3 }
    let zerMap = { N: "row", S: "row", E: "col", W: "col"}
    let eltMap = { N: "col", S: "col", E: "row", W: "row" } // which elt to change (the secondary/non-zero elt)
    let dirMap = { W: -1, E: +1, N: +1, S: -1 } // default Right Rotation
    let rotMap = { RR: 1, RL: -1 }
    this.twistMap["rvec"] = rvec
    S.dirs.forEach((dir: string) => {
      this.twistMap[dir][zerMap[dir]] = 0
      this.twistMap[dir][eltMap[dir]] = dirMap[dir] * rotMap[rvec[vecRef[dir]]]
    })
  }
  // mrow = r, mcol = c;
  // (0,0)_RR_(r,c) = 1 [W],  (0,0)_LL_(r,c) = 1 [N]
  // (0,0)_RR_(r,0) = 2 [NW], (0,0)_LL_(0,c) = 2 [WN]
  // (0,0)_RR_[W] = (r, c+1)
  twistMap = {W: {row:-1, col: 0}, E: {row: 1, col:0}, N: {row: 0, col:1}, S: {row: 0, col:-1}, 0:{row:0, col:0}} // RR
  incMap   = {W: {row: 0, col:-1}, E: {row: 0, col:1}, N: {row:-1, col:0}, S: {row: 1, col: 0}, 0:{row:0, col:0}}
  /** mov one step in dir, account for torus & twist */
  nextRowCol(row: number, col: number, dir: string, mrow: number, mcol: number): { row: number, col: number } {
    return this.nextRowColD(row, col, dir, mrow, mcol, 1)
  }
  /**
   *
   * @param dist must be less than mrow or mcol (depending on dir)
   * @returns
   */
  nextRowColD(row: number, col: number, dir: string, mrow: number, mcol: number, dist: number): {row: number, col: number, t: number} {
    let ikey = { N: "row", S: "row", E: "col", W: "col"}[dir]
    let tkey = { N: "col", S: "col", E: "row", W: "row"}[dir]
    if (ikey == "row") {
      let {n: nrow, t: tcol} = this.distInDir(row, dir, mrow, dist, ikey, tkey) // advance row
      let {n: ncol, t: _trow} = this.distInDir(col+tcol, dir, mcol, dist, tkey, ikey) // normalize col
      return { row: nrow, col: ncol, t: tcol}
    } else {
      let {n: ncol, t: trow} = this.distInDir(col, dir, mcol, dist, ikey, tkey) // advance col
      let {n: nrow, t: _tcol} = this.distInDir(row+trow, dir, mrow, dist, tkey, ikey) // normalize row
      return { row: nrow, col: ncol, t: trow}
    }
  }

  /** do modulus arithmetic and carry/borrow the twist */
  distInDir(orig: number, dir: string, max: number, dist: number, ikey: string, tkey: string): {n: number, t: number} {
    let twist = this.twistMap[dir][tkey]    // 2nd [row] is zero! "S"
    let inc = this.incMap[dir][ikey] * dist // 2nd [col] is zero
    let n = orig + inc, t = 0, zero = 0
    if (n >= max) return { n: n - max, t: twist }
    if (n < zero) return { n: n + max, t: twist }
    return {n, t}
  }

  /**
   * Find next Card in direction: from input rec {row, col, dir, dist, card?}
   * continue in direction (across empty stacks) until a Card is found.
   * find & set card in the return value; decrement dist
   * @param rec {row, col, dir, dist: number, card: any}
   * @returns new MoveRec {row+/-, col+/-, dir, dist-, card: Card}
   */
  findNextCard(rec: MoveRec): MoveRec {
    let mcol = this.slotsX, mrow = this.slotsY
    let mtot = mcol * mrow;   // mtot to avoid infinite loop if all cards removed (obsolete?)
    let card = undefined // measure physical distance
    let { row, col, dist, dir, phys } = rec;
    if (!phys) phys = 0
    while (card == undefined && mtot-- > 0) {
      //let row = nrow, col = ncol
      let { row: nrow, col: ncol } = this.nextRowCol(row, col, dir, mrow, mcol)
      card = this.bottomCardOfStack(nrow, ncol)
      row = nrow; col = ncol; phys += 1;
    }
    if (!card) alert("findNextLoc found no Card")
    // add id number:
    return new MoveRec({ name: card && card.name, row: row, col: col, dist: (dist - 1), dir: dir, card: card, phys });
  }
  /**
   * Move in moveDir (ignoring roads), until find a card that satisfies cardFilter.
   *
   * cardFilter is called with each card on the path.
   * cardFilter can modify moveRec.dir, but then it must also watch for loops.
   *
   * @param cardFilter stop scanning when filter returns TRUE
   * @return MoveRec where cardFilter is true (or originating card, if cardFilter always false)
   */
  scanTo(cardFilter: ((card: Card, rec?: MoveRec) => boolean), moveDir: string, orow: number, ocol: number): MoveRec {
    let card0 = this.bottomCardOfStack(orow, ocol), iterCnt = this.slotsX * this.slotsY
    let card = card0
    let locRec: MoveRec = new MoveRec({name: card.name, row: orow, col: ocol, dir: moveDir, dist: 1, card: card });
    //console.log(stime(this, ".scanTo: start locRec="), locRec)
    do {
      if (--iterCnt < 0) { alert("filter failed in scanTo from: " + card0.name); break }
      locRec.dist = 1
      locRec = this.findNextCard(locRec)   // scanTo: take 1 step in moveDir to next Card (nextRec.id++)
      card = locRec.card                  // !card IFF findNextLoc.mtot exceeded [no Card on mainMap]
    } while (!!card && !cardFilter(card, locRec)) // filter may change nextRec.dir
    //console.log(stime(this, ".scanTo:  end  locRec="), locRec)
    return locRec;
  }

  /**
   * check MoveRec from {orow, ocol} in each S.dirs until func(MoveRec) returns true
   * @param orow
   * @param ocol
   * @param func
   * @returns {row, col, dir, card, dist: 0} statisfying func()
   */
  findAdjacent(orow: number, ocol: number, func: (rec: MoveRec) => boolean): MoveRec {
    let dist = 1, card = undefined // value of dist does not matter; card is output in MoveRec
    let mcol = this.slotsX, mrow = this.slotsY
    let rv: MoveRec
    let dir = S.dirs.find(dir => {
      let {row, col} = this.nextRowCol(orow, ocol, dir, mrow, mcol)
      rv = {row, col, dir, dist, card};
      return func(rv)
    })
    return dir ? rv : undefined
  }
  /** is there a Card physically adjacent to the given location
   * @param row
   * @param col
   * @return true if there is a Card in any of 4 directions.
   */
  isAdjacentCard(row: number, col: number): boolean {
    let cardAt = (rec: MoveRec) => { return !!this.bottomCardOfStack(rec.row, rec.col)}
    return !!this.findAdjacent(row, col, cardAt)
  }
  /**
   * run func on each slot/MoveRec adjacent to {orow, ocol}
   * @param orow
   * @param ocol
   * @param func
   */
  forEachAdjacent(orow: number, ocol: number, func: (rec: MoveRec) => void) {
    let dist = 1, card = undefined // value of dist does not matter; card is output in MoveRec
    let mrow = this.slotsY, mcol = this.slotsX
    S.dirs.forEach(dir => {
      let {row, col} = this.nextRowCol(orow, ocol, dir, mrow, mcol)
      func({row, col, dir, dist, card})
    })
  }
  /** run matchFunc on NextCard in the 4 cardinal directions from rec
   * @param rec a MoveRec: rec.dir is MODIFIED by this method
   * @param matchFunc return \<T> if the given MoveRec [Card] is satisfactory
   */
  findAtNextCard<T>(row: number, col: number, matchFunc:((rec:MoveRec) => T)): T { // row, col, dist, dir [,card]
    let dist = 2, card: Card, dir: string
    let rec: MoveRec = {row, col, dist, card, dir}
    let matchMoveRec = (dir: string): T  => {
      rec.dir = dir
      let moveRec = this.findNextCard(rec) // isTransitCard
      return matchFunc(moveRec) // matchFunc: (moveRec) => (T | undefined)
    }
    let rv: T
    S.dirs.find(dir => { rv = matchMoveRec(dir); return !!rv }, this)
    return rv
  }
  /** find an adjacent Transit Card, if any. */
  isAdjacentTransit(row: number, col: number): Card {
    // step in each of 4 directions, return true if any other Transit tiles.
    function isTransitCard(moveRec: MoveRec): Card {
      // include Transit, Lake; but not Com-Transit(Taxi/Hub)
      return moveRec.card.isTransit() ? moveRec.card : undefined
    }
    return this.findAtNextCard(row, col, isTransitCard)
  }
  /** row,col is a Transit Site if none of the neighbors are Transit cards. */
  isTransitSite(row: number, col: number):boolean {
    let adjTransit = this.isAdjacentTransit(row, col) // card is not used
    return !adjTransit
  }

  /** works with markLegalPlacements to identify valid drop Slots. via CC.allowDropAt(row, col, card) */
  _allowDropOnCard(ce: CardEvent): boolean {
    let {row, col, cont} = ce, card = ce.card
    let stack = cont.getStack(row, col)
    // HouseToken preempts with useAllowDrop == true
    if ((stack.length < 1) && (stack[S.buildCost] !== undefined)) return true
    let tile = stack.find(c => c.isTile("Government", "Residential")) // stack[0], not Home/Housing/Gov
    let compatible = !!tile && (!tile.owner || tile.owner == this.table.curPlayer) && (card.type == tile.type) && !!card.subtype && card.subtype.includes(tile.subtype)
    return compatible && (card.costn > tile.costn)
  }

  /** temp-place Card on each open slot; for Transit, check adjacency;
   * for legal slots, calc (buildAdjust + cost) <= available coins
   * if (card == undefined) marks slots for Range & Transit [no card, no cost]
   * @param card to be built, will be temp placed on mainMap stack at each [row, col]
   * @param player consider player.onCard(), player.range, player.coins to determine legality
   * @param avail coins available to build this card
   * @param extra extra method to test or annotate the [legal] SlotInfo
   * @return Array<SiteInfo> of places on map where (buildCost <= coins)
   */
  markLegalPlacements(card: Card, player: Player, avail?: number, extra?: (si: SlotInfo) => void): Array<SiteInfo> {
    this.hideLegalMarks()
    let robo = (avail !== undefined) // hueristic: only roboPlayer overrides avail
    let buildWithinRange = (card === this.table.curPlayer.homeCard) ? false : TP.buildWithinRange
    let buildOnlyAdjacent = (card === this.table.curPlayer.homeCard) ? false : TP.buildOnlyAdjacent
    let card0 = player.onCard()
    let gplay = this.gamePlay, cont = this
    let range = player.rangeAdjust // for markLegalPlacements [gplay.adjustedRange(player)]
    let legalSites = new Array<SiteInfo>()
    let available = Math.max(0, player.coins);
    if (avail !== undefined) {
      available = avail
    } else if (this.table.dft.isVcOwned(card)) {
      available += this.table.dft.availableDebt(player) // vcPlayer will auto-borrow to build
    }
    /**
    * temporarily push card on mainMap, compute buildAdjust Effects
    * set stack[S.buildCost] = adjustedCost OR undefined
    * @param row
    * @param col
    * @param stack set [S.buildCost] here
    */
    let pushCardAndCheck = (row: number, col: number, stack: Stack) => {
      stack[S.buildCost] = 0                 // enable _allowDropOnCard [buildCost is defined]
      if (!this.allowDropAt(row, col, card)) // Can't build here: NOT (unoccupied OR upgrade: House/Tile)
        return
      stack[S.buildCost] = undefined         // disable _allowDropOnCard
      let info = {row: row, col: col, cont: this}
      stack.push(card)                       // temp add reference, no slotInfo, not a child
      card.setSlotInfo(info)                 // setSlotInfo so rangeTo will work: expects bottomCardOfStack!
      let siteInfo = checkFunc(row, col, stack) // checkLegalSetCost OR checkTransitRange
      if (!!siteInfo) {
        siteInfo.card = card
        if (!!extra) extra(siteInfo)
      }
      stack.pop()                            // remove Card from mainMap
    }
    /** simple version to check range & transit (no buildCost) */
    let checkRangeAndTransit = (row: number, col: number, stack: Stack): SiteInfo => {
      if (outOfRange(row, col, stack)) return undefined;
      let isTransitSite = this.isTransitSite(row, col)
      let value = isTransitSite ? "" : "x";
      if (!robo) this.showLegalMark(stack, value, C.legalGreen)
      let siteInfo: SiteInfo = {row, col, stack, cont}
      legalSites.push(siteInfo)
      return siteInfo
    }
    let outOfRange = (row: number, col: number, stack: Stack): boolean => {
      return (buildWithinRange && this.rangeTo(card0, card, range + 1) > range ||
        buildOnlyAdjacent && !this.isAdjacentCard(row, col))
    }
    /**
     * cost if card is built on stack.
     * @param cost - cost before credit
     * @return cost reduced by upgrade credit [if any]
     */
    let buildCostIfUpgrade = (cost: number, card: Card, row: number, col: number, stack: Stack) => {
      let tile = stack[0]   // the Tile being overlaid
      if (card instanceof HouseToken) {
        // stack: S.Housing tile, HouseToken(s), ... card
        if (!!tile && tile.name === S.Housing) {
          cost -= card.upgradeCredit(tile) // HouseToken.upgradeCredit: floor(h0.costn/2)
        }
      } else {
        // One or two cards: tile = stack[0], card = stack[n-1]
        if (tile != card) {
          cost -= Math.floor((tile.costn + tile.rentAdjust) / 2) // Tile upgradeCredit
        }
      }
      return cost
    }
    /** for each mainMap slot: [calc cost/legality of building card in that slot]
     * set stack[S.buildCost]
     * legalSites.push(SiteInfo)
     */
    let checkLegalSetCost = (row: number, col: number, stack: Stack): SiteInfo => {
      if (outOfRange(row, col, stack)) return undefined;
      // mark not visible: unavailable because Transit adjacency zoning rule:
      if (card.isTransit() && !this.isTransitSite(row, col)) return undefined;

      if (card[S.builds] == S.gov) {         // special "price" for force-place S.gov cards:
        stack[S.buildCost] = S.gov           // set flag for payAdjustedCost
        if (!robo) this.showLegalMark(stack, 0, C.legalGreen)
        let siteInfo: SiteInfo = {row, col, stack, cont, cost: 0, card}
        legalSites.push(siteInfo)
        return siteInfo
      }
      // looks legal, check the buildCost:
      let buildCost = gplay.adjustedBuild(card); // card.buildAdjust = cost when card is dropped on slot
      buildCost = stack[S.buildCost] = buildCostIfUpgrade(buildCost, card, row, col, stack) // may be <0 !!!
      let buildable = (buildCost <= available) && (TP.buyWhileNegative || player.coins >= 0)
      let color = buildable ? C.legalGreen : C.legalRed;
      if (!robo) this.showLegalMark(stack, buildCost, color)
      if (!buildable) return undefined;
      let siteInfo: SiteInfo = {row, col, stack, cont, cost: buildCost, card}
      legalSites.push(siteInfo) // legal place to build card
      return siteInfo
    }
    let checkFunc = checkLegalSetCost
    if (!card) {  // pick a card, any card... (logs as: "owner-BLUE-1 no legal placements")
      checkFunc = checkRangeAndTransit; card = player.ownerCard // a card to push & rangeTo
    }
    let slotInfo = card.getSlotInfo() // save original slotInfo (although: because of dragStart it is undefined)
    this.forAllStacks(pushCardAndCheck)
    card.slotInfo = slotInfo          // restore original slotInfo (or erase last binding from checklegal)

    this.stage.update()
    if (legalSites.length <= 0 && (!robo))
      console.log(stime(this, ".markLegalPlacements: no Legal Placements"), card.name, card.cost)
    return legalSites
  }

  /** put ValueCounter on each stack */
  makeLegalMarks() {
    // put a ValueCounter over the stack/slot(row, col)
    let makeValueMark = (row: number, col: number, stack: Stack): boolean => {
      let rc = `[${row},${col}]`
      // while we are doing allStacks, makeRC also:
      let makeRC = () => {
        let rcxy = this.slotXY(row - .3, col - .2)
        let rctxt = new Text(rc, F.fontSpec(50))
        rctxt.x = rcxy.x; rctxt.y = rcxy.y
        this.addChildAt(rctxt, 1)
        rctxt.visible = false
        stack['rctxt'] = rctxt
      }
      makeRC()
      let legalMark = new ValueCounter(S.legalMark, 0, C.legalGreen, 80)
      legalMark.name = `legalmark@${rc}`
      let xy = this.slotXY(row, col)
      // rely that mainMap.xy = overCont.xy == {0,0}, else need localToLocal() here:
      legalMark.attachToContainer((this.parent as ContainerAt).overCont, xy)
      legalMark.visible = false        // or true for startup/debug visualization
      stack[S.legalMark] = legalMark
      return false
    }
    this.forAllStacks(makeValueMark)
  }
  showRC(show?: boolean) {
    // toggle based on stack[0,0]['rctxt'].visible
    if (show === undefined) show = !this.getStack()['rctxt'].visible
    this.forAllStacks((row, col, stack) => !!stack['rctxt'] && (stack['rctxt'].visible = show) && false)
    this.stage.update()
  }
  /**
   * Set Value and Visibility of this mark.
   * @param stack at (row, col)
   * @param buildCost display value at (row, col) [typically the cost to build card]
   * @param color show cost in ellispe of this color
   * @param show supply 'false' to hide the mark
   */
  showLegalMark(stack: Stack, buildCost: number | string, color: string = C.legalGreen, show: boolean = true) {
    let mark = stack[S.legalMark] as ValueCounter;
    mark.visible = show;
    if (show) {
      mark.setValue(buildCost, color);
    }
    this.addChild(mark); // to top
  }
  hideLegalMarks() {
    this.forAllStacks((row, col, stack) => (stack[S.legalMark] as ValueCounter).visible = false)
    this.stage.update()
  }
  /** Simple approx range: ortho-4-connected pro'ly less that actual rangeTo */
  rangeSimple(card0: Card | SlotInfo, card1: Card | SlotInfo): number {
    // ortho-4-connected approximation (until we walk the Cards in place)
    // this will tend to *underestimate* but will find Adjacent.
    let mcol = this.slotsX, mrow = this.slotsY
    let { row: row0, col: col0 } = (card0 instanceof Card) ? card0.getSlotInfo() : card0
    let { row: row1, col: col1 } = (card1 instanceof Card) ? card1.getSlotInfo() : card1
    let dr = Math.min(Math.abs(row1 - row0), Math.abs(row1 + mrow - row0)) // ignoring twist!
    let dc = Math.min(Math.abs(col1 - col0), Math.abs(col1 + mcol - col0))
    return dr + dc;
  }

  /**
   * Range from card0 to card1; Breadth-First search, stepping by findNextLoc() in each direction.
   * @param card0 starting card
   * @param card1 ending card
   * @param limit return limit if card1 is not reached in limit steps
   * @return min steps from card-to-card to reach card1 (ignores roads) OR limit
   */
  rangeTo(card0: Card, card1: Card, limit?: number): number {
    let mcol = this.slotsX, mrow = this.slotsY
    if ((typeof limit) === "undefined") limit = mrow * mcol // given toroid, limit is pro'ly half that...
    let { row: row0, col: col0 } = card0.getSlotInfo()
    let { row: row1, col: col1 } = card1.getSlotInfo()
    let open = Array<MoveRec>()
    let visit = (card: Card, newRec: MoveRec) => {
      open.push(newRec)
    }
    if (row0 == row1 && col0 == col1) return 0;
    // initialize: visit the card0 source:
    visit(card0, { row: row0, col: col0, dist: 0, dir: "", card: card0, name: card0.name })
    let dirs = S.dirs
    // loop through all [current/future] open nodes:
    for (let ndx = 0; ndx < open.length; ndx++) {
      let rec = open[ndx]
      // explicit loop here so we can continue vs return; move each dir from rec:
      for (let dirNdx = 0; dirNdx < dirs.length; dirNdx++) {
        rec.dir = dirs[dirNdx]
        let newRec = this.findNextCard(rec) // rangeTo
        let { row, col, dist, card } = newRec
        if (card == card1) return -dist
        if (row == row1 && col == col1) return -dist  // found target[row1, col1] in -dist steps!
        if (-dist >= limit) continue                  // [row, col] is at/out of range...
        if (open.find(rec => (rec.card == card))) continue; // [row,col] already on open
        visit(card, newRec)             // check later to see if [row,col] is on shortest path
      }
    }
    return limit
  }
}
