import { Params } from '@angular/router';
import { CycleChoice, Dragole, KeyBinder, makeStage, ParamGUI, ParamItem, stime } from '@thegraid/easeljs-lib';
import { Container, Stage } from '@thegraid/easeljs-module';
import { CgMessage, CLOSE_CODE } from '@thegraid/wspbclient';
import { CmType } from '../proto/CmProto';
import { S } from './basic-intfs';
import { Card, Deck, Stack } from './card';
import { CardContainer, CC } from './card-container';
import { CardEvent, ValueEvent } from "./card-event";
import { CardInfo, CardInfo2, CI } from './card-maker';
import { AlignDeck } from './cardinfo/align-deck';
import { BackDeck } from './cardinfo/back-deck';
import { DirDeck } from './cardinfo/dir-deck';
import { DotsDeck } from './cardinfo/dots-deck';
import { EventDeck } from './cardinfo/event-deck';
import { HomeDeck } from './cardinfo/home-deck';
import { PolicyDeck } from './cardinfo/policy-deck';
import { RoadDeck } from './cardinfo/road-deck';
import { TechDeck } from './cardinfo/tech-deck';
import { TileDeck } from './cardinfo/tile-deck';
import { TokenDeck } from './cardinfo/token-deck';
import { TransitDeck } from './cardinfo/transit-deck';
import { ChooseDir, DirSpec } from './choose-dir';
import { CmClient } from './cm-client';
import { CmReferee } from './cm-ref';
import { DebtForTable } from './Debt';
import { Effects } from './effects';
import { GamePlay, NamedContainer } from './game-play';
import { MainMap } from './main-map';
import { GUI, RoboBase, RoboOne } from './robo-player';
import { RectShape } from './shapes';
import { LogWriter } from './stream-writer';
import { Table } from './table';
import { TP } from './table-params';
import { ValueCounter } from "./value-counter";

export class GameSetup {
  stage: Stage;
  table: Table;
  mainMap: MainMap;
  gamePlay: GamePlay;
  paramGUI: ParamGUI;
  extNames: Set<string> = new Set();   // names of observed ext: values
  excludeExt: string[] = []; // name of Extension sets to exclude
  policyNames: string[];  // names of Policy cards for debug/test spec
  eventNames: string[];  // names of Event cards for debug/test spec
  tileNames: string[];  // names of Tile cards for debug/test spec
  taxNames: string[];  // names of isTax() cards for paramGUI
  roadNames: string[];  // names of Road cards for debug/test spec
  dirNames: string[];   // name of Dir cards for debug/test spec
  ghost: string;

  _netState = " " // or "yes" or "ref"
  set netState(val: string) {
    this._netState = (val == "cnx") ? "yes" : val
    console.log(stime(this, `.netState('${val}')->'${this._netState}'`))
    this.paramGUI?.selectValue("Network", val)
  }
  get netState() { return this._netState }

  logTime_js: string;
  readonly logWriter = this.makeLogWriter();
  makeLogWriter() {
    const logTime_js = this.logTime_js = `log_${stime.fs('MM-DD_Lkk_mm')}.js`;
    const logWriter = new LogWriter(logTime_js, '[\n', ']\n'); // terminate array, but insert before terminal
    return logWriter;
  }

  /**
   * ngAfterViewInit --> start here!
   * @param canvasId supply undefined for 'headless' Stage
   * @param ghost server hosting CgServer/CmServer
   */
  constructor(canvasId: string, qParms?: Params) {
    this.ghost = qParms['host'];
    TP.marketTileNames = qParms['mkt']?.split(',') ?? [];  // set TableParams
    this.excludeExt = qParms['ext']?.split(',') ?? [];
    stime.fmt = "MM-DD kk:mm:ss.SSS"
    let stage = this.stage = makeStage(canvasId, false);
    if (! (stage instanceof Stage)) console.log(stime(this, `.new GameSetup: not a Stage:`), {stage, stage0: new Stage(canvasId), stage1: new Stage(canvasId)})
    this.table = new Table(stage)      // makeScaleCont()
    this.gamePlay = new GamePlay(this.table, this);
    this.table.gamePlay = this.gamePlay
    this.table.cmClient = new CmClient()    // pro-forma, temporary, disconnected CmClient
    // NOTE: CI.imageLoader.loadImages() is started with () => { console.log(); }
    CI.imageLoader.imageMapPromise?.then((imap) => {
      console.log(stime(this, `.constructor: images loaded`), imap.size);
    }, (imap) => {
      console.log(stime(this, `.constructor: images FAILED`), imap);
    })
  }
  /** de-construct all the CardContainers & EventListeners & Card.slotInfo & parent */
  restart() {
    Effects.effects = new Effects() // ensure effects.db is reset
    // make all old Containers invalid for stage.update() and dispatchEvent()
    // recursive function, descend all [non-Card] child Containers:
    let deContainer = (cont: Container) => {
      cont.children.forEach(dObj => {
        dObj.removeAllEventListeners()
        if (dObj instanceof Container) deContainer(dObj)
      })
      if (cont instanceof Card) {
        this.table.cleanDiscardedCard(cont) // remove selected children (non-Bitmap)
      } else {
        cont.removeAllChildren()
      }
    }
    this.table.removeAllEventListeners()
    this.table.allPlayers.forEach(p => p.removeAllEventListeners())
    if (this.stage instanceof Stage) {
      this.tokenDecks.forEach(d => d.stack.forEach(card => card.setSlotInfo(undefined)))
      this.allOtherCards.forEach(card => card.setSlotInfo(undefined)) // remove Cards from prior Containers

      deContainer(this.stage)
      this.table.makeScaleCont(true)
    }
    this.stage.update()
    console.log(stime(this, `.restart: Deconstruct Players, CardContainer, Listeners, Effects`))
    this.startup(false)
    this.imagesLoaded() // ASSERT restart() invoked *after* first .imagesLoaded()
  }

  tokenDecks: Deck[] = [HomeDeck.deck, DotsDeck.deck, DirDeck.deck, AlignDeck.deck, TokenDeck.deck]; // TokenDeck includes DebtTokens
  cardDecks: Deck[] = [TileDeck.deck, TechDeck.deck, TransitDeck.deck, RoadDeck.deck, EventDeck.deck, PolicyDeck.deck];
  promiseArrays: Array<Promise<HTMLImageElement>>[] = [];
  fieldNameForDeck = {
    HomeDeck: "homeCards", DotsDeck: "dotsCards", DirDeck: "dirCards", AlignDeck: "alignCards", TokenDeck: 'tokenCards'
    //TileDeck: "tileCards", PolicyDeck: "policyCards", EventDeck: "eventCards", RoadDeck: "roadCards",
  };
  /** load all the Decks. filling promiseArrays */
  loadCardsOfDeck(decks: Deck[], deckName: string, promiseArrays: Promise<HTMLImageElement>[][]): Stack {
    let stack: Stack = new Stack();

    const pushDeckToStack = (deck: Deck) => {
      const fieldName = this.fieldNameForDeck[deckName ?? deck.name];
      if (!!fieldName) {
        stack = this.table[fieldName] ?? (this.table[fieldName] = new Stack())
      }
      stack.push(...deck.stack) // stack = stack.shuffle(deck.stack)
    }
    let isLike = (ci: CardInfo2, ary: string[]): boolean => {
      return !!ary.find(str => (ci.name == str || ci.type == str || ci.subtype == str || ci.ext == str))
    }

    decks.forEach(deck => {
      deck.cards.forEach(card => this.extNames.add(card.ext))
      const cards0 = deck.cards.filter(card => !this.excludeExt.includes(card.ext))
      const cards = cards0.filter(card => !isLike(card, TP.removeCards) || isLike(card, TP.includeCards))
      deck.stack = Card.loadCards(cards, this.table);
      promiseArrays.push(deck.stack.imagePromises);
      pushDeckToStack(deck);
    }, this)
    return stack; // return value only interesting/useful when deckName = 'other'
  }
  allOtherCards: Stack;
  /**
   * load all the Decks of Cards. put stacks on this Table, wait for Images to load.
   * @param loadCards set 'true' to force reloading all the cards & new ParamGUI
   * @param gs source from which to copy tokenDecks
   */
  startup(loadCards?: boolean, gs: GameSetup = this, ext: string[] = gs.excludeExt) {
    console.log(stime(this, `.startup: loadCards=${loadCards} ext=`), ext)
    this.loadStart = Date.now()
    this.excludeExt = ext
    // load all the Cards, store each Deck.stack in an instance var:
    if (!(gs.allOtherCards instanceof Stack)) {
      loadCards = true
      gs.loadCardsOfDeck([BackDeck.deck], undefined, this.promiseArrays)
      gs.loadCardsOfDeck(this.tokenDecks, undefined, this.promiseArrays)
      gs.allOtherCards = this.loadCardsOfDeck(this.cardDecks, "other", this.promiseArrays)
    }
    let noExt = this.excludeExt.filter(name => !this.extNames.has(name))
    if (noExt.length > 0 && loadCards) alert(`no such extensions ${noExt}`)
    if (this != gs) {
      // copy [new instanceof each] cards & stacks from gs.table to this.table:
      this.tokenDecks.forEach(deck => {
        const fieldName = this.fieldNameForDeck[deck.name]
        const tokenCards = gs.table[fieldName] as Stack
        this.table[fieldName] = new Stack(tokenCards.map(card => new Card(card, 1, this.table)))
      })
      this.allOtherCards = new Stack(gs.allOtherCards.map(card => new Card(card, 1, this.table))) // copy with null slotInfo
    }
    let otherCards = new Stack(Array.from(this.allOtherCards)) // trust that slotInfo is nullified
    let tileCards = otherCards.findCards(card => card.isTileStack(), true)
    let policyCards = otherCards.findCards(card => card.isPolicyStack(), true)
    let tileBack: Card, eventBack: Card
    const backDeck = BackDeck.deck.cards as CardInfo[];
    tileBack = new Card(backDeck.find((c) => (c.name == "Tile Back")), 1, this.table)
    eventBack = new Card(backDeck.find((c) => (c.name == "Event Back")), 1, this.table)
    console.log(stime(this, `.startup: Cards loaded`), { tileBack, eventBack, tileCards });
    // put Cards on this.table:
    this.table.tileCards = new Stack([tileBack]).shuffle(tileCards)
    this.table.policyCards = new Stack([eventBack]).shuffle(policyCards)
    //console.log(stime(this, ".startup:"), {tileCards: this.table.tileCards.map(c=> {return {name: c.name, id: c.id}})})
    //console.log(stime(this, ".startup:"), {policyCards: this.table.policyCards.map(c=> {return {name: c.name, id: c.id }})})
    if (!TP.multiDirCards) {
      // remove DirChoice cards, replace with more single-Dir cards:
      let dirCards = this.table.dirCards.filter(card => card.subtype.length == 1)
      let morCards = dirCards.map(card => new Card(card, 1, this.table)) // 2 of each...
      dirCards = dirCards.concat(morCards)
      this.table.dirCards = new Stack(dirCards)
    }

    /** get names of selected cards, suitable for ParamGUI menu items. */
    let findNames = (cards: Card[], pred: (card: Card)=>boolean) => {
      let names = [""]
      cards.filter(c => !!c && pred(c) && !names.find(cn => cn == c.name) && names.push(c.name))
      names.sort()
      return names
    }
    this.policyNames = findNames(this.table.policyCards, (c) => c.isPolicy())
    this.eventNames = findNames(this.table.policyCards, (c) => c.isEvent())
    this.tileNames = findNames(this.table.tileCards, (c) => c.isTile())
    this.taxNames = findNames(this.table.tileCards.concat(this.table.policyCards), c => c.isTax())
    const roadCards = TP.roadsInEvents ? this.table.policyCards : this.table.tileCards;
    this.roadNames = findNames(roadCards, (c) => c.type === 'Road');
    this.dirNames = findNames(this.table.dirCards, (c) => true);

    if (loadCards) { // was hacked back @ "new stime (in CC)"
      // flatten promiseArrays:
      let allImages: Promise<HTMLImageElement>[] = [].concat(...this.promiseArrays);
      Promise.all<HTMLImageElement>(allImages).then((images) => this.imagesLoaded(images));
    }
    if (!!this.paramGUI) this.paramGUI.selectValue("Start", " ")
  }
  loadStart: number

  /** layoutTable, DebtContainers, enable HomeCard drop. */
  imagesLoaded(images?: HTMLImageElement[]) {
    console.log(stime(this, `.imagesLoaded: dt =`), Date.now() - this.loadStart)
    this.table.layoutTable();     // layout Table, MainMap, Markets, makeAndInitPlayers, etc
    this.table.dft = new DebtForTable()
    this.table.dft.configDebtContainers(this.table); // initialize Debt system

    this.mainMap = this.table.mainMap
    this.mainMap.table = this.table
    this.gamePlay.mainMap = this.mainMap
    this.mainMap._gamePlay = this.gamePlay
    //console.log(stime(this), "GameSetup:", {table: this.table, mainMap: this.mainMap, gamePlay: this.gamePlay})
    this.mainMap.makeLegalMarks();
    if (!!this.table.stage.canvas) {
      const scaleCont = this.table.scaleCont = this.table.scaleCont;
      const mktCont = this.table.marketContAt; // put ParamGUI to left of Markets
      const scale = 2 * Card.scale, d = 5 * scale, cx = mktCont.x, cy = mktCont.y;
      const guiC = new NamedContainer('ParamGUI', cx, cy);
      guiC.scaleX = guiC.scaleY = scale;
      scaleCont.addChild(guiC);
      const gui = this.makeParamGUI(guiC), map = this.table.mainMap.parent;
      guiC.x -= (gui.linew + d) * scale;
      this.paramGUI = this.table.paramGUI = gui
      scaleCont.addChildAt(guiC, scaleCont.getChildIndex(map))
      const gui2C = new NamedContainer('CardGUI', guiC.x, guiC.y + gui.ymax * scale + 2 * d);
      gui2C.scaleX = gui2C.scaleY = scale;
      scaleCont.addChild(gui2C); //
      const gui2 = this.makeCardGUI(gui2C);
      const bgr = new RectShape({ x: -d, y: -d, w: gui2.linew + 2 * d, h: gui2.ymax + 2 * d }, 'rgb(200,200,200,.5)', '');
      gui2C.addChildAt(bgr, 0);
      CC.dragger.makeDragable(gui2C);
      this.table.bindKeysToScale("z") // reset scaling params with table.paramGUI
    }

    this.table.setNextPlayer(0); // enable Player0 to distArrange
    // the last player.homeCardDropped will trigger chooseStartPlayer().
    this.stage.update();
  }

  /** from before we used alert() to notfiy of errors. */
  makeLogCounter() {
    // create Counter and inject callbacks from Dragole to update it:
    let logCount = new ValueCounter("logCount", 0, "RED", 50);
    logCount.attachToContainer(this.stage, { x: 80, y: 80 }, this.table, "logCount");
    Dragole.logCount = (count: number) => { this.table.dispatchEvent(new ValueEvent("logCount", count)); };
    Dragole.logMsg = (msg, ...args) => { alert(msg); };

  }
  defStyle = { rootColor: "rgba(160,160,160,.5)", arrowColor: "grey", textAlign: 'right' }

  /** param x (3*cw+1*ch+6*m) + max(line.width) - (max(choser.width) + 20) */
  makeParamGUI(parent: Container, x = 0, y = 0): ParamGUI {
    let gui = new ParamGUI(TP, this.defStyle), CyC = CycleChoice
    gui.name = 'mainParamGUI';
    let roboChoice = [{ value: GUI, text: "GUI" }, { value: RoboOne, text: "RoboOne" }]
    //gui.makeParamSpec("Start", ["", "yes", "no"], { fontSize: 40, fontColor: "red" })
    gui.makeParamSpec("Start", ["yes", "no"], { chooser: CycleChoice, fontSize: 40, fontColor: "red" })
    gui.makeParamSpec("Network", [" ", "yes", "no", "ref", "obs"], { fontSize: 40, fontColor: "red" })
    gui.makeParamSpec("PlayerId", [" ", 0, 1, 2, 3, "ref", "obs"], { fontSize: 40, fontColor: "blue" })
    gui.makeParamSpec("Robo-0", roboChoice, { chooser: CyC, fontSize: 40, fontColor: "blue" })
    gui.makeParamSpec("Robo-1", roboChoice, { chooser: CyC, fontSize: 40, fontColor: "blue" })
    gui.makeParamSpec("numPlayers", [2, 3])
    gui.makeParamSpec("vpToWin", [20, 30])
    gui.makeParamSpec("nDebtCards", [0, 32, 40, 48])
    gui.makeParamSpec("maxDebtOfPlayer", [14, 16, 48])
    gui.makeParamSpec("moveDwell", [600, 300, 100])
    gui.makeParamSpec("flipDwell", [200, 100, 75])
    gui.makeParamSpec("mapRows", [5, 6, 7, 8])
    gui.makeParamSpec("mapCols", [12, 13, 14, 15])
    gui.makeParamSpec("rangeDivisor", [10, 9, 8, 7, 6, 5])
    gui.makeParamSpec("debugOnDiscard", [true, false], { chooser: CyC })
    gui.makeParamSpec("buildWithinRange", [true, false], { chooser: CyC })
    gui.makeParamSpec("buildOnlyAdjacent", [true, false], { chooser: CyC })
    gui.makeParamSpec("roadsInEvents", [true, false], { chooser: CyC })
    gui.makeParamSpec("taxesInTiles", [true, false], { chooser: CyC })
    gui.makeParamSpec("multiDirCards", [true, false], { chooser: CyC })
    gui.makeParamSpec("chooseDir", [true, false], { chooser: CyC, fontSize: 30, fontColor: "red"}) // test button

    gui.spec("Start").onChange = (item: ParamItem) => { if (item.value == "yes") this.paramStart() }
    gui.spec("Network").onChange = (item: ParamItem) => {
       if (item.value == "yes") this.network(false)    // nkey; CmClient
       if (item.value == "ref") this.network(true)     // rkey; CmReferee
       if (item.value == "no") this.closeNetwork()     // ckey;
      }
    gui.spec("PlayerId").onChange = () => {} // do not set TP.PlayerId... network will set it
    let makeRobo = (clazz: typeof RoboBase, id: number) => { new clazz(this.table, this.table.allPlayers[id])}
    gui.spec("Robo-0").onChange = (item: ParamItem) => { makeRobo(item.value, 0) }
    gui.spec("Robo-1").onChange = (item: ParamItem) => { makeRobo(item.value, 1) }

    gui.spec("chooseDir").onChange = (item: ParamItem) => this.testChooseDir(item)

    parent.addChild(gui)
    gui.x = x; // (3*cw+1*ch+6*m) + max(line.width) - (max(choser.width) + 20)
    gui.y = y;
    gui.makeLines()
    gui.selectValue("Robo-0", RoboOne)
    gui.selectValue("Robo-1", RoboOne)
    gui.stage.update();
    this.bindKeys(gui);
    return gui
  }

  bindKeys(gui: ParamGUI) {
    let setNet = (arg: string) => { this.paramGUI.selectValue("Network", arg) }
    let step = () => { this.table.curPlayer.initMoveHistory(1) } // moveDistInit(1)
    let give = (arg: object) => {
      let plyr = this.table.curPlayer
      this.table.undoEnable()
      Object.entries(arg).forEach(([k,v]) => {
        this.table.addUndoRec(plyr, k)
        plyr[k] += v
      })
      this.table.undoClose()
    }
    let showUndo = () => { console.log(stime(this, ".showUndo:"), this.table.undoTag, this.table.undoRecs)}
    let showDiscard = () => { console.log(stime(this, ".showDiscard:"), this.table.discardT.getStack()) }
    let rebuy = () => {
      let robo = this.table.curPlayer.robo as RoboOne
      robo.notify(this.table, S.actionEnable)
    }
    let rebuild = () => {
      let robo = this.table.curPlayer.robo as RoboOne
      robo.notify(this.table, S.actionEnable)
    }
    let showRC = () => { this.table.mainMap.showRC()}
    let teleport = (dir: string) => this.table.curPlayer.teleport(dir)

    let histLog = () => {
      let logStr = "\n"
      this.table.forEachPlayerInTurn(p => logStr += (p.stats.dump()))
      console.log(logStr)
    }
    let drawDist = (n: number) => {
      // should pro'ly ignore if this.table.isNetworked(...)
      let plyr = this.table.curPlayer
      let name = `Distance-${plyr.color}-${n}`, dist = 0
      while (dist === 0) {
        dist = plyr.getNextDistance(name, true)                 // assert 'preGame' so will not draw Direction
        console.log(stime(this, `.drawDist${n} => ${dist}`))
        if (dist === 0) plyr.reshuffleDist(false, ["-1", "-2"]) // ensure all dist available: [1:6]
      }
      plyr.firstDist = true // use the visible Distance on next clickToMove
    }

    let toggleRobo = () => {
      this.table.forEachPlayer((p, ndx) => {
        let fieldName = `Robo-${ndx}`
        let pSpec = gui.spec(fieldName)
        let item0 = pSpec.choices[0]
        let item1 = pSpec.choices[1]
        let item = item0
        if (p.robo instanceof item0.value) { // (robo instanceof GUI)
          item = item1
        }
        this.paramGUI.selectValue(fieldName, item.value)
        //console.log(stime(this, `.toggleRobo`), {fieldName, text: item.text})
      })
    }

    KeyBinder.keyBinder.setKey(".", { func: toggleRobo });
    KeyBinder.keyBinder.setKey("n", { func: setNet, argVal: "yes" });// network
    KeyBinder.keyBinder.setKey("l", { func: setNet, argVal: "no" }); // local
    KeyBinder.keyBinder.setKey("r", { func: setNet, argVal: "ref" });// ref

    KeyBinder.keyBinder.setKey("1", { func: drawDist, argVal: 1 });
    KeyBinder.keyBinder.setKey("2", { func: drawDist, argVal: 2 });
    KeyBinder.keyBinder.setKey("3", { func: drawDist, argVal: 3 });
    KeyBinder.keyBinder.setKey("4", { func: drawDist, argVal: 4 });
    KeyBinder.keyBinder.setKey("5", { func: drawDist, argVal: 5 });
    KeyBinder.keyBinder.setKey("6", { func: drawDist, argVal: 6 });
    KeyBinder.keyBinder.setKey("B", { func: give, argVal: { buys: 1 } });
    KeyBinder.keyBinder.setKey("b", { func: give, argVal: { builds: 1 } });
    KeyBinder.keyBinder.setKey("c", { func: give, argVal: { coins: 1 } });
    KeyBinder.keyBinder.setKey("d", { func: give, argVal: { draws: 1 } });
    KeyBinder.keyBinder.setKey("m", { func: give, argVal: { moves: 1 } });
    KeyBinder.keyBinder.setKey("p", { func: give, argVal: { polis: 1 } });
    KeyBinder.keyBinder.setKey("w", { func: give, argVal: { buys: 3, builds: 3, coins: 30, draws: 3, moves: 3, polis: 3 } });
    KeyBinder.keyBinder.setKey("u", { func: showUndo });
    KeyBinder.keyBinder.setKey("h", { func: histLog });
    KeyBinder.keyBinder.setKey("y", { func: showDiscard });
    KeyBinder.keyBinder.setKey("r", { func: showRC });
    KeyBinder.keyBinder.setKey("s", { func: step });  // step-1 w/o a move or dist
    KeyBinder.keyBinder.setKey("f", { func: rebuy });
    KeyBinder.keyBinder.setKey("F", { func: rebuild });
    KeyBinder.keyBinder.setKey("N", { func: teleport, argVal: S.N });
    KeyBinder.keyBinder.setKey("E", { func: teleport, argVal: S.E });
    KeyBinder.keyBinder.setKey("S", { func: teleport, argVal: S.S });
    KeyBinder.keyBinder.setKey("W", { func: teleport, argVal: S.W });
    KeyBinder.keyBinder.setKey("q", { func: this.table.undoIt, thisArg: this.table });
    KeyBinder.keyBinder.setKey("C-z", { func: this.table.undoIt, thisArg: this.table });
    KeyBinder.keyBinder.setKey("M-z", { func: this.table.undoIt, thisArg: this.table });
    KeyBinder.keyBinder.setKey('M-r', { thisArg: this, func: () => { this.netState = "ref" } })
    KeyBinder.keyBinder.setKey('M-c', { thisArg: this, func: () => { this.netState = "yes" } })
    KeyBinder.keyBinder.setKey('M-d', { thisArg: this, func: () => { this.netState = "no" } })
    return gui
  }

  makeCardGUI(parent: Container, x = 0 , y = 0) {
    let gui = new ParamGUI(TP, this.defStyle), CyC = CycleChoice
    let getCardByName = (item: ParamItem, cc: CardContainer) => {
      let card = cc.getStack().findCard(item.text)
      if (!!item.text) {
        !!card && cc.addCard(card)
        console.log(stime(this, `.getCardByName: ${item.text} on ${cc.name}`), { card, cc })
      }
      this.paramGUI.selectValue(item.fieldName, "") // unselect item.text, so we can do it again! (reentrant!)
      return card
    }
    let drawByName = (item: ParamItem, cont: CardContainer) => {
      if (!getCardByName(item, cont)) return
      let card = cont.bottomCardOfStack()
      if (card.type == "Back") return // if requested item was not found...
      this.table.curPlayer.draws = Math.max(1, this.table.curPlayer.draws); // enable draw
      this.table.drawFlipped(new CardEvent(S.flipped, card, 0, 0, cont)) // FORCE draw
    }

    {
      gui.makeParamSpec("getTile", this.tileNames, { style: { textAlign: 'left' } })
      gui.makeParamSpec("drawTile", this.tileNames, { style: { textAlign: 'left' } })
      gui.spec("getTile").onChange = (item: ParamItem) => { getCardByName(item, this.table.tileDeck) }
      gui.spec("drawTile").onChange = (item: ParamItem) => { drawByName(item, this.table.tileDeck) }
    }
    if (this.policyNames.length > 1) {
      gui.makeParamSpec("getPolicy", this.policyNames, { style: { textAlign: 'left' } })
      gui.makeParamSpec("drawPolicy", this.policyNames, { style: { textAlign: 'left' } })
      gui.spec("getPolicy").onChange = (item: ParamItem) => { getCardByName(item, this.table.policyDeck)}
      gui.spec("drawPolicy").onChange = (item: ParamItem) => { drawByName(item, this.table.policyDeck)}
    }
    if (this.eventNames.length > 1) {
      gui.makeParamSpec("getEvent", this.eventNames)
      gui.makeParamSpec("drawEvent", this.eventNames)
      gui.spec("getEvent").onChange = (item: ParamItem) => { getCardByName(item, this.table.policyDeck)}
      gui.spec("drawEvent").onChange = (item: ParamItem) => { drawByName(item, this.table.policyDeck)}
    }
    if (this.roadNames.length > 1) {
      gui.makeParamSpec("getRoad", this.roadNames)
      gui.makeParamSpec("drawRoad", this.roadNames)
      const roadDeck = TP.roadsInEvents ? this.table.policyDeck : this.table.tileDeck;
      gui.spec("getRoad").onChange = (item: ParamItem) => { getCardByName(item, roadDeck)}
      gui.spec("drawRoad").onChange = (item: ParamItem) => { drawByName(item, roadDeck)}
    }
    if (this.taxNames.length > 1) {
      gui.makeParamSpec("getTax", this.taxNames)
      gui.makeParamSpec("drawTax", this.taxNames)
      const taxDeck = TP.taxesInTiles ? this.table.tileDeck : this.table.policyDeck;
      gui.spec("getTax").onChange = (item: ParamItem) => { getCardByName(item, taxDeck)}
      gui.spec("drawTax").onChange = (item: ParamItem) => { drawByName(item, taxDeck)}
    }
    {
      gui.makeParamSpec('getDir', this.dirNames)
      gui.spec("getDir").onChange = (item: ParamItem) => {
        const player = this.table.curPlayer;
        player.reshuffleDirCards(player.dirCards.getStack())
        player.setDirCard(getCardByName(item, player.dirCards));
      }
    }
    parent.addChild(gui)
    gui.x = x;
    gui.y = y;
    gui.makeLines()
    gui.stage?.update()
    return gui;
  }

  /** If network: negotiate TPs; else just restart() */
  paramStart() {
    this.restart()
  }
  buildURL(scheme: string, host: string, domain: string, port: number, path: string  = ''): string {
    return `${scheme}://${host}.${domain}:${port}${path}`
  }
  /** Invoked by ParmaGUI.onChange: join client-group, play with remote players
   * @param ref set true if playing as the referee
   * @param url from TP.networkUrl
   */
  network(ref: boolean) {
    // Disable Robo while we get Network set up: (robo fake clicks...)
    this.paramGUI.selectValue("Robo-0", GUI)
    this.paramGUI.selectValue("Robo-1", GUI)
    let url = this.buildURL('wss', this.ghost || TP.ghost, TP.gdomain, TP.gport)
    let group = TP.networkGroup

    let nameByClientId = ["Referee", "Alice", "Bob", "Charlie", "Doris"];

    // invoked after [a] referee has joined the game
    let join_game_as_player = (ack: CgMessage) => {
      let cmClient = this.table.cmClient, client_id = cmClient.client_id
      let name = nameByClientId[client_id]
      console.log(stime(this, ".network join_game_as_player: start"), { name, client_id, ack })
      // send join_game request to Referee {client_id: 0}; handle the subsequent join message
      cmClient.sendAndReceive(() => cmClient.send_join(name),
        msg => (msg.type == CmType.cm_join && msg.name == name)).then(
          // like a 'once' Listener; in addition to cmClient.eval_join:
          msg => {
            let player_id = msg.player // use player_id assigned by referee
            console.log(stime(this, ".network join_game_as_player: joined"), { name, player_id, msg })
            if (player_id >= 0) {
              let player = this.table.allPlayers[player_id]
              player.distArrangerDone = false
              cmClient.attachToPlayer(player) // indicate isNetworked(player); cmClient.localPlayer += player
              this.paramGUI.selectValue("PlayerId", player_id) // dubious... may need > 1 of these [multi-choice]
              cmClient.table.setNextPlayer(player_id)          // ndx & putButtonOnPlayer
            }
          })
    }
    // onOpen: attach player to this.table & GUI [also for standalone Referee]
    let tableClient = (cmClient: CmClient) => {
      this.table.cmClient = cmClient              // a connected CmClient
      cmClient.wsbase.log = 0
      cmClient.cgbase.log = 1
      cmClient.log = 1
      this.table.resetTileDeck()   // hmm... also resetPolicDeck?
      this.paramGUI.selectValue("Network", ref? "ref" : "yes")
      cmClient.attachToGUI(this.table)
      cmClient.addEventListener('close', (ev: CloseEvent) => {
        this.paramGUI.selectValue("Network", "no")
        this.paramGUI.selectValue("PlayerId", " ")
      })
    }
    let initPlyrClient = (url: string, onOpen: (cmClient: CmClient) => void) => {
      // connectStack; then onOpen(cmClient); maybeMakeRef; join_game
      new CmClient(url, (cmClient) => {
        onOpen(cmClient)
        cmClient.cgbase.send_join(group).then((ack: CgMessage) => {
          console.log(stime(this, ".network CgJoin ack:"), {success: ack.success, client_id: ack.client_id, ack})
          if (!ack.success) return        // did not join Client-Group!
          if (ack.client_id === 0) return // asked for Referee connection and got it!
          // joined group as player; try make a Referee, then join_game as player
          if (ack.cause === "auto-approve") {
            this.makeRefJoinGroup(url, group, join_game_as_player)
          } else {
            join_game_as_player(ack)
          }
        })
      })
    }
    let initRefClient = (url: string, onOpen: (cmClient: CmClient) => void) => {
      // connectStack; then onOpen(refClient); [implicit join game]
      let ref = new CmReferee(undefined, () => {}) // create, do not open/connect
      ref.joinGroup(url, group, (ggRef) => {
        onOpen(ref)
        this.paramGUI.selectValue("PlayerId", "ref")
        ggRef.addEventListener('close', (ev: CloseEvent) => {
          this.paramGUI.selectValue("Network", "no")
          this.paramGUI.selectValue("PlayerId", " ")
        })
      }) // explicit refClient
    }
    // client for GUI connection to CmServer:
    (ref ? initRefClient : initPlyrClient)(url, tableClient)
  }
  /**
   * setup game and table for headless CmReferee in a Player's browser.
   * @param onJoin inform caller that CmReferee is ready.
   * @returns the CmReferee (like a constructor...)
   */
  makeRefJoinGroup(url: string, group: string, onJoin: (ack: CgMessage) => void): void {
    let refgs = new GameSetup(undefined) // with no Canvas
    refgs.stage.enableMouseOver(0)
    refgs.stage.tickEnabled = refgs.stage.tickChildren = false
    refgs.startup(false, this)           // get all the Cards/Decks from this.table [no ParamGUI]
    let ref = refgs.table.cmClient = new CmReferee() // No URL, no connectStack()
    ref.table = refgs.table              // but not attachToGui()
    refgs.imagesLoaded()                 // initialize players and containers
    let onOpen = (cmClient: CmReferee) => {
      cmClient.wsbase.log = 0
      cmClient.cgbase.log = 0
      console.log(stime(cmClient, `.onOpen: now join_game_as_player`))
    }
    ref.joinGroup(url, group, onOpen, onJoin);
    return;
  }

  closeNetwork() {
    let closeMe = (cmClient: CmClient) => {
      cmClient.detachGUI(cmClient.table)
      cmClient.closeStream(CLOSE_CODE.NormalClosure, "GUI -> no")
    }
    this.table.isNetworked(closeMe, closeMe)
  }

  testChooseDir(item: ParamItem) {
    let cd = this.table.chooseDir
    console.log(stime(this, `.testChooseDir: entry`), {resolved: cd.rv.resolved, value: cd.value, cd})
    if (item.value) {
      let plyr = this.table.curPlayer
      let card = plyr.onCard()
      let result = (cd: ChooseDir) => {
        console.log(stime(this, `.testChooseDir: result`), {resolved: cd.rv.resolved, value: cd.value, cd})
        cd.visible = false
        this.paramGUI.selectValue("chooseDir", false)
        cd.stage.update()
      }
      cd.choose(card, plyr, {N: "Click me?", W:"no", E:"yes", S: 1} as DirSpec).then(result)
      console.log(stime(this, `.testChooseDir: choose`), {resolved: cd.rv.resolved, value: cd.value, cd})
    } else {
      cd.visible = false
    }
  }
}
