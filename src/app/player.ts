import { Constructor, stime } from '@thegraid/common-lib';
import { Container, EventDispatcher, MouseEvent, Shape, Stage, Text } from '@thegraid/easeljs-module';
import { EzPromise } from '@thegraid/ezpromise';
import type { DebtContainer } from './Debt';
import { C, F, Obj, S, WH, XY } from './basic-intfs';
import { Card, Flag, HasSlotInfo, SlotInfo, Stack } from './card';
import { CCopts, CardContainer, ContainerAt } from './card-container';
import { CardEvent, ValueEvent } from "./card-event";
import { CardInfo } from './card-maker';
import { ChooseDir, DirSpec } from './choose-dir';
import { CmClient } from './cm-client';
import type { GamePlay } from './game-play';
import { MainMap, MoveRec } from './main-map';
import { PlayerStats } from './player-stats';
import type { Table } from "./table";
import { TP } from './table-params';
import { Tile } from './tile';
import { Notifyable } from './types';
import { ValueCounter } from "./value-counter";

/** all the vitals to reset Player to pre-move status (CardRec + resource slots) */
export type PlayerState = {
  player: Player, moveDir: string, coins: number, buys: number, builds: number, polis: number,
  moves: number, draws: number, stats: PlayerStats, rangeAdjustTurn: number
}

class DistArranger extends CardContainer {
  player: Player
  constructor(source: Stack | Card[] | WH, opts?: CCopts) {
    super(source, opts)
    this.anchorToOrigSlot = false
    this.allowDropOnCard = this.allowDrop;
    this.on(S.dropped, (ce:CardEvent) => { this.onDropped(ce) }) // DistArranger
    this.on(S.netDrop, (ce:CardEvent) => { this.onDropped(ce) }) // DistArranger
    // TODO: maybe capture dropEvent, and detect that this container is not to be interposed?
    // TODO: would be better if game-setup set dropEvent on each affected container, rather that static/global
    // so CC.dragFunc would use: S_dropEvent: string = this.dropEvent || S.dropped
  }
  // methods invoked by onPlyrDistClicked:
  /** arrange Cards in slotsX for D&D ordering */
  load() {
    this.player.distArrangerDone = false    // not essential, but for good form...
    if (this.parent) return // already loaded!
    this.player.plyrDist.parent.addChild(this)
    let stack: Stack = this.player.plyrDist.getStack()
    let cards = stack.map(c => c) // copy the array for iteration (stack will be modified)
    cards.reverse().forEach((card, ndx) => this.addCard(card, 0, ndx)) // removing each Card from stack
  }
  /** stack the arranged Cards on plyrDist */
  unload(setDone: boolean = true) {
    setDone && (this.player.distArrangerDone = true)
    if (!this.parent) return // not loaded!
    let plyrDist = this.player.plyrDist                 // where to stack the cards
    for (let slot = 0; slot < this.slotsX; slot++) {
      let card = this.bottomCardOfStack(0, slot) // removing from slot
      plyrDist.addCard(card)
    }
    plyrDist.parent.removeChild(this)  // remove display, mark as unloaded
  }

  /** OVERRIDE. Note: anchorToSlot=false */
  allowDrop(ce: CardEvent): boolean {
    return (ce.card.origSlot.cont === this) // allow drop to self in any slot (and there are no other dropTargets...)
  }

  /** switch ce.card with the one it is dropped on. (not Ripple!) */
  onDropped(ce: CardEvent): void {
    let card1 = ce.cont.getStack(ce.row, ce.col)[1] // if there are now 2 cards in slot
    if (!card1) return
    let { cont, row: row0, col: col0 } = ce.card.origSlot
    cont.addCard(card1, row0, col0) // move card1 to prev/mark Slot
    this.stage.update()
  }
}

export class Player extends EventDispatcher {
  readonly Aname: string;

  name: string;
  color: string;     // Nominal Color: "RED" "BLUE"
  rgbColor: string;  // Actual color, if supplied
  index: number;     // player turn order: the Nth Player
  ownerCard: Flag;   // template Bitmap for showing ownership
  homeCard: Card;
  curCard: Card;     // Card this Player is currently sitting on, see also: this.onCardMarker() { marker.cardUnderMarker()}
  robo: Notifyable;

  plyrDir: CardContainer;
  plyrDist: CardContainer;
  plyrProjs: CardContainer;  // player's Projects (buy done; waiting to build)
  plyrPolis: CardContainer;  // player's enacted Policy cards
  plyrCnts: CardContainer;   // all the Counters: move, draws, polis, buys, builds & coins
  statCont: CardContainer;   // all the StatsCounters: own, AV, EV, VP, debt
  dirCards: CardContainer; // direction cards for Player
  dirDiscard: CardContainer; // discard stack for direction cards
  distArranger: DistArranger;
  distArrangerDone: boolean = false; // set true by distArranger.unload()
  firstDist: boolean = true;
  plyrDebt: DebtContainer;   // loan shark Debt: DebtContainer
  rangeAdjust: number = 0;   // rangeRaw + rangeAdjustTurn + static Effects(S.rangeAdjust)
  rangeAdjustTurn: number = 0;  // transient effects: step/stop/event
  get rangeRaw() { return Math.ceil(this.stats.assets/TP.rangeDivisor) }
  get range() { return this.rangeRaw + this.rangeAdjustTurn } // immediate range

  playerMarker: PlayerMarker;// marker of color on mainMap: location of player

  // Implicit Effects.plyrFields: Counts, Costs, Adjusts, etc.
  /** Effects plyrField to set amount to pay this Owner (non-Stop rent) */
  payOwner: number;          // support non-Stop rent payment ("Taxi" or "Train Station")
  //saveDir: string          // Mall sets this to remember player.direction
  arrivalFrom: string;       // Used by "Airport" to detect takeoff vs landing
  moveHistory: MoveRec[];    // for tracking loops; retry with shorter distance
  isIdle: boolean = true;
  /** start new History */
  newHistory() {
    this.moveHistory = Array<MoveRec>();
    this.distMoved = 0;
    MoveRec.moveRecId = 0;
  }

  stage: Stage              // convenience access: playersCont.stage
  table: Table;
  mainMap: MainMap;

  /** distance left to move: decrement per step. (or when loop/rollback) */
  dist: number;              // set by turning a Distance card, may be updated by Effects: S.dist
  distMoved: number;         // actual steps moved (increments from 0)
  /** {N,E,S,W} from top of plyrDir.getStack() */
  direction: string;         // one or more of: /[NESW]+/ subtype of top of plyrDir.getStack()
  blockedDir: string[] = []; // [N,E,S,W]  set by blockedDirAdjust effects
  dirSpec: DirSpec;          // as determined by nextDirection
  moveDir_: string = 'N';    // current move direction (from Road or chooseDir or ...) or moveTo, transitTo
  get moveDir() { return this.moveDir_ }; set moveDir(dir: string) { this.moveDir_ = dir || this.direction}
  // protect moveDir from building Mall under a player (so: no onStop to set reverseDir)
  drawN: number = 1;         // how many cards to flip per Draw action.
  drawn: number = 0;         // how many cards flipped so far (negative)

  _coins: number = 0;
  _moves: number = 0;
  _draws: number = 0;
  _buys: number = 0;
  _polis: number = 0;
  _builds: number= 0;
  get coins() { return this._coins }; set coins(n: number) { this._coins = n; this.dispatch(S.coins, n) }
  get moves() { return this._moves }; set moves(n: number) { this._moves = n; this.dispatch(S.moves, n) }
  get draws() { return this._draws }; set draws(n: number) { this._draws = n; this.dispatch(S.draws, n) }
  get buys()  { return this._buys  }; set  buys(n: number) { this._buys  = n; this.dispatch(S.buys,  n) }
  get polis() { return this._polis }; set polis(n: number) { this._polis = n; this.dispatch(S.polis, n) }
  get builds(){ return this._builds}; set builds(n:number) { this._builds= n; this.dispatch(S.builds,n) }
  stats: PlayerStats;
  /** increment when Player has negative coins at end of turn. */
  inDebtFlag: number = 0;

  constructor(table: Table, color: string, dirCards: CardContainer, dirDiscard: CardContainer) {
    super()
    this.dirCards = dirCards;
    this.dirDiscard = dirDiscard;
    this.stats = new PlayerStats(this); // just the slots, not the Counters
    this.table = table;
    this.color = color;
    let ndx = table.allPlayers.length;  // ndx used here only for Player's name:
    this.name = this.Aname = "player"+ndx+"-"+this.color;
    this.rgbColor = color;              // until homeCards is loaded with real rgbColor
    this.mainMap = table.mainMap
    this.ownerCard = this.makeOwnerCard();
  }

  /** dispatch a ValueEvent to this EventDispatcher. */
  dispatch(type: string, value: string|number) { ValueEvent.dispatchValueEvent(this, type, value) }

  isCurPlayer(): boolean {
    return this.table.curPlayer == this
  }
  get gamePlay(): GamePlay { return this.table.gamePlay; }
  get colorn(): string { return this.color; }  // TP.colorScheme[this.PlayerColor]
  allOf<T extends Tile>(claz: Constructor<T>) { return (Tile.allTiles as T[]).filter(t => t instanceof claz && t.player === this); }
  allOnMap<T extends Tile>(claz: Constructor<T>) { return this.allOf(claz).filter(t => t.hex?.isOnMap); }

  isExempt(event: Card, time = stime(this, ".isExempt")): boolean {
    let exempt = (this.rangeRaw < event.step)
    if (exempt) console.log(time, `Player ${this.name} exempt from ${event.name} (${this.rangeRaw}<${event.step})`)
    return exempt
  }
  coinCounter: ValueCounter

  /** Place row of player containers on playerCont, aligned with directions */
  initializePlayer(playersCont: ContainerAt, ndx:number): Player {
    let table = this.table
    let gplay = this.gamePlay
    this.stage = playersCont.stage
    this.index = ndx
    this.name = "player"+ndx+"-"+this.color;

    this.makePlayerMat(playersCont, ndx, this.dirCards.cardSize, table.dotsCards) // coinCounter, phaseCounters
    this.playerMarker = new PlayerMarker(this)
    table.allPlayers.push(this);  // becomes the nth-1 player
    table.allPolicy.push(this.plyrPolis)

    this.plyrProjs.on(S.dropped, gplay.payBuyCost, gplay )[S.Aname] = "payBuyCost" // S.buys: Tile & [Future] Event
    this.plyrProjs.on(S.dragStart, gplay.configBuildCost, gplay)[S.Aname] = "configBuildCost"
    this.plyrPolis.on(S.dropped, gplay.payBuyCost, gplay )[S.Aname] = "payBuyCost" // S.polis: buy and build
    this.plyrDist.on(S.moved, gplay.trySellTile, gplay)
    this.robo = {notify: (src, evn, dwell) => {}, block: (src, evn, dwell) => {}, bonusAry: (c) => []} // Null Notifier

    this.moves = 1
    this.burnDist56() // extract 5 & 6 [assert: table.turnNumber = 0]
    this.moves = 0

    return this;
  }

  makeOwnerCard() {
    // removed from HomeDeck.cards:
    const COLOR = this.color;
    const name = `Owner-${COLOR}-0`, color = this.rgbColor, path = `${name}.png`;
    const ownerCardInfo = { nreps: 0, type: 'Owner', name, cost: 0, color, path } as CardInfo;
    return new Card(ownerCardInfo, 0, this.table);
  }

  /** Place row of player containers on parent, aligned with directions */
  makePlayerMat(playersCont: ContainerAt, nth: number,
    cardSize: WH, dotCards: Stack): Player {
    let color = this.color
    let table = this.table;
    let mar = table.margin;
    let maxwh = Math.max(cardSize.width,cardSize.height)
    let square:WH = {width: maxwh, height: maxwh}
    let backName = "Distance Back"
    let plyrCards = dotCards.findCards((card: Card) => (card.name.indexOf(color) >= 0), true)
    let distBack = new Card(dotCards.findCard(backName, true), 1, table)
    plyrCards.push(distBack) // a copy of Back


    let tileSlots = 1, poliSlots = 1;
    let name = this.name;
    let pdir = name + "-Dir";
    let pdist = name + "-Dist";
    let prjs = name + S.Prjs;  // Projects "-Prjs"
    let pols = name + S.Pols;  // Policies "-Pols"
    let cnts = name + "-Cnts";
    let stats = name + "-Stats"

    let plyrDir = this.plyrDir = table.makeCardCont(playersCont, cardSize,
      { name: pdir, x: 0, xl: 1, y: mar * (nth), yt: 0 - (nth), counter: false, drag: false });
    let plyrDist = this.plyrDist = table.makeCardCont(playersCont, plyrCards as Stack,
      { name: pdist, x: this.plyrDir.leftEdge(mar,2), y: this.plyrDir.topEdge(), slotsX: 2, shuffle: true, backClick: false,
        counter: { xs: 1, color: "lightblue" }, drag: false, markColor:"lightgrey" });
    let distCardCounter = plyrDist.getStack(0,0)[S.cardCounter]
    distCardCounter.x += cardSize.width * .67 // offset for better view
    this.setupPlyrDistDeck(plyrDist, mar, cardSize)

    let plyrProjs = this.plyrProjs = table.makeCardCont(playersCont, square,
      { name: prjs, x: plyrDist.leftEdge(mar), xl: 1, y: plyrDist.y, slotsX: tileSlots, counter: false, dropOnCard: true })
    let plyrPolis = this.plyrPolis = table.makeCardCont(playersCont, square,
      { name: pols, x: plyrProjs.leftEdge(mar), xl: 1, y: plyrDist.y, slotsX: poliSlots, counter: false, dropOnCard: true })
    this.gamePlay.makeBuyCostTargetMark(plyrPolis)
    this.gamePlay.makeBuyCostTargetMark(plyrProjs) // enable pay for temp holding of Policy cards...

    this.homeCard = this.homeCard || table.homeCards.findCard("Home-" + color, true)
    plyrProjs.addCard(this.homeCard, 0, tileSlots - 1)
    // special 'props'; process immediately
    if (this.homeCard.props[S.rgbColor]) {
      this.rgbColor = this.homeCard.props[S.rgbColor]   // Use given rgb color if supplied
      TP.playerRGBcolors.push(this.rgbColor)   // detect when color is a Player.color
    }
    console.log(stime(this, "Player.initPlayer: rgbColor="), this.rgbColor)

    // just a background for ResourceCounters (overlay plyrDist[0]), no Cards:
    let plyrCnts = this.plyrCnts = table.makeCardCont(playersCont, plyrDist.cardSize,
      { name: cnts, x: plyrDist.x, y: plyrDist.y, counter: false , bg: true})
    this.makeResourceCounters(plyrCnts);

    let statCont = this.statCont = table.makeCardCont(playersCont, plyrPolis.cardSize,
      { name: stats, x: plyrPolis.x, y: plyrPolis.y, counter: false, bg: false })
    this.makeStatsCounters(statCont);

    let coinCounter = this.coinCounter = new ValueCounter(this.name+"-coinCounter", 0, C.coinGold, 32) // super size font
    let offs = plyrCnts.slotCenter(0, 0)  // center of slot[row,col] + [offx, offy]
    coinCounter.attachToContainer(plyrCnts, offs, this, S.coins, (e: ValueEvent) => this.coins)
    table.scaleCont.addUnscaled(coinCounter, 5.6 * Card.scale)
    playersCont.setChildIndex(plyrCnts, playersCont.numChildren - 2); // under the overCont, above plyrDist(0,0)
    let sellMove = (ev: MouseEvent) => {
      if (this.moves > 0) {
        this.table.undoEnable("sellMove");
        this.table.addUndoRec(this, S.moves)
        this.moves -= 1;
        this.table.addUndoRec(this, S.coins)
        this.adjustPlayerCoins(1, "sellMove")
        this.table.undoClose("sellMove")
      }
    }
    coinCounter.mouseEnabled = true
    coinCounter.on(S.click, sellMove, this)

    // Operations to maintain Player display. Actual GAMEPLAY listeners are in makePlayer()

    /** stack Direction cards on dirDiscard */
    let moveRippleToDirDiscard = (ce: CardEvent) => {
      ce.cont.moveRipple(ce, (card:Card) => { this.dirDiscard.addCard(card) })
    }
    plyrDir.on(S.moved, moveRippleToDirDiscard, this) // (never a DropTarget)
    let scale1 = (ce:CardEvent) => { ce.card.scaleX = ce.card.scaleY = Card.scale; } // undo shrinkCards

    plyrProjs.on(S.clicked, this.onPlyrProjClicked, this) // check for isDiscardActivated()
    plyrProjs.on(S.moved, plyrProjs.shrinkCards, plyrProjs)[S.Aname] = "shrink"
    plyrProjs.on(S.removed, plyrProjs.shrinkCards, plyrProjs)[S.Aname] = "shrink"
    plyrProjs.on(S.dragStart, scale1, plyrProjs)[S.Aname] = "undoShrink";

    // In this case, the card has never been in play, so no effects can be activated:
    plyrPolis.on(S.moved, (ce: CardEvent) => ce.cont.moveRipple(ce, table.dragToDiscard, "disc"), table )[S.Aname] = "ripple-disc" // replace plyrPolis
    plyrPolis.on(S.dragStart, scale1, plyrPolis)[S.Aname] = "undoShrink";

    plyrDist.on(S.clicked, this.onPlyrDistClicked, this)[S.Aname] = "plyrDistClicked"
    this.setHomeDropListener()
    return this; // makeCardConts(...)
  }

  /** moveMarkerToHomeCard  */
  setHomeDropListener(plyr: Player = this) {
    let hdl = plyr.mainMap.on(S.dropped, (ce: CardEvent) => {
      if (!(plyr.table.curPlayer === plyr && ce.card === plyr.homeCard)) return
      plyr.playerMarker.moveMarkerToCard(ce.card)
      plyr.mainMap.removeEventListener(S.dropped, hdl)
    }, plyr)
    hdl[S.Aname] = "hdl-"+plyr.name
  }

  /** make Resource counters: Move, Draw, Buy, Build */
  makeResourceCounters(cont: CardContainer): ValueCounter[] {
    let player = this;
    let scaleCont = player.table.scaleCont;
    // Move, Draw, Buy, Build
    let counterInfo = [
      {name:S.Polis, type: S.polis, offset: {x:-.6, y:-.6}},
      {name: S.Draw, type: S.draws, offset: {x:+.6, y:-.6}},
      {name: S.Move, type: S.moves, offset: {x:0.7, y:0.0}},
      {name: S.Buy , type: S.buys , offset: {x:-.6, y:+.6}},
      {name:S.Build, type:S.builds, offset: {x:+.6, y:+.6}}
    ];
    function newResourceCounter(info: { name: string, type: string, offset: XY }): ValueCounter {
      let resCounter = new ValueCounter("phaseCounter", 0, C.phaseCounter, 16)
      let offs = cont.slotXY(info.offset.y/2, info.offset.x/2)
      resCounter.attachToContainer(cont, offs, player, info.type);
      resCounter.setLabel(info.name, undefined, 10);
      scaleCont.addUnscaled(resCounter, 5.6 * Card.scale);
      resCounter.name = player.name+"-"+info.name+"-Counter"
      return resCounter
    }
    let rv: ValueCounter[] = Array<ValueCounter>()
    counterInfo.forEach(info => rv[info.name] = newResourceCounter(info));
    /** if Draw makes sense: convert clickOnCounter to clickOnBack of Deck */
    let transferClickToDeck = (counter: ValueCounter, deck: CardContainer) => {
      counter.mouseEnabled = true
      counter.on(S.click, (ev: MouseEvent) => {
        if (player.isMoving()) return  // transferClickToDeck -> no...
        if (!player.isCurPlayer()) return
        if (TP.discardDeferred) {
          // disable auto-draw if plyrProj contains DeferredEvent
          if (!!player.plyrProjs.getStack().find(c => c.type == S.Deferred)) {
            player.plyrProjs.flashMarkAtSlot(0, 0)
            return
          }
        }
        if (TP.maxProjs >= 0) {
          // disable auto-draw if plyrProj is full
          if (player.plyrProjs.getStack().length >= TP.maxProjs) {
            player.plyrProjs.flashMarkAtSlot(0, 0)
            return // ignore shortcut when Deferred is available: player must discard or click on Stack
          }
        }
        if (deck.bottomCardOfStack() === undefined) {        // OR: deck.back.visible??
          deck.flashMarkAtSlot(0, 0)
          return // ignore shortcut when deck/stack is empty
        }
        // Hmm: this dodges the cmClient.netClik(ev) logic!!
        deck.back.bitmap.dispatchEvent(ev.clone())
        ev.stopImmediatePropagation()
        // S.click -> deck.mouseClickOnCC(back) -> S.clicked -> deck.drawOnBackClicked(new CardEvent(S.clicked, deck.back, 0, 0))
      }, player) // S.click -> S.clicked on Back card -> S.flipped
    }
    transferClickToDeck(rv[S.Draw], player.table.tileDeck)    // Draw a Tile
    transferClickToDeck(rv[S.Polis], player.table.policyDeck) // Draw a Policy
    return rv
  }
  makeStatsCounters(statCont: CardContainer) {
    let counters = {}
    const makeStatCounter = (name: string, offset: XY, color: string) => {
      const scaleCont = this.table.scaleCont, disp = this, size = 20;
      const cname = this.name + "-stats:" + name + "-Counter"
      const counter = new ValueCounter(cname, 0, color, size);
      const offs = { x: offset.x, y: offset.y * 2 * Card.scale };
      counter.setLabel(name, undefined, 12);
      counter.attachToContainer(statCont, offs, disp, "stats-" + name);
      if (TP.scaleStatCounter) {
        counter.scaleX = counter.scaleY = 5.6 * Card.scale; // full scaling, on ScaleCont
      } else {
        scaleCont.addUnscaled(counter, 5.6 * Card.scale);   // limited scaling
      }
      counters[name] = counter
      return counter;

    }
    let c0 = (x,y):XY => { let xy = statCont.slotXY(-.5, -.5); xy.x+=x; xy.y+=y; return xy }
    let c1 = (x,y):XY => { let xy = statCont.slotXY(-.5, +.5); xy.x+=x; xy.y+=y; return xy }
    console.log(stime(this, ".makeStatsCounter:"), {slotsXY0: statCont.slotXY(0,0), slotXY1: statCont.slotXY(0,1), slotC: statCont.slotCenter(0,0)})
    makeStatCounter("assets", c0(0,  40), this.rgbColor)  // "stats-assets"
    makeStatCounter("debt",   c0(0, 140), C.debtRust)     // "stats-debt"
    makeStatCounter("range",  c0(0, 340), C.white)        // "stats-range"
    makeStatCounter("own",    c1(0,  40), this.rgbColor)  // "stats-own"
    makeStatCounter("AV",     c1(0, 140), C.coinGold)     // "stats-AV"
    makeStatCounter("EV",     c1(0, 240), C.coinGold)     // "stats-EV"
    makeStatCounter("VP",     c1(0, 340), C.vpWhite)      // "stats-VP"

    let plyr = this, range = (counters["range"] as ValueCounter), ev= (counters["EV"] as ValueCounter)
    range.mouseEnabled = ev.mouseEnabled = true
    range.on(S.click, () => { plyr.mainMap.markLegalPlacements(null, plyr) })
    ev.on(S.click, () => { plyr.table.adjustAllRentsAndStats() }) // user force update!
  }
  // Note: graphics.drawPolyStar(x,y,radius, sides, pointSize, angle) will do a regular polygon

  /** Indicates that this is the curPlayer. */
  putButtonOnPlayer(turnButton: Shape) {
    let plyr = this
    let pt = plyr.plyrDist.slotCenter(0,-0.5)
    plyr.plyrDist.localToLocal(pt.x, pt.y, plyr.plyrDist.overCont, pt) // displace pt
    turnButton.x = pt.x; turnButton.y = pt.y
    plyr.plyrDist.overCont.addChild(turnButton)
  }
  indicateDebtStatus() {
    if ((this.coins < 0) && (this.stats.totalDebt < TP.maxDebtOfPlayer)) {
      // try take unsecured loan to pay bills:
      this.plyrDebt.moveDebt(-this.coins, this, this.table.dft.mainCont)
    }
    this.inDebtFlag = (this.coins < 0) ? (this.inDebtFlag + 1) : 0
    let counter = this.coinCounter, limit = 2
    let color = [C.coinGold, C.demoRed, C.RED][Math.min(this.inDebtFlag, limit)]
    counter.setValue(counter.value, color, counter.fontSize)
    if (this.inDebtFlag >= limit) {
      alert(`Game Over! ${this.name} is bankrupt at end of turn (${this.inDebtFlag} >= ${limit})`)
      this.table.dispatchEvent({ type: "Bankrupt", loser: this })
    }
  }
  ////////////////////     Distance & Direction /////////////////////////

  /** distArranger stuff */
  setupPlyrDistDeck(plyrDist: CardContainer, mar: number, cardSize: WH) {
    const table = this.table, playersCont = plyrDist.parent as ContainerAt
    const mainMap = table.mainMap, x0 = mainMap.leftEdge(-mar, 0);

    let distArranger = this.distArranger = table.makeCardCont(playersCont, cardSize,
      {
        clazz: DistArranger,
        name: this.name + "-distArrange", x: x0, y: plyrDist.y, slotsX: 7, counter: false });
    distArranger.useDropCache = false;
    distArranger.player = this

    playersCont.removeChild(distArranger);   // hide and considered to be unloaded (but not done)

    // w: weight, a: args, c: cummulative
    let choices: { w: number, a: string[], c: number }[] = [
      // advance extra cards, for easier manual selection
      { w: 15, a: Array("-4", "-3", "-2", "-3"), c: 0 },
      { w: 15, a: Array("-4", "-3", "-3", "-2"), c: 0 },
      { w: 25, a: Array("-4", "-2", "-3", "-3"), c: 0 },
      { w: 35, a: Array("-4", "-2", "-2", "-3"), c: 0 },
      { w: 10, a: Array("-3", "-2", "-4", "-3"), c: 0 },
      { w: 10, a: Array("-3", "-4", "-2", "-3"), c: 0 },
      { w: 10, a: Array("-2", "-3", "-4", "-3"), c: 0 },
      { w: 35, a: Array("-2", "-4", "-3", "-3"), c: 0 },
    ]
    choices.forEach((v, ndx, c) => v.c += v.w + ((ndx > 0) ? c[ndx - 1].c : 0))
    let kk = Math.floor(Math.random() * choices[choices.length - 1].c)

    // select 4 top cards (leaving -1, -1, -2 somewhere on bottom)
    // Pick some args and call selectTop:
    let choice = choices.find((v, ndx, ary) => (v.c > kk))
    let args = choice.a
    this.selectTop(...args)
    console.log(stime(this, ".setupPlyrDistDeck: kk="), kk, "choices:", choices, "\n   plyrDist=", plyrDist.getStack().map(card => card.name))
  }

  /**
   * return array of top 4 dist card names
   *
   * extract last 2 chars of first 4 cards
   */
  distChoice(): string[] {
    return this.plyrDist.getStack(0, 0).slice(0, 4).map(card => card.name.slice(-2))
  }

  /**
   * arrange Dist cards: [top, ...lower cards]
   * @param sufx ["-1", "-2", "-3", "-4"]
   */
  selectTop(...sufx: string[]) {
    let plyrDist = this.plyrDist
    let stack0 = plyrDist.getStack(0, 0)
    // find (and remove) a card matching each given suffix:
    let cards: Card[] = sufx.map((suffix: string) => stack0.findCard(card => card.name.endsWith(suffix), false))
    plyrDist.stackCards(stack0.shuffle())  // prefer to permute in place!
    // put the selected cards on top of stack0:
    cards.reverse().forEach(card => plyrDist.addCard(card, 0, 0))  // add them back, at the end
  }

  /** move -5 & -6 from plyrDist(0,0) to plyrDist(0,1) */
  burnDist56(burn: string[] = ["-6", "-5"]) {
    let plyrDist = this.plyrDist
    let stack0 = plyrDist.getStack(0, 0)
    let c56 = stack0.findCards((card: Card) => (card.name.endsWith(burn[0]) || card.name.endsWith(burn[1])), false)
    c56.forEach(c => plyrDist.addCard(c, 0, 1))
  }
  /** shuffle given 'stack' [plyrDist.getStack(0,1)] into: plyrDist.getStack(0,0)
   * first time, move card-6, card-6 to plyrDist.getStack(0,1)
   * else move the bottom 2 cards.
   */
  reshuffleDist(preGame: boolean = this.table.preGame, burn = ["-6", "-5"]) {
    let plyrDist = this.plyrDist
    let stack0 = plyrDist.getStack(0, 0)
    let stack1 = plyrDist.getStack(0, 1)
    plyrDist.stackCards(stack1.shuffle(stack0), 0, 0) // put all the cards onto [0,0]
    if (preGame) {
      //table.showStack(stack, "Player.makeCardCont.reshuffle:")
      this.burnDist56(burn)
      //console.log(stime(this, ".makeCardCont.reshuffle: c56="), c56, "\n names=", stack.map(c=>c.name)   ,"\n   stack=", stack)
    } else {
      plyrDist.addCard(stack0[0], 0, 1) // burn two cards (from bottom of deck)
      plyrDist.addCard(stack0[0], 0, 1)
    }
    //console.log(stime(this, ".makeCardCont.reshuffle: names="), stack.map(c=>c.name)   ,"\n   stack=", stack)
  }

  /** If card.isDiscardActivated() then discardCard() */
  onPlyrProjClicked(ce: CardEvent) {
    if (ce.card.isDiscardActivated(true)) {
      this.table.dragToDiscard(ce.card) // plyrProjClicked on Deferred/Future
    }
  }
  /** Listener: initiate nextDistance then initiate newMove(dist).
   *
   * Note: click is on {cont: plyrDist, row: 0, col: 1}; the last exposed dist card.
   * [col = 0 is hidden]
   *
   * preGame: un/load player.distArranger
   */
  onPlyrDistClicked(ce: CardEvent): void {
    if (this != this.table.curPlayer) return  // can happen pre-game
    if (this.table.preGame) {
      if (this.distArranger.parent) {    // pre-Game DistArranger:
        this.distArranger.unload()       // if arranger is showing, then unload Cards to plyrDist
      } else {
        this.distArranger.load()         // if arranger is NOT showing, then load & show Card from plyrDist
      }
      this.stage.update()
      return
    }
    if (this.moves <= 0) return         // ignore this click

    this.table.undoClose()
    let dist = this.getNextDistance()   // flip card, get distance, possible next Direction(s)
    this.playerMove(dist)
  }
  // tricksie: after seeing Distance, but before moving, we block waiting for selected moveDir
  // when chooseDir resolves:
  // *THEN* we send 'move' to referee, including the drawn DirCard *AND* the chosen moveDir
  // *THEN* we fall through to newMove(dist)
  // May need to change CmProto to separate 'nextDist/Dir' from 'move'
  // see how/when distPromise & dirPromise are set; via user and/or cmclient
  chooseMoveDir(dirs: string, andThen: (dir: string) => void) {
    let cd = this.table.chooseDir
    let plyr = this
    let card = this.onCard()
    let dirSpec = (dirs: string): DirSpec => {
      let spec = { N: "", E: "", S: "", W: "", C: undefined }
      S.dirs.forEach(dir => spec[dir] = dirs.includes(dir) ? 0 : undefined)
      S.dirs.forEach(dir => spec[dir] = this.blockedDir.includes(dir) ? "x" : spec[dir]) // untested
      return spec as DirSpec
    }
    let result = (cd: ChooseDir) => {
      console.log(stime(this, `.chooseMoveDir: result`), { resolved: cd.rv.resolved, value: cd.value, cd })
      cd.visible = false
      cd.stage.update()
      andThen(cd.dir as string)
      //this.moveDir = cd.value as string
    }
    cd.choose(card, plyr, dirSpec(dirs)).then(result, () => {
      alert("ChooseDir failed")
      console.warn(stime(this, ".chooseDir failed:"), cd)
    })
    console.log(stime(this, `.chooseMoveDir: choose`), { resolved: cd.rv.resolved, value: cd.value, cd })
  }
  /** entry point for onPlayerDistClicked, Effects.moveNextDistance & cm_client.eval_move. */
  playerMove(dist: number = this.distPromise.value as number, dirs = this.direction) {
    this.stats.distance(dist)
    if (dirs.length > 1) {
      this.chooseMoveDir(dirs, (dir) => {
        this.moveDir = dir              // set moveDir from chosen directdion
        this.newMove(dist)              // start new move
      })
      return
    }
    this.moveDir = dirs                 // set moveDir from given directdion (plyr.direction)
    this.newMove(dist)                  // start new move
  }

  /** waiting for eval_draw(plyrDir) to fulfill from Referee. */
  dirPromise: EzPromise<string> = new EzPromise<string>().fulfill(S.C) // dummy/invalid direction..

  /** waiting for eval_draw(plyrDist) to fulfill from Referee. */
  distPromise: EzPromise<number>;

  /** flip card from plyrDist(0,0) to plyrDist(0,1) as next distance.
   * maybe shuffle and also flip nextDirection.
   *
   * Do not resolve until both dist & dir are settled!
   *
   * @param name if Card name is supplied (by cmPlayer), pluck that card from stack
   * @param preGame how to shuffle, draw, whether to flip nextDistance...
   * @return this.distPromise<number> fulfilled when local or when referee sends name of card.
   * and any associated nextDirection is also resolved.
   */
  getNextDistance(name?: string, preGame: boolean = this.table.preGame): number {
    //console.log(stime(this, ".plyrDist.clicked: card="), e.card.name, e.row, e.col, e.target.name, e.timeStamp, e)
    this.prepareDistance(preGame) // and maybe nextDirection [dirCard.name preceeds distCard.name]
    let refClient: CmClient = undefined   // this.cmClient.client_id === 0 ? this.cmClient : undefined
    let getAutoCard = (cmClient: CmClient) => {
      cmClient.useAutoCard((autoName: string) => name = autoName) // set name from AutoCard
    }
    this.table.isNetworked(getAutoCard, getAutoCard, (cmc) => (refClient = cmc, true))
    return this.localNextDistance(name, preGame, refClient) // nextDir *THEN* nextDist
  }
  prepareDistance(preGame: boolean) {
    if (!this.plyrDist.bottomCardOfStack(0, 0)) { // dist version of prepareTopCard()
      console.log(stime(this, `.prepareDistance: shuffleDist`))
      this.reshuffleDist(preGame)         // shuffle ensures that flipSpecificCard will find(name)
      this.nextDirection(preGame)         // do not flip Direction during pre-game
    }
  }
  /**
   * flip next (or named) distCard (unless player's *first* draw) and dirCard (unless preGame)
   *
   * @param name if provided, then select Card with name
   * @param preGame controls reshuffle and whether to get nextDirection [bury 5 & 6, no new Direction]
   * @returns distance = card.cost
   */
  localNextDistance(name?: string, preGame: boolean = this.table.preGame, refClient?: CmClient): number {
    let card: Card
    let plyrDist = this.plyrDist
    if (this.firstDist === true && !preGame) {
      this.firstDist = undefined
      card = plyrDist.bottomCardOfStack(0, 1) // was exposed during chooseStartPlayer
      if (!!refClient && !preGame) refClient.setAutoCard(card.name, false) // dist THEN dir on autoCard
      // assert: (!name || name === card.name); firstDist is exposed on plyrDist(0, 1)
      console.log(stime(this, `.localNextDistance: FIRST DIST = ${card.name} should == ${name}`))
      this.nextDirection(preGame) // queue it up; because still have not Ack'd in eval_send.
    } else {
      this.prepareDistance(preGame) // reshuffle plyrDist; maybe nextDirection! [QQQQ: rework to delay nDir?]
      card = (name !== undefined) ? plyrDist.flipCardWithName(name, 0, 0) : plyrDist.bottomCardOfStack(0, 0)
      if (!card) return 0          // pre-game event? cmClient lost sync?
      if (!!refClient && !preGame) refClient.setAutoCard(card.name, false)
      plyrDist.addCard(card, 0, 1) // stack0 -> stack1
      this.listDistNotSeen(plyrDist)
      plyrDist.stage.update()
    }
    return card.costn
  }
  showList(list: any[], cont: CardContainer, name: string, offxy: XY) {
    let line0 = cont.overCont.children.find(c => (c instanceof Text) && c["aname"] == name )
    if (!!line0) cont.overCont.removeChild(line0)
    let line = new Text(list.toString(), F.fontSpec(32), C.BLACK)
    line["aname"] = name
    cont.overCont.addChild(line)
    cont.localToLocal(offxy.x, offxy.y, line.parent, line)
  }
  /** show cards which *might* still be in plyrDist */
  listDistNotSeen(plyrDist: CardContainer) {
    let ns = Array<number>()
    plyrDist.getStack(0,0).forEach(c => ns.push(c.costn))
    ns.push(plyrDist.getStack(0,1)[0].costn)
    ns.push(plyrDist.getStack(0,1)[1].costn)
    ns.sort((a, b) => a-b)
    this.showList(ns, plyrDist, this.name, {x: 10, y: 5})
  }
  listDirNotSeen(dirCards: CardContainer) {
    if (!TP.listUnseenDirCards) return
    let dc = Array<string>()
    dirCards.getStack().forEach(c => dc.push(c.subtype)) // {N,E,S,W}+
    dc.sort()
    this.showList(dc, dirCards, "dirCardsNotSeen", {x: 10, y: 5})
  }

  reshuffleDirCards(stack: Stack) {
    // console.log(stime(this, ".plyrDir.clicked: dirDiscard="), dirDiscard)
    this.dirCards.stackCards(stack.shuffle(this.dirDiscard.getStack()))
  }

  /** select Next Direction, setting Player.direction
   * @return new direction: S.N, S.E, S.S, S.W
   */
  nextDirection(preGame: boolean = false): string {
    if (preGame) return undefined;
    // QQQQ: assert that we don't need to queue nextDir requests on dirPromise...
    let stack = this.dirCards.getStack()
    if (stack.length <= 4) {
      this.reshuffleDirCards(stack)
    }
    let card = this.dirCards.bottomCardOfStack() // from bottom of deck is easier!
    if (this.table.isNetworked((cmClient: CmClient) => {
      if (cmClient.useAutoCard(name => this.setDirByName(name))) return
      console.log(stime(this, `.nextDirection: cmClient useAutoCard fail`))
      alert(`player.nextDirection: useAutoCard fail`)
      return  // breakpoint here?
    }, true, (refClient: CmClient): boolean => {
      console.log(stime(this, `.nextDirection: refClient sets: ${card.name}`))
      return refClient.setAutoCard(card.name, false) // fall through to setDirCard
    })) return '';
    return this.setDirCard(card)
  }
  /** response to eval_draw(dirCards) */
  setDirByName(name: string): boolean {
    // return S.dirs.includes(player.setDirCard(player.dirCards.flipCardWithName(name, 0, 0)))
    let card = this.dirCards.flipCardWithName(name, 0, 0)
    if (!card) {
      alert(`player.nextDirection: setDirByName fail ${name}`)
      console.error (stime(this, '.setDirByName'), ' fail: ${name}, no card found')
      return false
    }
    let dir = this.setDirCard(card);
    return true; // S.dirs.includes(dir)
  }
  /** dirPromise.fulfill(this.direction); maybe hack here with chooseDir? */
  setDirCard(card: Card): string {
    this.plyrDir.addCard(card)    // card to top
    let dir = this.direction = card.subtype // assert: this.direction.match(/[NESW]+/)
    this.listDirNotSeen(this.dirCards)
    this.playerMarker.setMarkerDirection(dir)  // align pointer with new direction
    this.dirPromise.fulfill(dir)
    return dir
  }

  /** @return true IFF card == curCard */
  isOnCard(card: Card): boolean {
    return this.curCard === card
  }

  /** return the Card in same slot as Player. */
  onCard(): Card {
    return this.curCard || this.homeCard; // homeCard before start of game... but prol'y not in a mainMap slot!
  }

  ///////////////////  payStep payStop payRent

  logCoins(val: number, src: string, toWhom?: string, logSrc: string = ".adjustPlayerCoins") {
    let newval = this.coins + val
    let sign = (val < 0 ? ' - ' : ' + '), abv = Math.abs(val)
    let namel = this.color.padEnd(6)
    let transLog = `${namel} ${this.coins}${sign}${abv} = ${newval}`
    if (!!toWhom) transLog += (val < 0 ? " to " : " from ") + toWhom
    console.log(stime(this, `${logSrc} [${src}]`), transLog)
  }
  /** log and pay for damage: this.coins += val;
   * @param val expect: val < 0
   * @param src name for logging (& host of debtCont for vcPlayer)
   * @param toWhom for logging
   */
  payDamage(val: number, src: Card, toWhom?: string) {
    this.logCoins(val, src.name, toWhom, ".payDamage")
    this.coins += val
  }

  /** adjust player.coins, log transaction and update player.stats
   * @param val this.coins += val
   * @param src identify the reason/source of the income ("Debt" or for logging)
   * @param otherParty identify the counter-party of the transaction (for logging)
   */
  adjustPlayerCoins(val: number, src: string, otherParty?: string) {
    if (!val) return   // ignore 0 and undefined and -undefined (and avoid reentrant loop from vcPlayer)
    this.logCoins(val, src, otherParty, ".adjustPlayerCoins")
    this.coins += val
    if (['step', 'stop', 'rent'].includes(src)) {
      // do not report Debt, tax, damage, etc as 'ActualIncome'
      this.stats.addActualIncome(val)       // update Actual Value of income (for this round)
      this.dispatchEvent(new ValueEvent("stats-AV", this.stats.AV)) // update display of AV
    }
    if (src !== "Debt") {
      this.dispatchEvent(new ValueEvent(S.income, val))   // see if Debt wants to spend the coins...
    }
  }
  /** pay income to curPlayer (and card.owner) */
  payStep(step: number, owner: Player) {
    this.adjustPlayerCoins(step, "step", (step < 0 && !!owner) ? owner.name : "fromCity")
    if (step < 0 && !!owner) {
      owner.adjustPlayerCoins(-step, "step", this.name)
    }
  }
  /** this player gains 'stop' coins. */
  payStop(stop: number) {
    this.adjustPlayerCoins(stop, "stop", "wages") // ASSSRT "stop" = "wages" is never <0; "Rent" is the expense.
  }
  /** Player pays indicated rent (payOwner) to card.owner.
   * (discounted if player owns card through VCPlayer)
   * @param owner will recieve the rent payment
   * @param card if owner is VCPlayer, may give subOwner a discount.
   * @param rent number >= 0 (negative rent would be considered "stop/wages")
   */
  payRent(card: Card, rent: number) {
    let owner = card.owner
    if (rent <= 0 || !!card[S.noRent]) return    // nothing for player to payOwner || noRent token
    let otherParty = !!owner ? owner.name : "toCity"
    if (this.table.dft.isVcOwned(card)) {
      otherParty = `${otherParty}(${card.debtCont.owner.name})`
      if (this.isReallyOwner(card)) {
        rent = Math.round(rent * TP.vcOwnerRentRate)
      }
    }
    this.adjustPlayerCoins(-rent, "rent", otherParty) // player.rentOut
    if (!!owner && !owner[S.noRent])
      owner.adjustPlayerCoins(rent, "rent", this.name) // owner.rentIn
  }
  /** return true if this player is direct or indirect owner of card. */
  isReallyOwner(card: Card): boolean {
    return card.owner === this || (!!card.debtCont && card.debtCont.active && card.debtCont.owner === this)
  }

  ////////////////    Move Player on the Map     //////////////////////////

  /** do Step effects of card.
   */
  stepOn(card: Card) {
    let player = this, step = this.gamePlay.adjustedStep(card)
    console.log(stime(this, ".stepOn:"), {player: player.name, card: card.name, dist: this.dist, step}, card)
    let owner = card.owner, bonus = card.getFranchiseBonus()
    if (!!owner && bonus > 0) owner.adjustPlayerCoins(bonus, "bonus", "fromCity")
    player.payStep(step, owner)
    this.gamePlay.effects.doEffectsOnCard(S.onStep, card, player)
    return // moveRec updated if changed card, loc, dist (transit, roads)
  }

  stopOn(card: Card) {
    let player = this, stop = this.gamePlay.adjustedStop(card), rent = this.gamePlay.adjustedRent(card)
    let owner = card.owner  // stopOn
    console.log(stime(this, ".stopOn:"), {player: this.name, card: card.name, owner: owner && owner.name, slot: card.getSlotInfo(), stop, rent: card.rent})
    player.payStop(stop)  // first stop Effect is payStop, as adjusted

    player.payRent(card, rent) // next stop Effect is payRent, per last adjustAllRentsAndStats

    // Then do other effects: which may set additional 'payOwner'
    this.gamePlay.effects.doEffectsOnCard(S.onStop, card, player)   // owner may change
    this.gamePlay.offerBuyTile(card, player)                        // if unowned...
    return       // update moveRec if effects move Player (transit, roads)
  }

  /** move this.playerMarker to card.SlotInfo
   * for step/stop effects that move the player. */
  playerMarkerTo(card:Card) {
    this.playerMarker.moveMarkerToCard(card)
  }

  /** Block other GUI actions while player.isMoving()
   * moveHistory is defined from newMove(dist) until moveDone [dist==0]
   */
  isMoving(): boolean {return !this.isIdle; }

  /** reset playerState, move to startRec (with dist -= 1) */
  moveToRollback(nextCardRec: MoveRec) {
    console.log(stime(this, ".moveToRollback: Rollback! nextRec="), nextCardRec)
    let msg = nextCardRec.card ? "Looping" : "No Card on Map"
    /** find latest MoveRec with start:true */
    let findStartRec = (): MoveRec => {
      let history = this.moveHistory;
      console.log(stime(this, ".findStartMove: history="), [].concat(history))
      while (history.length > 0) {
        let startMov = history.pop()
        if (startMov.start) {
          console.log(stime(this, ".findStartMove: history="), [].concat(history), "startMov=", startMov)
          return startMov
        }
      }
    console.log(stime(this, ".findStartRec: no startRec found!"))
    return undefined
    }

    let startRec = findStartRec() // pop back to start of Move (or Transit...)
    startRec.playerStates.forEach(plyrState => plyrState.player.restorePlayerState(plyrState))
    this.dist = startRec.dist - 1      // start over with smaller distance (try stop before loop)
    // hmm... should we backtrack to state before stepping on the LoopRec? and just stop there?
    // push FullRecs (BeforeRecs) and just declare "Blocked", and refuse to step there?
    // But: that could be mid-Taxi or mid-TransitHub... but that's ok: the Taxi/Hub just has to stop short.
    this.playerMarkerTo(startRec.card) // put playerMarker back to original [card, row, col] and loop with shorter dist.
    console.log(stime(this, ".moveToRollback: rollback: dist="), this.dist, startRec.card.name, this.playerMarker, "message=", msg)
    let sr = this.moveDistInit(this.dist)
    this.moveFromHere(sr)
  }
  restorePlayerState(plyrState: PlayerState) {
    let { player, coins, buys, builds, moves, polis, draws, moveDir: dir, stats, rangeAdjustTurn } = plyrState
    player.coins = coins
    player.buys = buys
    player.builds = builds
    player.moves = moves
    player.polis = polis
    player.draws = draws
    player.moveDir = dir
    player.stats = stats
    player.rangeAdjustTurn = rangeAdjustTurn
  }
  /** all the vitals to reset Player to pre-move status (CardRec + resource slots) */
  recordPlayerState(): PlayerState {
    return {
      player: this, moveDir: this.moveDir, coins: this.coins, buys: this.buys,
      builds: this.builds, polis: this.polis, moves: this.moves, draws: this.draws,
      stats: Obj.fromEntriesOf(this.stats), rangeAdjustTurn: this.rangeAdjustTurn
    } as PlayerState
  }
  allPlayerStates(): PlayerState[] {
    return this.table.allPlayers.map((plyr) => plyr.recordPlayerState())
  }
  /** do onMove effects, newHistory(), moveDistInit()
   * invoked from: DistClicked, or moveNextDistance effect
   * actual 'dist' may be modified by: adjustDist, onMove: {dist: {set: ...}}
   * @param dist distance for this new Move: plyrDistClicked([1..6]) OR goTo(0)
   */
  newMove(dist: number) {
    let distAdj = this.gamePlay.adjustedDist(this, dist)    // apply distAdjust Policy effects
    this.dist = Math.max(1, distAdj)                          // Policy effects cannot reduce below 1.
    // do "onMove" effects!! (like: dist=1 or direction="...")
    // Note: onMove must NOT modify other than what is restored by MoveRec(start)
    // Note: "onMove" is leaving after "onStop", NOT "onStep"
    this.gamePlay.effects.doEffectsOnCard(S.onMove, this.onCard(), this) // onMove: {dist: {add: 1}} ...
    if (this.dist <= 0 || this.moveDir === undefined) {
      console.log(stime(this, ".moveDistInit: Blocked at source: startRec="), this.initialStartRec(this.dist))
      // continue: to set moveHistory and distMoved
    }
    this.moves -= 1;                // charge the move, if dist>0; altho may be blocked by DIR?
    this.initMoveHistory(this.dist)
  }

  /** similar to newMove, but no distAdjust, no onMove effects.
   * @param dist set this player.dist
   * @param moveFromHere? default true: invoke this.moveFromHere(startRec)
   */
  initMoveHistory(dist: number, moveFromHere: boolean = true) {
    this.newHistory();           // distMoved = 0, moveRecId = 0
    this.isIdle = false          // signals: player.isMoving()
    this.table.undoDisable()     // move & move Effects are not undoable
    this.dist = dist
    let startRec = this.moveDistInit(this.dist)
    if (!moveFromHere) return   // just create startRec & history for Effects.goTo
    console.groupCollapsed('moving')
    this.moveFromHere(startRec)
  }

  /** Start Moving this Player: this.distance "steps" in this.direction
   * internal move; does not decrement this.moves, possibly reentrant!
   *
   * Invoked from newMove() OR moveToRollBack()
   * @param dist max number of steps; may Move < dist, if blocked or looping
   */
  moveDistInit(dist: number): MoveRec {
    let startRec = this.initialStartRec(dist)
    this.pushMoveRec(startRec, "moveDistInit") // startRec at history[0]
    this.distMoved = this.moveHistory.length - 1 // generally = 0; unless we use nextStartRec()
    return startRec
  }

  /** Create a MoveRec. With start:true to mark where Move action began.
   * @param dist how far this MoveRec can move
   */
  initialStartRec(dist: number): MoveRec {
    // Save pre-move state: (for rollback-retry; only necessary on 'start' records)
    // record {row, col} in case of stop Effect that removes a card, and still Moved?? (not likely)
    // all the vitals to reset Player to pre-move status (CardRec + resource slots)
    let { row, col } = this.playerMarker.slotInfo
    let card = this.mainMap.bottomCardOfStack(row, col) || this.onCard() // card may be missing (demolish?)
    let plyrStates: PlayerState[] = this.allPlayerStates()
    let moveRec: MoveRec = new MoveRec({
      name: card.name, row: row, col: col, dir: this.moveDir, dist: dist,
      start: true, playerStates: plyrStates, fromTransit: undefined, done: false, card: card,
    });
    return moveRec
  }
  /** convert nextRec into a startRec
   * @param nextRec save state at this point, block rollback.
   */
  nextStartRec(nextRec: MoveRec): MoveRec {
    nextRec.playerStates = this.allPlayerStates()
    nextRec.start = true
    return nextRec
  }
  /**
   * push moveRec onto this.moveHistory;
   * @param moveRec from moveDistInit or continueMove
   * @param note for the log
   */
  pushMoveRec(moveRec: MoveRec, note: string = ""): MoveRec {
    //if (!this.moveHistory) this.newHistory(); // redundant
    this.moveHistory.push(moveRec)            // moveHistory[0] is original state, start of "Move"
    this.distMoved += 1    // ASSERT this.distMoved == this.moveHistory.length - 1
    console.log(stime(this, ".pushMoveRec:"), note, {dist: moveRec.dist, name: moveRec.card.name, dir: moveRec.dir, row: moveRec.row, col: moveRec.col}, "history:", [].concat(this.moveHistory), "coins:", this.coins, "debt:", this.plyrDebt.getDebt())
    return moveRec
  }

  /** if a looping MoveRec is found, return it for rollback; else return undefined */
  isLoopLoc(nextRec:MoveRec):MoveRec {
    let history = this.moveHistory;
    let {row, col, dist, dir, card, fromTransit:trans} = nextRec
    if (history.length <= 1) return undefined // all we have is the startRec
    for (let i = history.length-1; i >= 0; --i) {
      let {row:orow, col:ocol, dist:odist, dir:odir, fromTransit:otrans} = history[i]
      if ((row == orow) && (col == ocol) && (dir == odir) && (dist >= odist) && (trans == otrans) ) {
        console.log(stime(this, "Player.isLoopLoc: nextRec="), nextRec, ` history[${i}]=`, history[i], [].concat(history))
        return history[i]
      }
    }
    return undefined
  }
  /** retrieve latest MoveRec (esp: as pushed by NextDistance) */
  getLastMoveRec(curRec?: MoveRec): MoveRec {
    let newRec = this.moveHistory[this.moveHistory.length-1]
    if (!!curRec && (newRec != curRec)) {
      console.log(stime(this, ".getLastMoveRec: useful! "), {curRec: curRec, newRec: newRec})
      alert("getLastMoveRec: check failed")
    }
    return newRec
  }
  /** Indicate that this MoveRec is obsolete.
   * Effect may start another newMove(startRec) OR stop movement
   * Note: setMoveRecDone *before* pushing a new MoveRec.
   */
  setMoveRecDone(): MoveRec {
    let lmr = this.getLastMoveRec()
    if (!!lmr) lmr.done = true;
    return lmr
  }
  /** if dist > 0: findNextRec and move to it: moveToLoc(findNextLoc(curMoveRec))
   * @param curMoveRec loc moving from; curMoveRec.dist > 0
   */
  moveFromHere(curMoveRec: MoveRec) {
    if (curMoveRec.dist > 0) {
      console.log(stime(this, ".moveFromHere:            "), { dist: curMoveRec.dist, name: curMoveRec.name, dir: curMoveRec.dir, rec: curMoveRec })
      let nextMoveRec = this.mainMap.findNextCard(curMoveRec)  // moveFromHere returns 'partial' MoveRec, with (dist -= 1)
      this.moveToLoc(nextMoveRec);
      return
    }
    this.moveStopped()
  }

  /** Prepare to move to nextMoveRec: showMarkAtLoc, wait and then continueMove.
   * @param nextMoveRec result of findNextLoc, transit, or goTo: next Tile/slot to step on
   */
  moveToLoc(nextMoveRec: MoveRec, dwell = TP.moveDwell) {
    let { row, col, dist, dir } = nextMoveRec;
    this.mainMap.showMarkAtSlot(row, col)
    // a promise so one can fulfill it early ()
    let movePromise = F.timedPromise<MoveRec>(dwell, nextMoveRec)
    movePromise.then((rec) => { this.continueMove(rec) })
    return;
  }
  /** Arrive at [row,col]; if (dist>0) then recurse and moveFromHere(newRec)
   * @param nextRec result of findNextLoc; proposed next step (subject to loop/rollback)
   */
  continueMove(nextRec: MoveRec) {
    // assert 'this' == nextRec.player
    this.mainMap.hideMark('continueMove')
    // the "No Card" condition was only relevant in early testing; never happens now (homeCardDropped)
    if (!nextRec.card || this.isLoopLoc(nextRec)) {
      this.moveToRollback(nextRec) // post new Promise->continueMove
      nextRec.done = true          // pro forma
      return // now pop the call stack; wishing we could have thrown...
    }

    // player stepped to a Card, do effects:

    let card = nextRec.card
    this.curCard = card          // record current Card for player.onCard()
    this.dist = nextRec.dist     // decremented by findNextLoc()
    this.moveDir = nextRec.dir
    this.playerMarkerTo(card)  // playerMarker is used by pushMoveRec!!
    let newRec = this.pushMoveRec(nextRec, "continueMove") // we have arrived!

    this.stepOn(card)           // Effects may change this.dist, or initiate new moveRec
    if (newRec.done) return;    // Effect canceled newRec, has initiated a move with a newRec

    if (this.dist <= 0) {
      this.stopOn(card)        // which may set this.dist! (Train/Bus/Lake/Road: can't stop here)
      if (newRec.done) return; // Effect has initiated a move: (onStop (transitTo ... "Train Station"))
    }

    this.stage.update()

    newRec.dist = this.dist;
    newRec.dir = this.moveDir;
    // even if newRec ~= nextRec, newRec is not a "start", it is *after* step/stop.
    this.moveFromHere(newRec) // find next step and try move to it.
  }
  moveStopped() {
    console.groupEnd()       // "moving"
    this.stats.moveDist(this.moveHistory.length-1)    // TBD... Taxi?
    console.log(stime(this, ".moveStopped: history="), [].concat(this.moveHistory), {db: Array.from(this.table.effects.dataRecs)}, "coins:", this.coins, "debt:", this.plyrDebt.getDebt())
    this.isIdle = true; // enable: click-to-buy, click-to-move, click-to-draw
    this.mainMap.markLegalPlacements(undefined, this) // moveStopped
    this.robo.notify(this.table, S.actionEnable) // moveStopped => S.actionEnable
  }

  /** Teleport (without moves or effects) from curCard to nextLoc in direction  */
  teleport(dir: string) {
    let card = this.onCard()
    let {row, col} = card.slotInfo, dist = 0
    let curLoc: MoveRec = {row, col, dir, card, dist}
    let newLoc = this.mainMap.findNextCard(curLoc)
    let {card: ncard, row: nrow, col: ncol} = newLoc
    this.curCard = ncard
    this.playerMarkerTo(ncard)
    console.log(stime(this, ".teleport"), `from ${card.name}[${row}, ${col}] to ${ncard.name}[${nrow}, ${ncol}]`)
  }
}

/** the Marker showing Players current location and direction. */
class PlayerMarker extends Container implements HasSlotInfo {
  dirMark: Shape     // moveDir (the big arrow)
  plyrMark: Shape    // Circle of player.color
  openDirs: Shape[]  // for each of NESW in player.direction

  slotInfo: SlotInfo;
  origSlot: SlotInfo;
  direction: string = "N";
  player: Player;  // player.direction, player.index, player.plyrDir, player.mainMap
  dirTris: Shape[];
  constructor(player: Player) {
    super()
    this.scaleX = this.scaleY = 2 * Card.scale;
    this.name = "Player"+player.index+"Marker"
    let dirMark = this.dirMark = new Shape()
    let short=20, long=-90, c=10 // pointing "N", short is half the southern baseline.
    dirMark.graphics.setStrokeStyle(5, 'round', 'round').beginStroke(C.white).beginFill(player.rgbColor);
    dirMark.graphics.moveTo(0, c).lineTo(-short, c).lineTo(0, long).lineTo(short, c).lineTo(0, c);
    dirMark.name = "Player"+player.index+"dirMark"
    this.addChild(dirMark)
    let plyrMark = this.plyrMark = new Shape(), rad = short * 2
    plyrMark.graphics.beginFill(C.white).drawCircle(0, 0, rad+5)
    plyrMark.graphics.beginFill(player.rgbColor).drawCircle(0, 0, rad)
    this.addChild(plyrMark)
    this.dirTris = []
    S.dirs.forEach((dir) => {
      let dirTri = new Shape(); dirTri["dir"] = dir;
      this.dirTris.push(dirTri)
      dirTri.graphics.beginFill(C.white);
      dirTri.graphics.moveTo(c, short - rad).lineTo(-c, short - rad).lineTo(0, -rad).lineTo(c, short - rad);
      dirTri.rotation = S.dirRot[dir]
      dirTri.visible = true;   // initially
      this.addChild(dirTri)
    })

    this.attachToPlayer(player)
  }
  setSlotInfo(info: SlotInfo): SlotInfo { return this.slotInfo = this.origSlot = info; } // HasSlotInfo

  attachToPlayer(player: Player) {
    this.player = player;
    let mainMap = player.mainMap

    mainMap.overCont.addChild(this)
    this.moveMarkerToCard(player.homeCard)
  }

  // Propose to changs: Marker is Container with 6 children
  // a Circle of player.color, overlaying long marker which shows *moveDir*
  // overlaid by [4] short WHITE/BLACK pointers indicating available dirSpec-blockedDirs
  /** convert string [NESW] to degres of rotation. */
  setMarkerDirection(direction: string) {
    if (!direction) return          // during startup
    let dirs = direction
    this.dirTris.forEach(dirTri => {
      dirTri.visible = dirs.includes(dirTri["dir"])
    })
    this.dirMark.rotation = S.dirRot[this.player.moveDir || S.N]
    this.parent.setChildIndex(this, this.parent.numChildren -1)
    this.stage.update()
  }

  /** where on Card to show PlayerMarker for nth Player*/
  playerMarkerOffset(ndx:number):XY {
    let offs = [
      { x: -1.1, y: -.9 },
      { x: 1.1, y: .8 },
      { x: 0.9, y: -.8 },
      { x: -.9, y: .9 },
      { x: -.8, y: .2 },
      { x: 1.2, y: -.2 }
    ]
    let sx = 45, sy = 70
    return {x: sx*offs[ndx].x, y: sy*offs[ndx].y}
  }
  /** put marker on the [row,col] of Card */
  moveMarkerToCard(card: Card) {
    let { cont, row, col } = card.getSlotInfo()
    let poff = this.playerMarkerOffset(this.player.index)
    cont.moveAndSetSlotInfo(this, row, col, poff.x * this.scaleX, poff.y * this.scaleY) // PlayerMarker
    cont.overCont.addChild(this) // reparent from cont to cont.overCont (above others & on top)
    this.setMarkerDirection(this.player.direction) // show .moveDir || .direction ?
    this.stage.update()
  }

};
