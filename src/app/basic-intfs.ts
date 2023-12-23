export type WH = { width: number, height: number };
export type XY = { x: number, y: number }; // less than a Point

/** Font things */
export namespace F {
  export function fontSpec(size: number = 32, font: string = S.defaultFont) { return `${size}px ${font}` }
  export function timedPromise<T>(ms: number, v?: T): Promise<T> {
    return new Promise((res, rej) => setTimeout(()=>res(v), ms))
  }
}

/** Math things */
export namespace M {
  /**  @return given value rounded to n decimal places. */
  export function decimalRound(value:number, n: number): number {
    let d = 10 ** n
    return Math.round(value*d)/d
  }
}
/** String things */
export namespace S {
  export const C: string = "C"         // Center of ChooseDir buttons
  export const N: string = "N"
  export const E: string = "E"
  export const S: string = "S"
  export const W: string = "W"
  export const dirs: string[] = [N, E, S, W]; // standard direction signifiers (0, 90, 180, 270) ClockWise
  export const dirRot: object = { N: 0, E: 90, S: 180, W: 270 }
  export const dirRev: object = { N: S, S: N, E: W, W: E }
  export const defaultFont: string = "sans-serif"

  export const Prjs: string = "-Prjs"       // player.plyrProj name suffix
  export const Pols: string = "-Pols"       // player.plyrProj name suffix
  export const buys: string = "buys"        // fieldName tag (player resource)
  export const builds:string = "builds"     // fieldName tag (player resource)
  export const polis: string = "polis"      // fieldName tag (player resource)
  export const draws: string = "draws"      // fieldName Player
  export const moves: string = "moves"      // fieldName Player
  export const coins: string = "coins"      // fieldName Player
  export const noRent:string = "noRent"     // fieldName Player, for Jail; fieldName Card, for Black-Flag
  export const reRentDR:string = "reRentDR" // fieldName Card, DR to remove noRent Flag

  export const Housing:string= "Housing"    // Card.name of tile holding HouseToken
  export const Govern: string= "Government" // Card.type
  export const gov:   string = "gov"        // pseudo cost & tag for Card.type = "Government"
  export const Gov:   string = "Gov"        // subtype of Card (for Event: Road Repair, Jail, Corruption)
  export const Tax:   string = "Tax"        // subtype of Card (for Event: Taxes)
  export const buildCost: string = "buildCost" // fieldName on Stack

  export const Draw : string = "Draw"       // Counter name
  export const Move : string = "Move"       // Counter name
  export const Buy  : string = "Buy"        // Counter name
  export const Build: string = "Build"      // Counter name
  export const Polis: string = "Polis"      // Counter name

  export const rgbColor: string = "rgbColor"// card prop

  export const scaled: string = "scaled"    // Event name on ScaledContainer
  export const Aname:  string = "aname"     // anonymous function field name
  export const disc:   string = "disc"      // ripple effect indicator
  export const disc_by:     string = "discarded_by" // Card field name
  export const rentAdjust:  string = "rentAdjust"   // Card field name
  export const buildAdjust: string = "buildAdjust"  // Card field name
  export const buyAdjust:   string = "buyAdjust"    // Card field name
  export const stepAdjust:  string = "stepAdjust"   // Card field name (not used, Nov 2021)
  export const stopAdjust:  string = "stopAdjust"   // Card field name
  export const costAdjust:  string = "costAdjust"   // Card field name

  export const distAdjust:  string = "distAdjust"   // Player field name
  export const rangeAdjust: string = "rangeAdjust"  // Player field name
  export const rangeAdjustTurn: string = "rangeAdjustTurn"  // Player field name
  export const drawNAdjust: string = "drawNAdjust"  // Player field name
  export const polisAdjust: string = "polisAdjust"  // Player field name
  export const polisCostAdjust:string = "polisCostAdjust" // Player field name
  export const blockedDirAdjust:string = "blockedDirAdjust" // Player field name

  export const onTurnStart:  string = "onTurnStart"  // onTrigger for Effects
  export const onGetDist:    string = "onGetDist"    // onTrigger for Effects
  export const onMove:       string = "onMove"       // onTrigger for Effects
  export const onStep:       string = "onStep"       // onTrigger for Effects
  export const onStop:       string = "onStop"       // onTrigger for Effects
  export const onDraw:       string = "onDraw"       // onTrigger for Effects
  export const onBuild:      string = "onBuild"      // onTrigger for Effects
  export const onDiscard:    string = "onDiscard"    // onTrigger for Effects (futureEvent, Deferred, $0 Event)
  export const untilDraws:   string = "untilDraws"   // untilKey for Effects
  export const untilBuys:    string = "untilBuys"    // untilKey for Effects
  export const untilPolis:   string = "untilPolis"   // untilKey for Effects
  export const untilBuilds:  string = "untilBuilds"  // untilKey for Effects
  export const untilTurnEnd: string = "untilTurnEnd" // untilKey for Effects

  export const turn:    string = "turn"       // ValueEvent on Table & Counter name
  export const turnOver:string = "turnOver"   // ValueEvent on Table: endOfTurn (before setNextPlayer)
  export const undo:    string = "undo"       // ValueEvent on Table
  export const income : string = "income"     // ValueEvent on Player

  export const click:   string = "click"      // MouseEvent on Stage
  export const clicked: string = "clicked"    // CardEvent type
  export const flipped: string = "flipped"    // CardEvent type -> Draw
  export const   moved: string = "moved"      // CardEvent type
  export const removed: string = "removed"    // CardEvent type
  export const dropped: string = "dropped"    // CardEvent type
  export const netDrop: string = "netDrop"    // CardEvent type (cmClient interpose on S.droppped)
  export const setOwner:string = "setOwner"   // CardEvent type
  export const dragStart:string= "dragStart"  // CardEvent type
  export const EmptyStack:string="EmptyStack" // CardEvent type
  export const pressmove:string= "pressmove"  // Createjs Event
  export const pressup: string = "pressup"    // Createjs Event

  export const tileChange:string = "tileChange" // CardEvent on mainMap
  export const dist:    string = "dist"      // CardEvent on plyrDist, Player field

  export const actionEnable: string = "actionEnable" // RoboEvent type
  export const drawBlocked:  string = "drawBlocked"  // RoboEvent type
  export const drawDone: string = "drawDone" // RoboEvent type
  export const dropDone: string = "dropDone" // RoboEvent type
  export const chooseDir:string = "chooseDir"// RoboEvent type

  export const DebtType: string = "DebtType" // fieldName on Card/Container
  export const mainMap:  string = "mainMap"  // DebtType
  export const market:   string = "market"   // DebtType
  export const plyrProj: string = "plyrProj" // DebtType
  export const MainDebt: string = "MainDebt" // DebtType
  export const PlyrDebt: string = "PlyrDebt" // DebtType
  export const BankDebt: string = "BankDebt" // DebtType
  export const VCDebt:   string = "VCDebt"   // DebtType

  export const subtype:  string = "subtype"  // Card field/property
  export const High_Tech:string = "High Tech"// Card subtype
  export const Transit:  string = "Transit"  // Card subtype
  export const Home:     string = "Home"     // Card name
  export const house:    string = "house"    // Card type for HousingToken
  export const Road:     string = "Road"     // Card type
  export const roadSpec: string = "roadSpec" // Card field on type Road

  export const arrivalFrom: string = "arrivalFrom" // Card fieldName (for Airport)
  export const fromTransit: string = "fromTransit" // MovRec fieldName (for transitTo/isLoopRec)

  export const Event:       string = "Event"       // Card Type
  export const Policy:      string = "Policy"      // Card Type
  export const Deferred:    string = "Deferred"    // Card Type
  export const Temp_Policy: string = "Temp Policy" // Card Type
  export const Future_Event:string = "Future Event"// Card Type

  export const cardCounter: string = "cardCounter" // Stack field
  export const legalMark:   string = "legalMark"   // Stack field on MainMap

}
/** color strings */
export namespace C {
  /** add alpha value to an "rgb(r,g,b)" string */
  export function rgba(rgb: string, a: number): string { return "rgba" + rgb.substring(3, rgb.length - 1) + ", "+a+")" }
  export const RED:         string = "RED"          // nominal player color
  export const BLUE:        string = "BLUE"         // nominal player color
  export const GREEN:       string = "GREEN"        // nominal player color
  export const ORANGE:      string = "ORANGE"       // nominal player color
  export const PURPLE:      string = "PURPLE"       // nominal player color
  export const YELLOW:      string = "YELLOW"       // nominal player color
  export const BLACK:       string = "BLACK"        // vcPlayer color

  export const black:       string = "black"        // text color
  export const white:       string = "white"
  export const vpWhite:     string = "rgba(255, 255, 255,  1)"
  export const briteGold:   string = "rgba(255, 213,  77,  1)"
  export const coinGold:    string = "rgba(235, 188,   0,  1)"
  export const debtRust:    string = "rgba(225,  92,   0,  1)" // Rust color
  export const legalGreen:  string = "rgba(  0, 100,   0, .3)"
  export const legalRed:    string = "rgba(100,   0,   0, .3)"
  export const demoRed:     string = "rgba(100,   0,   0, .8)"
  export const targetMark:  string = "rgba(190, 250, 190, .8)"
  export const debtMark:    string = "rgba( 50,   0,   0, .3)"
  export const markColor:   string = "rgba( 80,  80,  80, .3)"
  export const scaleBack:   string = "rgba(155, 100, 150, .3)"
  export const policyBack:  string = "rgba(255, 100, 200, .3)"
  export const auctionBack: string = "rgba(180, 230, 180, .3)"
  export const discardBack: string = "rgba(120, 230, 120, .6)"
  export const counterColor:string = "lightblue"
  export const debtCounter: string = "lightgreen"
  export const phaseCounter:string = "lightgreen"
  export const dropTarget:  string = "lightpink"
  export const roundCounter:string = "lightgreen"
  export const turnCounter: string = "lightgreen"
  export const policySlots: string = "rgba(255, 100, 200, .3)";

}

export class Obj {
  /** like Object.fromEntries(...[string, any])
   * @param rv supply empty object (of prototype)
   */
  static fromEntries<T extends object>(ary: [string, any][], rv:T = {} as T): T {
    ary.forEach(([k, v]) => { rv[k] = v }) // QQQQ: is Object.fromEntries() sufficient? is it just <T>?
    return rv
  }
  /** clone: make a shallow copy of obj, using Obj.fromEntries(ary, rv?:T) */
  static fromEntriesOf<T extends object>(obj: T): T {
    return Obj.fromEntries(Object.entries(obj), Object.create(obj) as T)
  }
  /** clone: make a shallow copy of obj, using Object.fromEntries(ary) */
  static objectFromEntries<T extends object>(obj: T): T {
    return Object.fromEntries(Object.entries(obj)) as T // Object.fromEntries now available in TypeScript!
  }
}


