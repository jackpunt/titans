import { S } from "./basic-intfs";

export const playerColorsA = ['RED', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE', 'YELLOW'] as const // Player Colors!
export type PlayerColor = typeof playerColorsA[number];

/** PlayerColerRecord<T> maps from PlayerColor -> T */
export type PlayerColorRecord<T> = Record<PlayerColor, T>
// create map from PlayerColor --> T
export function playerColorRecord<T>(...c: T[]): PlayerColorRecord<T> {
  const rv = {} as PlayerColorRecord<T>;
  playerColorsA.map((pc: PlayerColor, n: number) => rv[pc] = c[n])
  return rv;
};
export function playerColorRecordF<T>(f: (sc: PlayerColor) => T) {
  return playerColorRecord(...playerColorsA.map(f));
}

export function buildURL(scheme = 'wss', host = TP.ghost, domain = TP.gdomain, port = TP.gport, path = ''): string {
  return `${scheme}://${host}.${domain}:${port}${path}`
}
export class TP {
  static colorScheme = playerColorRecordF(n => n);
  static useEwTopo = false;
  static cacheTiles = 2;
  static placeAdjacent = true; // placed tile must abut
  static textLogLines = 13;

  static numPlayers = 2;
  static mapRows:number = 7;   /// standard: 6
  static mapCols:number = 12;  /// standard: 15
  static nHexes = TP.mapRows;
  static mHexes = TP.mapCols;

  static auctionSlots:number = 6; /// standard: 7
  static playerColors: string[] = playerColorsA.concat(); // REQUIRED!
  static playerRGBcolors: string[] = []; // filled by Player.initialize()
  static autoEvent: number | true = 2000;

  static nDebtCards: number = 32;
  static maximizeVCDebt: boolean = true;      // try maximize VCDebt vs minimize borrowing...
  static debtLimitOfAssets: number = 1; // worth = sum(cost)+sum(vp)
  static maxDebtOfPlayer: number = 16;
  static turnEndInDebt: number = 0;
  static applyIncomeToDebt: boolean = true;
  static tryPayBankDebt: boolean = true;
  static vcFundBaseBuild: boolean = false; // vcFundActualBuild
  static vcOwnerRentRate: number = .5;     // set to 1 for full rent, 0 for no rent
  static allowHouseOnVC: boolean = false
  static allowDebtWhileMoving: boolean = false;
  static loanRate = .2           // debtService cost
  static bankRate = .1           // debtService cost
  static taxRate: number = .2    // override Card's tax rate
  static maxHousesOnCard = 2;
  static minHouseCost = 2;       // lowest costn of HouseToken

  static plyrPolisCost: number = 2; // extra cost to put Policy on plyrPolis
  static buildWithinRange: boolean = true;
  static buildOnlyAdjacent: boolean = true;
  static buyWhileNegative: boolean = true;  // VC ignores (player.coins<0) when trying to buy; false is reasonable...
  static logNoDataRecsFound: boolean = false;
  // put on top of Tile deck; &mkt=High%20Tech,Airport,Taxi,Park
  static marketTileNames:string[] = []; // 'Plaza', 'Apple', 'County Recorder', 'Transit Hub', 'Bar', 'Court House', 'Bus Stop'
  static nonMarketNames: string[] = [];
  static nonMarketTypes: string[] = [S.Road, S.Govern, S.Event] // Tax Events may be in TileCards

  static roadsInEvents:boolean = true
  static taxesInTiles: boolean = true
  static multiDirCards: boolean = true
  /** exclude whole Extension sets */
  static excludeExt: string[] = ['Policy', 'Event', 'Roads', 'Transit']; // url?ext=Transit,Roads
  static removeCards: string[] = [ 'Future Event', 'Road Repair'] // 'Commercial', 'Plaza', 'Residential', 'Finanical', 'Municipal', 'Government', 'Industrial', 'Transit', 'High Tech'?
  static includeCards: string[] = ['Transit', S.Housing, 'Home'] // 'Industrial', 'Transit', 'High Tech'?
  static topTileNames:string[] = [] // bring to top of Tile stack [Obsolete? see: marketTileNames]
  static topPolicyNames:string[] = [] //'Build for Free', 'Discount Build', 'Build Discount','Labor Shortage', ['Demolition', 'Express Lane', 'Merge Lt R   '] //['Merge Up S   ', 'Merge Up L   ', 'Merge Lt R   ', 'Merge Rt S   ','Merge Rt L   '] //['Boom Times', 'IPO', 'Jackpot' ]
  static recycleTiles: boolean = true // shuffle Tiles from Discard back into tileDeck when empty
  static recyclePolis: boolean = true // shuffle Policies from Discard back into policyDeck when empty
  static debugOnDiscard: boolean = false;    // selfDropOnDiscard => re-execute event

  // timeout: see also 'autoEvent'
  static moveDwell:  number = 600
  static flashDwell: number = 500
  static flipDwell:  number = 200 // chooseStartPlayer dwell between each card flip

  static stableCardNames:{c1, c2, c3, c4, c5, c6} = {c1:'ATM', c2:'Bank', c3:'Brokerage', c4:'Construction', c5:'Warehouse', c6:'Heavy Equipment'}
  static bgColor: string = 'rgba(155, 100, 150, .3)';
  static bgRect = { x: -2400, y: -1000, w: 8000, h: 5000 }
  static houseSize: number = 150;  // WH of 'House' Cards
  static rangeDivisor: number = 7; // suitable for 2 player: range = Worth/rangeDivisor
  static ghost: string = 'game7'   // game-setup.network()
  static gdomain: string = 'thegraid.com'
  static gport: number = 8447
  static networkUrl: string = 'wss://game7.thegraid.com:8447';  // URL to cgserver (wspbserver)
  static networkGroup: string = 'citymap:game1';
  static maxProjs: number = 4;  // maximun cards in plyrProj 'hand'
  static vpToWin: number = 20;
  static roboDrawTile: number = 1.0 // Bias toward draw Tile
  static urbanRenewWhileOccupied: boolean = true; // Effects.doUrbanRenewal will demolish under player tokens
  static noRentStop: boolean = false;   // if true: must stop to remove noRent Flag, exclude isTransit()
  static allowPolicyProjs: boolean = true; // can buy Policy cards into plyrProjs, for later implementation
  static trapNotDropTarget: boolean = true; // warn & alert when D&D to non-DropTarget
  static discardDeferred: boolean = false;  // enforce draw->discardDeferred
  static listUnseenDirCards: boolean = false; // show contents of dirCards
  static newParseEffects: boolean = false;   // alternative DR parser
  static scaleStatCounter: boolean = false;  // false to addUnscaled (partial scale)
  static bonusAmt: number = 1;               // pay owner extra 'franchise' bonus
  static bonusNcards: number = 4;            // if owner has 4 or more of subtype on board
  static stdBonusAry: number[] = [0, 0, 0, 0, TP.bonusAmt] // actual onStep bonus
  static setBonusAry() { TP.stdBonusAry = new Array<number>(TP.bonusNcards+1).fill(0).fill(TP.bonusAmt, TP.bonusNcards)}

  static hexRad = 60;
  static meepleRad = 45;
  static meepleY0 = 15;
}
