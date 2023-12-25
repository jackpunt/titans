import { afterUpdate, C, CenterText, DragInfo, S, ValueEvent, XY, stime } from "@thegraid/easeljs-lib";
import { Container, DisplayObject, Graphics, MouseEvent, Shape, Text } from "@thegraid/easeljs-module";
import { Androsphinx, AnkhSource, Figure, Guardian, Monument, Temple, Warrior } from "./ankh-figure";
import { AnkhHex, RegionId, StableHex } from "./ankh-map";
import { AnkhToken } from "./ankh-token";
import { NumCounter, NumCounterBox } from "./counters";
import { Anubis, Bastet } from "./god";
import { Player } from "./player";
import { PowerIdent } from "./scenario-parser";
import { CircleShape, RectShape, UtilButton } from "./shapes";
import { Table } from "./table";
import { TP } from "./table-params";


export type CardName = 'Flood' | 'Build' | 'Plague' | 'Chariots' | 'Miracle' | 'Drought' | 'Cycle';
export const cardStates = ['inHand', 'inBattle', 'onTable'] as const;
export type CardState = typeof cardStates[number];

/** children as [button: typeof CircleShape, qmark: typeof CenterText, text: typeof CenterText, token?: AnkhToken] */
export interface PowerLine extends Container {
  ankhToken: AnkhToken;
  button: CircleShape;
  strength: number;
  qmark: Text;
  text: Text;
  docText: UtilButton;
  showDocText: (vis?: boolean) => void
}
interface PowerLineCont extends Container {
  powerLines: PowerLine[];
}

export interface AnkhPowerCont extends PowerLineCont {
  ndx: 0 | 1 | 2;
  ankhs: AnkhToken[];
  guardianSlot: 0 | 1;           // 0 or 1 is designated to provide a Guardian
}

interface ConfirmCont extends Container {
  titleText: Text;
  messageText: Text;
  buttonYes: UtilButton;
  buttonCan: UtilButton;
}

export class CardSelector extends Container implements PowerLineCont {

  constructor(name = 'cs') {
    super()
    this.name = name;
  }

  powerLines: PowerLine[]; // powerLine.children: CircleShape, qMark, Text, maybe AnkhToken
  doneButton: UtilButton;
  bidCounter: BidCounter;
  block: RectShape;        // Teleport: doneButton only; block the card selections.
  // CardSelector children // CircleShape, qMark, Text, docText

  cardsInState(state: keyof typeof PlayerPanel.colorForState) {
    const color = PlayerPanel.colorForState[state];
    return this.powerLines.filter(pl => pl.button.colorn === color);
  }
  activated = false;
  activateCardSelector(activate = true, done = 'Done', panel: PlayerPanel) {
    const bannedCard = panel?.player.gamePlay.gameState.bannedCard;
    const inHand = PlayerPanel.colorForState['inHand'];
    const inBattle = PlayerPanel.colorForState['inBattle'];
    const canAfford = panel ? panel.canAffordMonument : true;
    this.powerLines.forEach(pl => {
      pl.text.color = C.BLACK;
      const button = pl.button, color = button.colorn, powerName = pl.name ;
      button.mouseEnabled = activate && (color === inBattle || color === inHand);
      if (powerName === 'Build' && (color === inHand) && !canAfford) { pl.text.color = 'grey'; }
      if (powerName === bannedCard) { button.mouseEnabled = false; pl.text.color = 'darkred'; }
    });
    this.activated = activate;
    this.showCardSelector(activate, done);
  }

  showCardSelector(vis = true, done = this.doneButton.label_text) {
    const cs = this;
    const asTeleport = (done.endsWith('Teleport'));
    if (asTeleport) {
      cs.visible = true;
      cs.addChildAt(cs.block, cs.children.indexOf(cs.doneButton) - 1);
    } else {
      cs.visible = vis;
      cs.addChildAt(cs.block, 0);
    }
    cs.doneButton.label_text = done;
    cs.powerLines.forEach(pl => pl.showDocText(false));
  }
}

type CardSpec = [name: CardName, text: string, doc: string, strength: number];
type PowerSpec = [name: PowerIdent | CardName, text: string, doc: string];
export class PlayerPanel extends Container {
  canUseTiebreaker = false;

  templeHexesInRegion(regionNdx: number) {
    const region = this.hexMap.regions[regionNdx];
    return region.filter(hex => hex.tile instanceof Temple && hex.tile?.player === this.player);
  }
  figsInRegion(regionId: RegionId) {
    return this.hexMap.regions[regionId - 1].filter(hex => hex.figure).map(hex => hex.figure).filter(fig => fig.controller === this.god);
  }
  /** strength from Figures in Region controlled by this.god */
  figStrengthOfGod(figs: Figure[], god = this.god) {
    // remove strength of Figures with an adjacent Androsphinx of other player:
    const figs2 = figs.filter(fig => !fig.hex.findAdjHex(hex => hex?.meep instanceof Androsphinx && hex.meep.controller !== god))
    return figs2.length;
  }
  isPlayerInRegion(regionId: RegionId, god = this.god) {
    if (!regionId) return false;
    const region = this.hexMap.regions[regionId - 1];
    return !!region.find(hex => hex.figure?.controller === god);
  }
  nRegionsWithFigures(god = this.god) {
    return this.hexMap.regions.filter(region => !!region.find(hex => hex.figure?.controller === god)).length;
  }
  /** Figures in Region controled by player.god */
  figuresInRegion(regionId: RegionId, player = this.player) {
    const region = this.hexMap.regions[regionId - 1];
    const figuresInRegion = region.filter(hex => hex.figure).map(hex => hex.figure);
    return figuresInRegion.filter(fig => fig.controller === player.god);
  }
  hasAnkhPower(power: string) {
    return this.god.ankhPowers.includes(power as PowerIdent);
  }
  get isResplendent() {
    const hasThreeOfMonu = (ndx: number) =>
      this.table.monumentSources[ndx].filterUnits(mont => mont.player === this.player).length >= 3;
    return this.hasAnkhPower('Resplendent') && Monument.typeNames.find((type, ndx) => hasThreeOfMonu(ndx));
  }

  /** at start of Battle */
  nFigsInBattle: number;
  strength = 0;
  reasons: { name: string, total: number, cards?, Chariots?, Temple?, Resplendent?};
  /** BattleResolution phase */
  strengthInRegion(regionId: RegionId) {
    this.reasons = { name: this.name, total: 0 };
    this.strength = 0;
    const addStrength = (val: number, why: string) => {
      this.strength += val;
      this.reasons[why] = val;
      this.reasons.total = this.strength;
    }
    const figsInBattle = this.figsInRegion(regionId);
    this.nFigsInBattle = figsInBattle.length;
    if (this.nFigsInBattle === 0) { addStrength(0, 'noFigures'); return 0; }
    const figStrength = this.figStrengthOfGod(figsInBattle); addStrength(figStrength, 'Figures');
    const cardsInPlay = this.cardsInBattle;
    const namePowerInPlay = cardsInPlay.map(pl => [pl.name, pl.strength ?? 0] as [string, number]);
    namePowerInPlay.forEach(([name, power]) => addStrength(power, name));
    if (Bastet.instance?.isGodOf(this.player)) {
      const bmark = Bastet.instance.bastetMarks.find(bmark => bmark.regionId === regionId);
      if (bmark) {
        addStrength(bmark.strength, `Bastet[${bmark.strength}]`);
        bmark.sendHome();
      }
    }
    if (this.hasAnkhPower('Temple')) {
      const temples = this.templeHexesInRegion(regionId - 1);
      const activeTemples = temples.filter(tmpl => tmpl.findAdjHexByRegion(hex => hex.figure?.player === this.player));
      addStrength(2 * activeTemples.length, `Temple`)
    }
    if (this.isResplendent) addStrength(3, 'Resplendent');
    if (Anubis.instance?.isGodOf(this.player) && this.figuresInRegion(regionId, this.player).includes(this.god.figure)) {
      addStrength(Anubis.instance.occupiedSlots.length, `Anubis`)
    }
    // TODO: add Bastet-Cats
    return this.strength;
  }

  get plagueBid() { return this.cardSelector.bidCounter.getValue() }
  set plagueBid(v: number) { this.cardSelector.bidCounter.setValue(v) }
  enablePlagueBid(region: RegionId): void {
    this.plagueBid = 0;
    this.cardSelector.bidCounter.visible = true;
    this.showCardSelector(true, 'Bid Done');
  }

  canBuildInRegion: RegionId = undefined; // disabled.
  // really: detectBuildDone.
  enableBuild(regionId: RegionId): void {
    this.canBuildInRegion = regionId;
    const panel = this;
    this.table.on('buildDone', (evt: { panel0?: PlayerPanel, monument?: Monument }) => {
      const { panel0, monument } = evt;
      panel0.table.monumentSources.forEach(ms => ms.sourceHexUnit?.setPlayerAndPaint(undefined));
      if (panel0 === panel) {
        panel0.canBuildInRegion = undefined;
        this.player.gamePlay.phaseDone(panel0, monument);
      }
    }, this, true); // trigger only once!
  }
  outline: RectShape;
  ankhSource: AnkhSource<AnkhToken>;
  get god() { return this.player.god; }
  get hexMap() { return this.table.gamePlay.hexMap }

  constructor(
    public table: Table,
    public player: Player,
    row: number,
    col: number,
    public dir = -1
  ) {
    super();
    this.name = this.god.name;   // for debugger
    table.hexMap.mapCont.resaCont.addChild(this);
    table.setToRowCol(this, row, col);
    this.setOutline();
    this.makeConfirmation();
    this.makeAnkhSource();
    this.makeAnkhPowerGUI();
    this.makeFollowers();
    this.cardSelector = this.makeCardSelector();
    this.activateCardSelector();
    this.makeStable();
  }
  static readonly ankhPowers: PowerSpec[][] = [
    [
      ['Commanding', undefined, '+3 Followers when win battle'],
      ['Inspiring', undefined, 'Monument cost is 0'],
      ['Omnipresent', undefined, '+1 Follower per occupied region in Conflict'],
      ['Revered', undefined, '+1 Follower in Gain action']
    ],
    [
      ['Resplendent', undefined, '+3 Strength when 3 of a kind'],
      ['Obelisk', undefined, 'Teleport to Obelisk before battle'],
      ['Temple', undefined, '+2 strength when adjacent to Temple'],
      ['Pyramid', undefined, 'Summon to Pyramid']
    ],
    [
      ['Glorious', undefined, '+3 Devotion when win Battle by 3 strength'],
      ['Magnanimous', undefined, '+2 Devotion when 2 Figures in Battle and lose'],
      ['Bountiful', undefined, '+1 Devotion when gain Devotion in Red'],
      ['Worshipful', undefined, '+1 Devotion when sacrifice 2 after Battle']
    ], // rank 2
  ];
  get metrics() {
    const dydr = this.table.hexMap.xywh.dydr, dir = this.dir;
    const wide = 590, high = dydr * 3.2, brad = TP.ankhRad, gap = 6, rowh = 2 * brad + gap;
    const colWide = 176, ankhColx = [brad + 2 * gap, 0, wide - (brad + 3 * gap)][1 - dir], ankhRowy = 3.85 * rowh;
    const swidth = 210; // reserved for God's special Container
    return {dir, dydr, wide, high, brad, gap, rowh, colWide, ankhColx, ankhRowy, swidth}
  }
  get objects() {
    const player = this.player, index = player.index, panel = this, god = this.god;
    const table  = this.table, gamePlay = this.player.gamePlay;
    return { panel, player, index, god, table, gamePlay }
  }

  setOutline(t1 = 2, bg = this.bg0) {
    const { wide, high, brad, gap } = this.metrics;
    const t2 = t1 * 2 + 1, g = new Graphics().ss(t2);
    this.removeChild(this.outline);
    this.outline = new RectShape({ x: -t1, y: -(brad + gap + t1), w: wide + t2, h: high + t2 }, bg, this.god.color, g);
    this.addChildAt(this.outline, 0);
  }
  bg0 = 'rgba(255,255,255,.3)';
  bg1 = 'rgba(255,255,255,.5)';
  showPlayer(show = (this.player && this.player === this.player.gamePlay.curPlayer)) {
    this.setOutline(show ? 4 : 2, show ? this.bg1 : this.bg0);
  }

  confirmContainer: ConfirmCont;
  makeConfirmation() {
    const { wide, high, brad, gap, rowh } = this.metrics;
    const { table } = this.objects;
    const conf = this.confirmContainer = new Container() as ConfirmCont; conf.name = 'confirm'
    const bg0 = new RectShape({ x: 0, y: - brad - gap, w: wide, h: high }, '', '');
    bg0.paint('rgba(240,240,240,.2)');
    const bg1 = new RectShape({ x: 0, y: 4 * rowh - brad - 2 * gap, w: wide, h: high - 4 * rowh + gap }, '', '');
    bg1.paint('rgba(240,240,240,.8)');

    const title = conf.titleText = new CenterText('Are you sure?', 30);
    title.x = wide / 2;
    title.y = 3.85 * rowh;
    const msgText = conf.messageText = new CenterText('', 30);
    msgText.x = wide / 2;
    msgText.y = 5 * rowh;
    const button1 = conf.buttonYes = new UtilButton('lightgreen', 'Yes', TP.ankhRad);
    const button2 = conf.buttonCan = new UtilButton('rgb(255, 100, 100)', 'Cancel', TP.ankhRad);
    button1.y = button2.y = 6 * rowh;
    button1.x = wide * .4;
    button2.x = wide * .6;
    conf.addChild(bg0, bg1, button1, button2, msgText, title, );
    conf.visible = false;
    table.overlayCont.addChild(conf);
  }

  /** keybinder access to areYouSure */
  clickConfirm(yes = true) {
    // let target = (this.confirmContainer.children[2] as UtilButton);
    if (!this.confirmContainer.visible) return;
    const buttonYes = this.confirmContainer.buttonYes;
    const buttonCan = this.confirmContainer.buttonCan;
    const event = new MouseEvent(S.click, false, true, 0, 0, undefined, -1, true, 0, 0);
    (yes ? buttonYes : buttonCan).dispatchEvent(event);
  }

  areYouSure(msg: string, yes: () => void, cancel?: () => void, afterUpdate: () => void = () => {}) {
    const { panel, table } = this.objects, doneVis = table.doneButton.visible;
    table.doneButton.mouseEnabled = table.doneButton.visible = false;
    const conf = this.confirmContainer;
    const button1 = conf.buttonYes;
    const button2 = conf.buttonCan;
    const msgText = conf.children[4] as CenterText;
    msgText.text = msg;
    const clear = (func: () => void) => {
      conf.visible = false;
      button1.removeAllEventListeners();
      button2.removeAllEventListeners();
      table.doneButton.mouseEnabled = table.doneButton.visible = doneVis;
      button1.updateWait(false, func);
    }
    button2.visible = !!cancel;
    button1.label_text = !!cancel ? 'Yes' : 'Continue';
    conf.titleText.text = !!cancel ? 'Are your sure?' : 'Click to Confirm';

    button1.on(S.click, () => clear(yes), this, true);
    button2.on(S.click, () => clear(cancel ?? yes), this, true);
    console.log(stime(this, `.areYouSure? [${this.player.godName}], ${msg}`));
    panel.localToLocal(0, 0, table.overlayCont, conf);
    conf.visible = true;
    button1.updateWait(false, afterUpdate);
    // setTimeout(cancel, 500);
  }

  highlightStable(show = true) {
    // we want to HIGHLIGHT when 'Summon' action is choosen.
    // if stable is normally faceDown, then we can face them up when activated !?
    const stableFigs = this.stableHexes.map(hex => hex.figure).filter(fig => !!fig);
    const anubisHexes = Anubis.instance?.anubisHexes;
    const anubisFigs = anubisHexes?.map(hex => hex.figure).filter(fig => fig?.player === this.player);
    const summonFigs = stableFigs.concat(anubisFigs ?? []);
    return summonFigs.filter(fig => fig.highlight(show, C.BLACK))
  }

  makeAnkhSource() {
    const table = this.table;
    const index = this.player.index;
    const ankhHex = table.newHex2(0, 0, `AnkSource:${index}`, AnkhHex);
    const { ankhColx, ankhRowy, rowh, gap } = this.metrics;
    this.localToLocal(ankhColx, ankhRowy, ankhHex.cont.parent, ankhHex.cont);
    const ankhSource = this.ankhSource = AnkhToken.makeSource(this.player, ankhHex, AnkhToken, 16);
    ankhSource.counter.x += TP.ankhRad * .6;
    ankhSource.counter.y += TP.ankhRad * .15;
    const bg = new CircleShape('lightgrey', TP.ankhRad + 2, 'white', new Graphics().ss(4));
    this.addChild(bg);
      ankhHex.cont.localToLocal(0, 0, this, bg);
    table.sourceOnHex(ankhSource, ankhHex);
  }

  addAnkhToPowerLine(powerLine: PowerLine) {
    const ankh = this.ankhPowerTokens.shift();
    if (ankh) {
      // mark power as taken:
      ankh.x = 0; ankh.y = 0;
      if (powerLine) {
        powerLine.addChild(ankh);
      } else {
        ankh.sendHome(); // AnkhToken
      }
      powerLine?.stage.update();
    }
    return ankh;
  }

  /**
   * the click handler for AnkhPower buttons; button supplied as data by on.Click(... button)
   */
  selectAnkhPower(evt: Object, button: CircleShape) {
    const rank = this.nextAnkhRank;
    const colCont = this.powerCols[rank - 1];        // aka: button.parent.parent
    this.activateAnkhPowerSelector(colCont, false);  // deactivate

    const powerLine = button.parent as PowerLine;
    const powerName = powerLine.name as PowerIdent;
    const nCoins = this.player.coins, cost = rank;
    const ankhCol = (this.ankhPowerTokens.length % 2 as 0 | 1);

    const ankh = this.addAnkhToPowerLine(powerLine);
    if (!ankh) {
      this.player.gamePlay.logText(`${this.god.name} gets no Ankh Power from Action`)
    } else if (nCoins >= cost) {
      // get God power, if can sacrific followers:
      this.player.gamePlay.gameState.addFollowers(this.player, -cost, `Ankh Power: ${powerName ?? '---'}`);
      if (powerName) this.god.ankhPowers.push(powerName); // 'Commanding', 'Resplendent', etc.
      //console.log(stime(this, `.onClick: ankhPowers =`), this.god.ankhPowers, power, button?.id);
    } else {
      const reason = (nCoins === 0) ? 'no Followers' : `only ${nCoins} Follower${nCoins > 1 ? 's': ''}`;
      this.player.gamePlay.logText(`${this.god.name} gets no Ankh Power ${powerName}; ${reason}`)
      ankh.sendHome(); // AnkhToken
    }
    // Maybe get Guardian:
    if (ankh && colCont.guardianSlot === ankhCol) {
      this.takeGuardianIfAble(colCont.ndx); // will log the aquisition (or not)
    }
    afterUpdate(this, () => this.player.gamePlay.phaseDone(), this.player.gamePlay);
  };
  setAnkhPowers(powers: PowerIdent[]) {
    const panel = this, god = this.god;
    // remove & replace existing AnkhPowers
    god.ankhPowers.length = 0;
    god.ankhPowers.push(...powers);
    panel.ankhPowerTokens.length = 0;
    // for each colCont: remove any AnkhToken & add AnkhToken if applicable
    panel.powerCols.forEach((colCont, cn) => {
      colCont.removeChildType(AnkhToken).forEach(ankhToken => ankhToken.sendHome());
      // leaving only the marker children!
      const ankhs = [panel.ankhSource.takeUnit(), panel.ankhSource.takeUnit(),];
      ankhs.forEach((ankh, cn) => {
        const marker = colCont.children[cn];
        ankh.x = marker.x; ankh.y = marker.y;
      })
      panel.ankhPowerTokens.push(...ankhs); // add 2 ankhs to supply
      colCont.addChild(...ankhs);
      colCont.ankhs = ankhs;
    })
    // find {colCont, powerLine} in panel.powerCols where button.name === powers[i]
    powers.forEach(power => {
      panel.powerCols.find(colCont =>
        colCont.powerLines.find(pl => (pl.button.name === power) && (panel.addAnkhToPowerLine(pl), true))
      );
    })

  }
  takeGuardianIfAble(ndx: 0 | 1 | 2, guard?: Guardian) {
    const guardian = guard ?? this.table.guardSources[ndx].takeUnit();
    let slot = -2;
    if (guardian) {
      guardian.setPlayerAndPaint(this.player);
      this.stage.update();
      const size = guardian.radius;
      slot = this.stableHexes.findIndex((hex, n) => (n > 0) && hex.size === size && !hex.usedBy);
      if (slot >= 0) {
        guardian.moveTo(this.stableHexes[slot]); // StableHex.set meep(meep) --> stableHex.usedBy & meep.homeHex
      }              // else: slot = -1: Stable is full! (no rings of the right size)
    }                // else: slot = -2: no Guardian to be picked/placed.
    this.table.logText(`${this.player.godName} takes ${guardian ? guardian.name : 'no Guardian'} to slot ${slot}`);
    return guardian; // may be undefined
  }

  activateAnkhPowerSelector(colCont?: AnkhPowerCont , activate = true){
    // identify Rank --> colCont
    // in that colCont, mouseEnable Buttons (ie Containers) that do not have AnkhToken child.
    const rank = this.nextAnkhRank
    if (rank > 3) { this.player.gamePlay.gameState.done(); return };
    if (!colCont) colCont = colCont ?? this.powerCols[rank - 1];
    colCont?.powerLines?.forEach(pl => {
      const active = (activate && !pl.ankhToken)
      pl.button.paint(active ? 'lightgrey' : C.WHITE);
      pl.button.mouseEnabled = pl.qmark.visible = active; // enable and show qmark:
    });
    this.stage.update();
  }

  get nextAnkhRank() { return [1, 1, 2, 2, 3, 3, 4][Math.max(0, 6 - this.ankhPowerTokens.length)] as 1 | 2 | 3 | 4 }  // 6,5: 1, 4,3: 2, 0,1: 3
  readonly powerCols: AnkhPowerCont[] = [];
  readonly ankhPowerTokens: AnkhToken[] = [];
  makeAnkhPowerGUI() {
    const { panel, player } = this.objects;
    // select AnkhPower: onClick->selectAnkhPower(info)
    // Ankh Power line: circle + text; Ankhs
    const { brad, gap, ankhRowy, colWide, dir} = this.metrics;
    PlayerPanel.ankhPowers.forEach((powerList, colNdx: 0 | 1 | 2) => {
      const colCont = new Container() as AnkhPowerCont;
      colCont.name = `colCont-${colNdx}`;
      colCont.ndx = colNdx;
      colCont.guardianSlot = (colNdx < 2) ? 1 : 0;
      colCont.x = colNdx * colWide + [2 * brad + 3 * gap, 0, 0][1 - dir];
      panel.addChild(colCont);
      panel.powerCols.push(colCont);

      const ankhs = [this.ankhSource.takeUnit(), this.ankhSource.takeUnit(),];
      this.ankhPowerTokens.push(...ankhs);
      ankhs.forEach((ankh, i) => {
        const mColor = (colCont.guardianSlot === i) ? 'gold' : 'white';
        const marker = new CircleShape('lightgrey', brad + 2, mColor, new Graphics().ss(4));
        marker.name = `place-marker`;
        marker.x = ankh.x = (3 * brad + gap) + i * (2 * brad + 2 * gap);
        marker.y = ankh.y = ankhRowy;
        marker.mouseEnabled = false;
        colCont.addChild(marker, ankh);
      });
      colCont.ankhs = ankhs;
      this.makePowerLines(colCont, powerList, this.selectAnkhPower); // ankhPower element [name: string, docstring: string][]
    });
  }

  makePowerLines(colCont: PowerLineCont, powerList: (CardSpec | PowerSpec)[], onClick) {
    const panel = this;
    const {brad, gap, rowh, dir,} = panel.metrics;
    // place powerLines --> selectAnkhPower:
      colCont.powerLines = []; // Container with children: [button:CircleShape, text: CenterText, token?: AnkhToken]
      powerList.forEach(([powerName, powerText, docString, strength], nth) => {
        const powerLine = new Container() as PowerLine;
        powerLine.name = powerName;
        powerLine.x = brad + gap;
        powerLine.y = nth * rowh;
        colCont.addChild(powerLine);
        colCont.powerLines.push(powerLine);

        const button = new CircleShape(C.white, brad);
        button.name = powerName;
        button.on(S.click, onClick, panel, false, button);
        button.mouseEnabled = false;
        powerLine.addChild(button);
        powerLine.button = button;
        powerLine.strength = strength;
        const qmark = new CenterText('?', brad * 1.4, C.BLACK);
        qmark.visible = qmark.mouseEnabled = false;
        if (!!strength) {
          // show Card power in qmark:
          qmark.text = `+${strength}`;
          qmark.color = C.BLACK;
          qmark.x -= brad / 10;
          qmark.visible = true;
        }
        powerLine.addChild(qmark);
        powerLine.qmark = qmark;

        const text = new CenterText(powerText ?? powerName, brad);
        text.textAlign = 'left';
        text.x = brad + gap;
        powerLine.addChild(text);
        powerLine.text = text;

        const [w, h] = [text.getMeasuredWidth(), text.getMeasuredHeight()];
        const hitArea = new Shape(new Graphics().f(C.black).dr(0, -brad / 2, w, h));
        hitArea.name = 'hitArea';
        hitArea.visible = false;
        text.hitArea = hitArea;

        const doctext = new UtilButton('rgb(240,240,240)', docString, 2 * brad);
        doctext.name = `doctext`;
        doctext.visible = false;
        panel.table.overlayCont.addChild(doctext);
        powerLine.localToLocal(doctext.x, doctext.y, panel.table.overlayCont.parent, doctext);
        powerLine.docText = doctext;
        const showDocText = powerLine.showDocText = (vis = !doctext.visible) => {
          const pt = text.parent.localToLocal(text.x, text.y, doctext.parent, doctext);
          doctext.x -= dir * (60 + doctext.label.getMeasuredWidth() / 2);
          if (!vis) {
            panel.table.overlayCont.children.forEach(child => {
              if (child.name === 'doctext') child.visible = false;
            });
          } else {
            doctext.visible = true;
          }
          doctext.stage.update();
        }
        doctext.on(S.click, () => showDocText() );
        text.on(S.click, () => showDocText());
      });
  }

  makeFollowers(initialCoins = 1) {
    // Followers/Coins counter
    const { panel, player, index } = this.objects;
    const { gap, ankhColx, wide, rowh, dir } = this.metrics;
    const counterCont = panel, cont = panel;
    const layoutCounter = (name: string, color: string, rowy: number, colx = 0, incr: boolean | NumCounter = true,
      claz = NumCounterBox) => {
      //: new (name?: string, iv?: string | number, color?: string, fSize?: number) => NumCounter
      const cname = `${name}Counter`, fSize = TP.hexRad * .75;
      const counter = player[cname] = new claz(`${cname}:${index}`, 0, color, fSize)
      counter.setLabel(`${name}s`, { x: 0, y: fSize/2 }, 12);
      const pt = cont.localToLocal(colx, rowy, counterCont);
      counter.attachToContainer(counterCont, pt);
      counter.clickToInc(incr);
      return counter;
    }
    layoutCounter('coin', C.coinGold, 2 * rowh, ankhColx, true, );
    this.player.coins = initialCoins;
  }

  warriorSource: AnkhSource<Warrior>
  // Stable:
  stableHexes: StableHex[] = [];
  stableCont: Container;
  /** size for each type: Warrior, G1, G2, G3 */
  stableSizes = [TP.ankh1Rad, TP.ankh1Rad, TP.ankh2Rad, TP.ankh2Rad,]
  makeStable() {
    const { wide, gap, rowh, dir, swidth } = this.metrics
    const { panel, player } = this.objects
    const stableCont = this.stableCont = new Container(); stableCont.name = `stableCont:${player.index}`
    const srad1 = TP.ankh1Rad, srad2 = TP.ankh2Rad;
    const swide0 = 4 * (srad1 + srad2); // 2 * sum(this.stableSizes)
    const sgap = (wide - (gap + swidth + gap + gap + swide0 + 0 * gap)) / 3;
    stableCont.y = 5.5 * rowh;
    panel.addChild(stableCont);

    let x0 = [wide, 0][(1 + dir) / 2] + dir * (1 * gap); // edge of next circle
    this.stableSizes.forEach((radi, i) => {
      const x = x0 + dir * radi, y = (srad2 - radi);
      this.makeStableHex({ x, y }, radi);
      x0 += dir * (2 * radi + sgap);
    });
    this.makeSpecial(stableCont.y - srad2, srad2 * 2)
  }

  /** extra rank1 StableHex when merging */
  makeAuxStable() {
    const { wide, gap, brad, dir, rowh } = this.metrics;
    let x0 = [wide, 0][(1 + dir) / 2] + dir * (2 * brad); // edge of next circle
    this.makeStableHex({ x: x0, y: -5.5 * rowh + brad - gap }, TP.ankh1Rad)
  }

  /** draw circle (xy, radi) on this.stableCont, and place next StableHex on it. */
  makeStableHex(xy: XY, radi: number, stableCont = this.stableCont) {
    const { god, player, index, table} = this.objects
    const i = this.stableHexes.length;
      const g0 = new Graphics().ss(2).sd([5, 5]);
      const circle = new CircleShape('', radi - 1, god.color, g0);
      circle.y = xy.y;
      circle.x = xy.x;
      stableCont.addChild(circle);
      const hexC = (i == 0) ? AnkhHex : StableHex;
      const hex = table.newHex2(0, 0, `s:${index}-${i}`, hexC) as StableHex;
      hex.size = radi;
      circle.parent.localToLocal(circle.x, circle.y, hex.cont.parent, hex.cont);
      const source = (i === 0) ? this.warriorSource = Warrior.makeSource(player, hex) : undefined;
      table.sourceOnHex(source, hex);
      this.stableHexes.push(hex);
      return circle;
  }

  // Special:
  makeSpecial(sy: number, shigh: number) {
    const { dir, wide, gap, swidth } = this.metrics;
    const { panel, god, table } = this.objects;
    const specl = new Container(); specl.name = `special:${god.name}`
    specl.y = sy - gap;
    specl.x = [gap, wide - (swidth + gap)][(1 + dir) / 2];
    panel.addChild(specl);
    god.makeSpecial(specl, { width: swidth, height: shigh + 2 * gap }, table, this);
  }

  static readonly cardSpecs: CardSpec[] = [
    ['Flood', 'Flood', '+1 Follower for each Figure in fertile space; they cannot be killed in Battle.', 0],
    ['Build', 'Build Monument', 'Build a monument for 3 Followers', 0],
    ['Plague', 'Plague of Locusts', 'Kill all Figures except of highest bidder', 1],
    ['Chariots','Chariots', '+3 strength in battle resolution', 3],
    ['Miracle', 'Miracle', '+1 devotion for each Figure killed', 0],
    ['Drought','Drought', '+1 devotion per Figure in desert, if you win', 1],
    ['Cycle', 'Cycle of Ma`at', 'Reclaim all Battle Cards after battle resolution', 0],
  ]

  cardSelector: CardSelector;
  makeCardSelector(name = `cs:${this.player.index}`) {
    const cardSelector = new CardSelector(name);
    const { wide, high, dir, brad, gap, rowh } = this.metrics;
    const { panel, table, player, gamePlay } = this.objects;
    const x = 0, y = -(brad + gap), w = wide * .5, h = high, di = (1 - dir) / 2;
    const dxmax = [wide - w, w][di], dxmin = dxmax - wide;

    const cont = table.hexMap.mapCont.eventCont;
    cont.addChild(cardSelector);
    panel.localToLocal((wide - w) * (1 - dir) / 2, 0, cont, cardSelector,);

    const bground = new RectShape({ x, y, w, h }, 'rgba(255,255,255,.8)',)
    cardSelector.block = new RectShape({ x, y, w, h }, 'rgba(240,240,240,.4)',)
    cardSelector.addChild(cardSelector.block, bground);
    const pt0 = cardSelector.localToLocal(0, 0, table.dragger.dragCont);
    const xmin = pt0.x + dxmin, xmax = pt0.x + dxmax, y0 = pt0.y;
    cardSelector.x += [wide, -wide][di] * .25;

    const dragFunc = (cs: CardSelector, info: DragInfo) => {
      cs.x = Math.max(xmin, Math.min(xmax, cs.x));
      cs.y = y0;
    }
    const dropFunc = () => {}
    table.dragger.makeDragable(cardSelector, this, dragFunc, dropFunc);

    // add PowerLines:
    {
      this.makePowerLines(cardSelector, PlayerPanel.cardSpecs, this.selectForBattle);
      const inHand = PlayerPanel.colorForState['inHand'];
      cardSelector.powerLines.forEach(pl => (pl.button.paint(inHand)));
    }
    // add a Done button:
    {
      const color = player.color;
      const doneButton = cardSelector.doneButton = new UtilButton(color, 'Done');
      const tcolor = (C.dist(color, C.WHITE) < C.dist(color, C.black)) ? C.black : C.white;
      doneButton.label.color = tcolor;
      doneButton.label.textAlign = 'right';
      doneButton.label_text = doneButton.label_text;
      cardSelector.addChild(doneButton);
      doneButton.y = 4 * rowh;
      doneButton.x = w - 3 * (gap);
      doneButton.on(S.click, () => {
        const label = doneButton.label_text;
        const after = (label === 'X') ? undefined : () =>  gamePlay.phaseDone(panel);
        if (label.endsWith('Choose')) {
          const nSelected = cardSelector.cardsInState('inBattle').length;
          if (this.cardSelector.activated && nSelected === 0) {
            this.blink(doneButton, 80, true);
            return; // you must select a card
          }
          cardSelector.showCardSelector(false, 'XChoose'); // deactive in 'Reveal'
        } else {
          cardSelector.showCardSelector(false, 'X');       // was never activated...
          cardSelector.bidCounter.visible = false;
        }
        doneButton.updateWait(false, after, gamePlay);
      }, this);
    }
    // add Plague Counter:
    {
      const [x, y] = [w - 2 * (brad + gap), 1 * rowh];
      const counter = cardSelector.bidCounter = new BidCounter(panel, 'bid', 0, 'orange', TP.ankh1Rad);
      counter.x = x; counter.y = y;
      counter.visible = false;
      counter.clickToInc(panel.player.coinCounter);
      cardSelector.addChild(counter);
    }
    return cardSelector;
  }

  get canAffordMonument() { return this.player.coins >= 3 || this.hasAnkhPower('Inspiring') }
  activateCardSelector(label = 'X', selector = this.cardSelector) {
    selector.activateCardSelector(label === 'Choose', label, this);
  }

  showCardSelector(vis = true, done?: string) {
    this.cardSelector.showCardSelector(vis, done);
  }

  static colorForState: { [key in CardState]: string } = { inHand: 'green', inBattle: 'yellow', onTable: 'red' };
  static indexForColor: { [key in string]: number } = {}
  static {
    Object.keys(PlayerPanel.colorForState).forEach((key: CardState, ndx) =>
      PlayerPanel.indexForColor[PlayerPanel.colorForState[key]] = ndx);
  }

  cardsInState(state: keyof typeof PlayerPanel.colorForState) {
    return this.cardSelector.cardsInState(state);
  }

  get cardsInHand() { return this.cardsInState('inHand'); }     // GREEN
  get cardsInBattle() { return this.cardsInState('inBattle'); } // YELLOW
  get cardsOnTable() { return this.cardsInState('onTable'); }   // RED

  get cycleWasPlayed() { return !!this.cardsOnTable.find(pl => pl.name === 'Cycle') }

  revealCards(vis = true): void {
    const inBattle = this.cardsInBattle.map(pl => pl.name);
    if (vis) this.player.gamePlay.table.logText(`${this.god.name}: ${inBattle}`);
    this.cardSelector.activated = false;
    this.showCardSelector(vis, 'Revealed');
    this.stage.update();
  }

  battleCardsToTable(pl?: PowerLine) {
    if (pl) pl.button.paint(PlayerPanel.colorForState['onTable']);
    else this.cardsInBattle.forEach(pl => pl.button.paint(PlayerPanel.colorForState['onTable']));
    this.stage.update();
  }

  hasCardInBattle(cardName: string) {
    return this.cardsInBattle.find(pl => pl.name === cardName);
  }

  allCardsToHand(vis = false) {
    this.cardSelector.powerLines.forEach(pl => pl.button.paint(PlayerPanel.colorForState['inHand']));
  }
  blink(dispObj: DisplayObject, del = 80, vis = dispObj.visible){
    dispObj.visible = !vis;
    this.stage.update();
    setTimeout(() => { dispObj.visible = vis; this.stage.update(); }, del);
  }

  // button.parent is the PowerLine.
  selectForBattle(evt, button: CircleShape) {
    if (!this.cardSelector.activated) {
      this.blink(button);
      return;
    }
    const max = this.god.nCardsAllowedInBattle;

    const inHand = PlayerPanel.colorForState['inHand']
    const inBattle = PlayerPanel.colorForState['inBattle']
    button.paint((button.colorn === inBattle) ? inHand : inBattle);
    if(this.cardsInState('inBattle').length > max) {
      button.paint(inHand);
      this.blink(button);
    }
    button.stage.update();
  }

}
class BidCounter extends NumCounter {
  constructor(public panel: PlayerPanel, name: string, initValue?: string | number, color?: string, fontSize?: number, fontName?: string, textColor?: string) {
    super(name, initValue, color, fontSize, fontName, textColor);
  }

  override incValue(incr: number): void {
    if (this.getValue() + incr < 0) return;
    if (this.panel.player.coins - incr < 0) return;
    this.updateValue(this.getValue() + incr);
    this.dispatchEvent(new ValueEvent('incr', -incr));
  }
}
