import { stime } from '@thegraid/common-lib';
import { Container } from '@thegraid/easeljs-module';
import { C, Obj, S } from './basic-intfs';
import { Card, HouseToken } from './card';
import { CC, CardContainer } from './card-container';
import { CardEvent } from "./card-event";
import { Effects } from './effects';
import { GameSetup } from './game-setup';
import { Hex, HexMap } from './hex';
import { MainMap } from './main-map';
import { Player } from './player';
import { Table } from './table';
import { TP } from './table-params';
import { Tile } from './tile';
import { ValueCounter } from "./value-counter";

export type NamedObject = { name?: string, Aname?: string };

export class NamedContainer extends Container implements NamedObject {
  Aname: string;
  constructor(name: string, cx = 0, cy = 0) {
    super();
    this.Aname = this.name = name;
    this.x = cx; this.y = cy;
  }
}

export class GamePlay {
  table: Table
  mainMap: MainMap;
  hexMap: HexMap<Hex>;

  constructor (table: Table, public gameSetup: GameSetup) {
    this.table = table
  }
  get effects(): Effects { return Effects.effects }

  get curPlayer(): Player { return this.table.curPlayer }
  get turnNumber() { return this.table.turnNumber; }

  get logWriter() { return this.gameSetup.logWriter; }

  logText(line: string, from = '') {
    if (this instanceof GamePlay) this.table.logText(line, from);
  }

  checkRoadRotation(ce: CardEvent) {
    if (!ce.cont.dropToOrigSlot) return
    let card = ce.card;
    let isSymmetric = (card: Card): boolean => {
      let dirs = card[S.roadSpec]
      return dirs[0] == dirs[2] && dirs[1] == dirs[3]
    }
    // Owner (behind VCPlayer) can re-orient card during their turn:
    if (card.type === S.Road && !isSymmetric(card) && this.curPlayer.isReallyOwner(card)) {
      // roadInfo is similar to SlotInfo: with rot but no Stack
      let roadInfo = card["roadInfo"];
      if (!roadInfo) {
        roadInfo = card.origSlot;
        roadInfo["rot"] = card.rotation;
        roadInfo["name0"] = card.name;
        roadInfo["name180"] = card.name.trim() + " -R";
        card["roadInfo"] = roadInfo;
      }
      let rot = 180 - roadInfo.rot;
      //console.log(stime(this, ".checkRoadRotation:"), {card: card.name, rotation: card.rotation, rot: rot)
      card.rotation = rot;
      roadInfo.rot = card.rotation;
      card.name = roadInfo["name" + rot]; // So history logs are readable
      //card["roadInfo"] = { row: ce.row, col: ce.col, cont: ce.card.parent, rot: card.rotation }
    }
  };

  /** S.clicked -> auto dragStartAndDrop (from Market to plyrProjs)
   * @param ce a CardEvent referencing the Card on a Market stack
   */
  clickedOnMarket(ce: CardEvent): boolean {
    let player = this.curPlayer
    if (player.buys <= 0) return false;
    let dragCheck = (ev: CardEvent): boolean => {
      return (player.coins >= ev.card.adjustedCost) // drop in origSlot if cannot afford
    }
    let card = ce.card
    let dest = card.isPolicy() ? player.plyrPolis : player.plyrProjs
    let { cont, row, col } = card.getSlotInfo()   // ASSERT: cont == ce.cont
    cont.dispatchCardEvent(S.dragStart, card, row, col) // pre-run dragStart: configPlayerBuyCost()
    if (!dragCheck(ce)) return false
    dest.dragStartAndDrop(new CardEvent(CC.dropEvent, ce.card, 0, 0, dest)); // S.dropped -> payPlayerBuyCost()
    return true
  }

  /** S.clicked -> auto dragStartAndDrop (from auctionP0 to discardT | plyrProjs) */
  eventFromP0(ce: CardEvent) {
    let player = this.curPlayer, disc = this.table.discardT, prjs = player.plyrProjs;
    if (ce.card.type == "Event") disc.dragStartAndDrop(new CardEvent(CC.dropEvent, ce.card, 0, 0, disc))
    if (ce.card.type == "Deferred") prjs.dragStartAndDrop(new CardEvent(CC.dropEvent, ce.card, 0, 0, prjs))
    if (ce.card.type == "Policy") disc.dragStartAndDrop(new CardEvent(CC.dropEvent, ce.card, 0, 0, disc))
    return
  }

  lastBuyCont: CardContainer;
  /** disable Drag from all tileMkts & auctionP0/TN */
  stopBuy(cause: string = "") {
    console.log(stime(this, ".stopBuy:"), this.curPlayer.name, this.lastBuyCont && this.lastBuyCont.name, cause)
    if (!!this.lastBuyCont) {
      this.lastBuyCont.setDropTargets();
      this.lastBuyCont = undefined
    }
    // this.table.auctionP0.setDropTargets();
    // this.table.auctionTN.setDropTargets();
    // this.table.tileMkts.forEach(mkt => mkt.setDropTargets())
  }
  /** setDropTargets for source Cont: auctionP0 or market (incl auctionTN) */
  enableBuy(ce: CardEvent) {
    this.lastBuyCont = ce.cont
    console.log(stime(this, ".enableBuy:"), this.curPlayer.name, "cont=", ce.cont.name, "card=", ce.card.name)
    if (ce.card.isPolicy()) { // includes TempPolicy
      // consume S.polis rather than S.buys in payCost()
      ce.cont.setDropTargets(this.table.discardT, ...this.table.allPolicy);
      if (TP.allowPolicyProjs) ce.cont.addDropTarget(this.curPlayer.plyrProjs) // srcCont !== AuctionTN
    } else {
      // Tile, Future/Deferred Events
      // if (this.tileMarkets.includes(ce.cont))
      ce.cont.setDropTargets(this.curPlayer.plyrProjs)
    }
  }
  /** set DropTargets = none (ensure: dropToOrigCont) */
  stopDrag() { this.curPlayer.plyrProjs.setDropTargets() }
  /** set DropTargets = discardT */
  stopBuild() { this.curPlayer.plyrProjs.setDropTargets(this.table.discardT) }
  enableBuild() { this.curPlayer.plyrProjs.setDropTargets(this.table.discardT, this.table.mainMap) }
  enableDiscard() {this.table.auctionP0.setDropTargets(this.table.discardT)}

  stopDraw() {
    this.curPlayer
  }

  /** S.dragStart handler for market & auction.
   * For: BuyCost & PolisCost.
   * Adjust coins and resources of curPlayer
   *
   * set ce.card.adjustedCost = actual buy cost (was [S.buys | S.polis] )
   * based on adjustedCost(card) + auctionPrice + polisCostAdjust
   *
   * Ultimately S.dropped will call payPlayerBuyCost()
   * @return actual buy cost
   */
  configBuyCost(ce: CardEvent): number {
    if (this.curPlayer.isMoving()) { // configBuyCost -> stopBuy
      this.stopBuy("configBuyCost: curPlayer.isMoving")   // is moving
      return undefined;
    }
    let plyr = this.curPlayer
    let cost = this.adjustedCost(ce.card) // card.adjustedCost = cost + costAdjust + auctionPrice + polisCostAdjust
    let p0 = (ce.cont == this.table.auctionP0)  // a zero-cost Policy card, no Buy required
    let tag = ce.card.isPolicy() ? S.polis : S.buys

    if (p0 && ce.card.type == S.Event) {  // Event sits on auctionP0 until user discards it:
      this.table.auctionP0.setDropTargets(this.table.discardT) // ?? DragStart should do this...
      return undefined;
    }

    console.log(stime(this, ".configBuyCost: "), {cost, coins: plyr.coins, tag: plyr[tag], of: tag, name: ce.card.name, type: ce.card.type, card: ce.card})

    this.enableBuy(ce)  // incuding p.plyrPolis

    // Conceptually equiv to markLegalPlacements. we could even mark each dstCont/Slot with a cost.
    if (!p0 && ( plyr[tag] <= 0)) {
      this.stopBuy(`configBuyCost: no ${tag} resource`)
      return undefined;
    } else {

    }
    if (ce.card.isPolicy()) {
      // no Coins or Buy required for 0-cost Policy, but incr cost for specificPlayer
      let spc = this.specificPlayerCost(ce.card, cost)
      let policyConts = this.table.allPolicy
      if (TP.allowPolicyProjs) policyConts = policyConts.concat(plyr.plyrProjs) // presumably uses spc
      policyConts.forEach(policyCont => {
        let ppc = Math.max(0, this.specificPlayer(policyCont) ? spc : cost)
        if (ppc <= plyr.coins) {
          this.setBuyCostTargetMark(policyCont, ppc);
        } else {
          this.setBuyCostTargetMark(policyCont, ppc)
        }
        //policyCont.allowDropOnCard = this._allowDropIfPolicyCost
        plyr.stage.update()
      })
    } else {
      this.setBuyCostTargetMark(plyr.plyrProjs, cost) // cost for Event & Tile
      //plyr.plyrProjs.allowDropOnCard = this._allowDropIfPolicyCost
    }
    ce.cont.showTargetMarks()
    plyr.stage.update()
    return cost
  }
  /**
   *
   * @param ce "allowDropAt" Event (is not a dispatched event)
   */
  _allowDropIfPolicyCost(ce: CardEvent) {
    let cost = ce.card.adjustedCost; //(ce.cont.targetMark as ValueCounter).value as number)
    return (cost <= ce.card.table.curPlayer.coins ) // (targetMark.color == C.coinGold)
  }
  /** increased cost for player-specific Policy */
  specificPlayerCost(card: Card, cost: number): number {
    return card.isPolicy() ? cost + TP.plyrPolisCost : cost
  }
  /** show [Policy] cost for given Container in the TargetMark */
  makeBuyCostTargetMark(policyCont: CardContainer, fontSize = 16) {
    policyCont.makeTargetMark(new ValueCounter("TargetMark", "", C.coinGold, fontSize))
    this.table.scaleCont.addUnscaled(policyCont.targetMark)
  }
  setBuyCostTargetMark(policyCont: CardContainer, cost: number, color?: string) {
    color = color || ((cost <= this.curPlayer.coins) ? C.coinGold : C.legalRed);
    (policyCont.targetMark as ValueCounter).setValue(cost, color);
    policyCont.targetMark.visible = true
  }
  /** on S.dropped remove computed cost: if dropped back to market. */
  clearMktBuyCost(ce: CardEvent) {
    ce.card.adjustedCost = undefined   // card was not bought; no buyCost
    this.stopBuy(`clearBuyCost: ${ce.card.name} dropped on ${ce.cont.name}`) // hideTargetMarks
  }
  /** dragStart when building Gov card from discardP */
  configBuildGov(ce: CardEvent) {
    if (this.curPlayer.isMoving()) { // builtGov -> stopBuy
      this.stopBuy(`configBuildGov: curPlayer.isMoving`)
      return
    }
    ce.card[S.builds] = S.gov    // markLegalPlacements will set stack[S.buildCost] = S.gov
    this.enableBuild()
    this.table.mainMap.markLegalPlacements(ce.card, this.curPlayer)   // always enabled  [discardP(S.gov)]
  }
  /** dragStart handler for Player.plyrProjs
   * operates on curPlayer
   * @param ce identifies card being selected from plyrProjs (or discardP for S.gov)
   * @param isGov S.gov when build Gov card from discardP; else undefined
   * markLegalPlacements sets stack[S.buildCost] = adjustedBuild(card) at stack
   */
  configBuildCost(ce: CardEvent) {
    let plyr = this.curPlayer
    if (plyr.isMoving()) { // configBuildCost -> stopBuild
      this.stopBuild()  // plyr.isMoving
      return
    }
    if (this.specificPlayer(ce.cont) != plyr) {
      this.stopDrag()   // dragStart: curPlayer not allowed to build/discard from otherPlayer's projects!
      return
    }
    if (ce.card.isDiscardActivated(true)) { // ce.card.isFromPrjs(); check if is Event, Deferred, Future
      this.stopBuild()  // Event: Discard to Activate, don't markLegalPlacements on mainMap
      return
    }
    if (ce.card.isPolicy()) {
      this.configBuyCost(ce)      // for Policy on plyrProj
      return
    }
    // if (!ce.type.endsWith("Query"))
      console.log(stime(this, ".configBuildCost:"), {coins: plyr.coins, builds: plyr.builds, card: ce.card.name, ce: ce.type}, ce)
    ce.card[S.builds] = undefined           // NOTE: no S.builds for Policy cards
    if ((plyr.builds <= 0) || this.table.mainMap.markLegalPlacements(ce.card, plyr).length < 1) {
      this.stopBuild()  // builds <= 0: Discard a Project is allowed, but no build on mainMap
      return
    }
    this.enableBuild()
  }

  /**
   * @param cont parent CardContainer of a Policy or Event.
   * @param excludeProj set true to consider only plyrPolis.
   * @return Player that owns cont, OR undefined if a public container
   */
  specificPlayer(cont: CardContainer, excludeProj = false): Player | undefined {
    return this.table.allPlayers.find(p => p.plyrPolis == cont || (excludeProj ? false : (p.plyrProjs == cont)))
  }

  /**
   * .on(S.dropped) for plyrProjs or plyrPolis or table.policySlots
   * Find curPlayer then payAdjustedCost(tag, ce)
   */
  payBuyCost(ce: CardEvent) {
    let plyr = this.curPlayer
    plyr.mainMap.hideLegalMarks()         // clear board when abort building
    this.stopBuy(`payBuyCost: ${ce.card.name} dropped on ${ce.cont.name}`) // hideTargetMarks
    if (ce.cont.dropToOrigSlot) return    // no cost, no pay, nothing to undo
    let tag = ce.card.isPolicy() && this.table.allPolicy.includes(ce.cont) ? S.polis : S.buys
    console.log(stime(this, ".payBuyCost:"), {tag: tag, card: ce.card.name, cont: ce.cont.name})
    this.table.undoEnable("payBuyCost")
    this.payAdjustedCost(tag, ce.card.adjustedCost, ce) // S.buys: includes undoMove, undoCoins, undoTag
    this.table.undoClose("payBuyCost")
    if (ce.card.isPolicy()) /// or maybe for VCDebt?
      this.table.adjustAllRentsAndStats()   // buy Policy; no tileChange until builds Tile
    this.table.curPlayer.robo.notify(this.table, S.dropDone)  // payBuyCost
  }

  placeEither(tile: Tile, toHex: Hex, payCost = true) {
    // TODO: merge code with payBuildCost(CardEvent);
  }

  /**
   * mainMap.on(S.dropped): Build Tile on stack/slot.
   * pay stack[S.buildCost] & adjustAllRentsAndStats(ce.card)
   * target already validated by configBuildCost(); markLegalPlacements()
   */
  payBuildCost(ce: CardEvent) {
    if (this.mainMap.dropToOrigSlot) return
    let card = ce.card
    //console.log(stime(this, ".payBuildCost: ce="), ce, "cont=", CardContainer.getSlotInfo(ce.card).cont)
    let stack = card.getSlotInfo().stack // [S.buildCost] on Stack(row, col)
    let tag = S.builds
    let adjustedCost: number | string = stack[S.buildCost] // as set by MainMap.markLegalPlacements
    if (card[S.builds] == S.gov) {   // remove special build flag
      card[S.builds] = undefined
      console.log(stime(this, ".payBuildCost: placing gov card:"), card.name, ce)
    }
    this.table.undoEnable("payBuildCost")
    // QQQQ: should we payAdjustedCost *before* removing upgrade cards & adjustAllRentsAndStats? (which runs adjustRange)
    if (card instanceof HouseToken) {
      let house = card as HouseToken, tile = stack[0]   // assert S.Housing tile is on bottom.
      let slotInfo = Obj.fromEntriesOf(tile.slotInfo)   // slotInfo of tile holding HouseToken
      this.table.addUndoRec(house, "calcHousingRentVp", () => house.calcHousingRentVp(stack, slotInfo) )
      // do upgradeHousing here... so we can replace the upgraded HouseToken [or Tile]
      card.maybeUpgradeHousing(tile)         // undoRec to move upgraded HouseToken back to tile

    } else if (stack[0] != card) {
      // upgrade from bottomCard to topCard:
      this.table.forEachPlayer(p => p.isOnCard(stack[0]) && (p.curCard = card)) // update p.curCard
      stack[0].moveCardWithUndo(this.table.discardT) // S.moved -> moveToDiscardT -> cleanDiscardedCard & adjustRents
      // Hmm, creates double undoRec ! moveWithUndo & discardWithUndo
    }
    this.payAdjustedCost(tag, adjustedCost, ce) // S.builds; emits addUndoRec();
    card.tob = this.table.turnNumber
    this.table.adjustAllRentsAndStats(ce.card)
    this.table.undoClose("payBuildCost")
    this.mainMap.hideLegalMarks()
    this.table.curPlayer.robo.notify(this.table, S.dropDone)  // payBuildCost
  }

  /**
   * Finalize Drop: Pay card.adjustedCost and Activate Effects of Card.
   * remove any until{Tag} effects (untilBuys, untilBuilds)
   *
   * Note: self-drop will NOT have set card.adjustedCost, so nothing happens here.
   * Note: caller has tested cont.dropToOrigSlot() before calling..
   *
   * @param tag name a Resource Counter on Player: S.polis | S.buys | S.builds
   * @param adjustedCost the final cost (or S.gov)
   * @param cardEvent for Card on mainMap, plyrProjs, or policySlots
   */
  protected payAdjustedCost(tag: string, adjustedCost: number | string, ce: CardEvent) {
    let plyr = this.curPlayer
    let card = ce.card, {cont, row, col} = card.slotInfo

    // Things that change: plyr[tag] count, plyr.coins, untilRecs removed, card.Owner set, card Effects added
    // card already dropped on {cont,row,col} create the undoRec:
    card.moveCardWithUndo(cont, row, col) // undo Buy/Build: [plyrProj,mainMap]->market [no move]

    let cost = adjustedCost as number
    let tagDelta = (card.isDiscardActivated(true) && cost == 0) ?  0 : 1 // no S.buys for $0 Deferred/Event; (and never S.builds)
    if (adjustedCost == S.gov) cost = tagDelta = 0  // placing S.gov card

    // use (ce.cont, false) to charge $2 [even] when dropping on plyrProjs: [consider: tag == S.polis]
    if (this.specificPlayer(ce.cont, true)) cost = this.specificPlayerCost(card, cost)
    // someday maybe alternative to 1? ... 0 or 2 ?
    // (costs 2-builds for large project? "out-of-town site")
    if (cost === undefined) {
      return                                 // ensure ONE-SHOT, can not "re-buy": also abort un-buyable
    }
    let effects = this.effects
    if (tagDelta > 0) {                      // decrement coins and [tag] resource:
      this.table.addUndoRec(plyr, S.coins)
      this.table.addUndoRec(plyr, tag)
      // claim the card, possibly invoke vcPlayer financing:
      card.owner = plyr; // setOwner(plyr); even if public policy, track who started it. (emits its own undoRec)

      // decrement the indicated resource (buys/builds)
      plyr[tag] -= tagDelta                  // even homeCard costs a build, but Player has 1!
      plyr.adjustPlayerCoins(-cost, tag)     // homeCard has cost == 0
      //console.log(stime(this, ".payCost:"), {tag: tag, cost: cost, card: ce.card.name, plyr: this.name})
      // Payent done, now clear any untilBuys/untilBuilds effects:
      let untilKey = (tag == S.builds) ? S.untilBuilds : (tag == S.buys) ? S.untilBuys : "until"+tag // untilPolis?
      let untilRecs = effects.removeUntilRecords(plyr, untilKey) // remove untilBuys/untilBuilds effects
      if (untilRecs.length > 0) {
        this.table.addUndoRec(effects, "replace:" + untilKey + "Records:", () => effects.addRecords(untilRecs));
      }
    }
    // ENABLE/DEPLOY on S.polis "buy", there is no "Build" for policy
    // on Build/Polis: addCardProps and enable Effects
    if (tag === S.builds || (tag === S.polis && ce.cont !== plyr.plyrProjs)) {  // don't activate polis on plyrProjs
      // NOTE: If player1 drops Policy on Player2, Player1 OWNS, Player2 is policyPlayer
      if (tag === S.polis) {
        card.policyPlayer = this.specificPlayer(ce.cont, true) // only checked when card.isPolicy(): Player || undefined
      }
      this.effects.addCardPropsWithUndo(card, tag) // S.builds (Tile) or S.polis (Policy)
    }
    console.log(stime(this, ".payAdjustedCost:"), { tag: tag, name: card.name, cost: cost, coins: plyr.coins, player: plyr, card})
    plyr.stage.update()
  }

  /**
   * Find and apply effects to modify target[effectFieldName].
   * target[effectFieldName]=initVal, then apply effects(withFieldName)(card,plyr)
   *
   * @param card arg to Response.doResponse(card, plyr)
   * @param plyr arg to Response.doResponse(card, plyr)
   * @param target -- the Card || Player whose fieldName will be affected
   * @param effectFieldName: costAdjust, buildAdjust, stepAdjust, stopAdjust, rentAdjust, drawNAdjust
   * @param initVal
   * @return max(0, floor(target[effectFieldName]))
   */
  adjustTargetField(card: Card, plyr: Player, target: Card|Player, effectFieldName: string,  initVal: number, min0: boolean = true): number {
    target[effectFieldName] = initVal
    let adjusters = this.effects.findWithFieldName(effectFieldName, S.onBuild); // from Effects.triggerNames
    adjusters.forEach((resp) => resp.doResponse(card, plyr)); // adjustSomething while plyr on card
    let raw = Math.floor(target[effectFieldName])
    return target[effectFieldName] = min0 ? Math.max(0, raw) : raw;
  }

  adjustedDrawN(player: Player, initVal: number = 1): number {
    return this.adjustTargetField(player.onCard(), player, player, S.drawNAdjust, initVal) // PlyrField
  }
  adjustedDist(player: Player, initVal: number = player.dist): number {
    return this.adjustTargetField(player.onCard(), player, player, S.distAdjust, initVal) // PlyrField
  }
  adjustedRange(player: Player): number {
    let initVal = player.range // == rangeRaw + player.rangeAdjustTurn
    // player.range already accounts for the transient effects, now re-compute static effects:
    let rv = this.adjustTargetField(player.onCard(), player, player, S.rangeAdjust, initVal) // PlyrField
    return rv
  }

  adjustedStep(card: Card, player = this.curPlayer): number {
    return this.adjustTargetField(card, player, card, S.stepAdjust, card.step, false);
  }

  adjustedStop(card: Card, player = this.curPlayer): number {
    return this.adjustTargetField(card, player, card, S.stopAdjust, card.stop);
  }

  adjustedRent(card: Card, player = this.curPlayer): number {
    return this.adjustTargetField(card, player, card, S.rentAdjust, card.rent);
  }

  adjustedBuild(card: Card, player = this.curPlayer): number {
    return this.adjustTargetField(card, player, card, S.buildAdjust, card.costn); // checkLegalSetCost
  }

  /** card.cost + auctionPrice + polisCostAdjust + costAdjust */
  adjustedCost(card: Card, player = this.curPlayer): number {
    let basis = this.auctionPrice(card)
    // adjCost = card.cost + costAdjust [from effects so far]
    // we invented "adjustedCost" to separate from card.costAdjust;
    let adjCost = card.adjustedCost = this.adjustTargetField(card, player, card, S.costAdjust, basis)

    return adjCost
  }

  auctionPrice(card: Card) {
    let { cont, row, col } = card.slotInfo || card.origSlot // typically card is in drag...
    return Math.max(0, card.cost + (cont["colCosts"] ? cont["colCosts"][col] : 0));
  }

  /** when Player is on an onwned Tile, offer opp'ty to buy it. */
  offerBuyTile(card: Card, player: Player) {
    if (!!card && !card.owner && card.type !== S.Govern) {
      let price = card.costn + card.rentAdjust + 2  // card.adjustedCost ??
      console.debug(stime(this, ".offerBuyTile"), {costn: card.costn, rent: card.rentAdjust, price: price})
      let props = { onStop: { whenYesBuyCard: { prompt: `Pay $${price} to buy?` } } }
      this.table.effects.doEffectsOfEvent(card, player, props)
    }
  }

  /** S.dragStart: sellable only if self-owned & vp == 0 */
  maybeSellTile(ce: CardEvent) {
    let card = ce.card
    if (card.owner == this.curPlayer && card.vp == 0) {
      let cont = this.curPlayer.plyrDist
      if (!cont.targetMark) {
        this.makeBuyCostTargetMark(cont, 30)
        cont.targetMark.x = 1.5 * cont.slotSize.width, cont.targetMark.y = .5 * cont.slotSize.height
      }
      this.setBuyCostTargetMark(cont, card.sellPrice, C.coinGold)
      this.mainMap.setDropTargets(this.curPlayer.plyrDist) // S.moved -> gplay.trySellTile
      // arrange for Drop to get credit...
    } else {
      this.mainMap.setDropTargets() // this.mainMap
    }
  }

  /** S.moved: Player wants to sell tile to City (to raise money when nearly bankrupt or whatever) */
  trySellTile(ce: CardEvent) {
    let card = ce.card
    let { cont, row, col } = card.origSlot
    if (cont == this.mainMap && card.owner == this.curPlayer && card.vp == 0) {
      card.table.undoEnable("trySellTile")
      card.table.addUndoRec(this.curPlayer, S.coins)
      card.owner.adjustPlayerCoins(card.sellPrice, 'sell tile')
      card.setOwner(undefined)             // includes addUndoRec(card, "owner") TODO: check for noRent/_reRent !
      this.mainMap.addCard(card, row, col) // put it back!
      card.table.undoClose("trySellTile")
      return
    }
  }
}
