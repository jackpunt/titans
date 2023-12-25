import { Params } from "@angular/router";
import { removeEltFromArray, selectN, uniq } from "@thegraid/common-lib";
import { blinkAndThen, C, ChoiceItem, CycleChoice, DropdownChoice, DropdownItem, DropdownStyle, makeStage, ParamGUI, ParamItem, stime } from "@thegraid/easeljs-lib";
import { Container, Stage } from "@thegraid/easeljs-module";
import { EBC, PidChoice } from "./choosers";
// import { parse as JSON5_parse } from 'json5';
import { GamePlay } from "./game-play";
import { Meeple } from "./meeple";
import { Player } from "./player";
import { LogReader, LogWriter } from "./stream-writer";
import { Table } from "./table";
import { TP } from "./table-params";
import { Tile } from "./tile";

/** show " R" for " N" */
stime.anno = (obj: string | { constructor: { name: string; }, stage?: Stage, table?: Table }) => {
  let stage = (typeof obj !== 'string') ? (obj?.stage || obj?.table?.stage) : undefined;
  return !!stage ? (!!stage.canvas ? " C" : " R") : " -" as string;
}

interface MultiItem extends DropdownItem { }

class MultiChoice extends DropdownChoice {
  // constructor(items: MultiItem[], item_w: number, item_h: number, style?: DropdownStyle) {
  //   super(items, item_w, item_h, style);
  // }

  override select(item: MultiItem): MultiItem {
    this.changed(item);
    return item;
  }
}

/** initialize & reset & startup the application/game. */
export class GameSetup {
  stage: Stage;
  gamePlay: GamePlay
  paramGUIs: ParamGUI[]
  netGUI: ParamGUI // paramGUIs[2]

  /**
   * ngAfterViewInit --> start here!
   * @param canvasId supply undefined for 'headless' Stage
   */
  constructor(canvasId: string, public qParams: Params) {
    stime.fmt = "MM-DD kk:mm:ss.SSSL"
    this.stage = makeStage(canvasId, false)
    this.stage.snapToPixel = TP.snapToPixel;
    this.setupToParseState();                 // restart when/if 'SetState' button is clicked
    this.setupToReadFileState();              // restart when/if 'LoadFile' button is clicked
    Tile.loader.loadImages(() => this.startup(qParams));
  }
  _netState = " " // or "yes" or "ref"
  set netState(val: string) {
    this._netState = (val == "cnx") ? this._netState : val || " "
    this.gamePlay.ll(2) && console.log(stime(this, `.netState('${val}')->'${this._netState}'`))
    this.netGUI?.selectValue("Network", val)
  }
  get netState() { return this._netState }
  set playerId(val: string) { this.netGUI?.selectValue("PlayerId", val || "     ") }

  logTime_js: string;
  readonly logWriter = this.makeLogWriter();
  makeLogWriter() {
    const logTime_js = this.logTime_js = `log_${stime.fs('MM-DD_Lkk_mm')}.js`;
    const logWriter = new LogWriter(logTime_js, '[\n', ']\n'); // terminate array, but insert before terminal
    return logWriter;
  }
  /** scenario as edited by ParamGUI */
  get curScenario() {
    this.ngods = Math.min(5, Math.max(2, this.ngods));
    const scenario = this.scenarioFromSource(this.scene ?? 'MiddleKingdom');
    scenario.ngods = this.ngods;
    scenario.godNames = this.godNames.concat();
    return scenario
  }

  /** C-s ==> kill game, start a new one, possibly with new dbp */
  restart(scenario = this.curScenario) {
    let netState = this.netState
    // this.gamePlay.closeNetwork('restart')
    // this.gamePlay.logWriter?.closeFile()
    this.gamePlay.forEachPlayer(p => p.endGame())
    Tile.allTiles.forEach(tile => tile.hex = undefined)
    let deContainer = (cont: Container) => {
      cont.children.forEach(dObj => {
        dObj.removeAllEventListeners()
        if (dObj instanceof Container) deContainer(dObj)
      })
      cont.removeAllChildren()
    }
    deContainer(this.stage)
    this.ngods = Math.min(5, Math.max(2, this.godNames.length));
    this.scenario = this.scenarioFromSource(this.scene ?? 'MiddleKingdom');
    this.scenario.ngods = this.ngods;
    this.scenario.godNames = this.godNames.concat();
    this.startScenario(scenario);  // running async...?
    this.netState = " "      // onChange->noop; change to new/join/ref will trigger onChange(val)
    // next tick, new thread...
    setTimeout(() => this.netState = netState, 100) // onChange-> ("new", "join", "ref") initiate a new connection
  }

  scene: string;
  ngods: number = undefined;
  godNames: string[] = [];
  guards: GuardIdent = [undefined, undefined, undefined];

  setupToParseState() {
    const parseStateButton = document.getElementById('parseStateButton');
    const parseStateText = document.getElementById('parseStateText') as HTMLInputElement;
    parseStateButton.onclick = () => {
      const stateText = parseStateText.value;
      const state = json5.parse(stateText) as SetupElt;
      state.Aname = state.Aname ?? `parseStateText`;
      blinkAndThen(this.gamePlay.hexMap.mapCont.markCont, () => this.restart(state))
    }
  }

  fileReadPromise: Promise<File>;
  async setupToReadFileState() {
    const logReader = new LogReader(`log/date_time.js`, 'fsReadFileButton');
    this.fileReadPromise = logReader.setButtonToReadFile();
    const fileHandle = await this.fileReadPromise;
    const fileText = await logReader.readFile(fileHandle);
    const fullName = (fileHandle as any as FileSystemFileHandle).name;
    const [fileName, ext] = fullName.split('.');
    const readFileNameElt = document.getElementById('readFileName') as HTMLInputElement;
    const readFileName = readFileNameElt.value;
    const [fname, turnstr] = readFileName.split('@');
    const turn = Number.parseInt(turnstr);
    const logArray = json5.parse(fileText) as LogElts;
    const [startelt, ...stateArray] = logArray;
    const state = stateArray.find(state => state.turn === turn);
    state.Aname = `${fileName}@${turn}`;
    this.setupToReadFileState();   // another thread to wait for next click
    this.restart(state);
  }

  scenarioFromSource(scene: string) {
    const scene1 = AnkhScenario[this.scene] as (Scenario);
    const scene2 = AnkhScenario[this.scene] as (Scenario[]) ?? AnkhScenario.OldKingdom;
    const scenario = scene1?.['ngods'] ? scene1 : scene2?.find(scen => (scen.ngods === this.ngods));
    console.log(stime(this, `.scenarioFromSource: ${scene} ngods=${this.ngods} scenario=`), scenario);
    return { ...scenario };
  }
  /**
   * Make new Table/layout & gamePlay/hexMap & Players.
   * @param qParams from URL
   */
  startup(qParams: Params = []) {
    //ngods = 4, gods?: string[], scene = this.scene ?? 'OldKingdom'
    this.godNames = qParams['gods']?.split(',') ?? this.godNames;
    this.ngods = qParams?.['n'] ? Number.parseInt(qParams?.['n'])
      : (this.godNames.length > 1) ? this.godNames.length : 2;
    this.ngods = Math.min(5, this.ngods);
    this.scene = qParams['scene'] ?? this.scene ?? 'OldKingdom';
    this.guards = qParams['guards']?.split(',') ?? this.guards;

    const scenario = this.scenarioFromSource(this.scene);
    if (scenario) scenario.Aname = scenario.Aname ?? this.scene;
    console.log(stime(this, `.startup: ${this.scene} ngods=${this.ngods} scenario=`), scenario);
    this.startScenario(scenario);
  }

  scenario: Scenario;  // last scenario loaded
  /** scenario.turn indicate a FULL/SAVED scenario */
  startScenario(scenario: Scenario) {
    God.byName.clear();
    Tile.allTiles = [];
    Meeple.allMeeples = [];
    Player.allPlayers = [];

    this.scenario = scenario;
    this.ngods = scenario.ngods ?? this.ngods;
    this.guards = scenario.guards ?? this.guards;
    this.godNames = scenario.godNames ?? this.godNames;
    const table = new Table(this.stage)        // EventDispatcher, ScaleCont, GUI-Player

    const fillGodNames = (ngods: number, godNames: string[]) => {
      const uniqGods = uniq(godNames);
      const nToFind = (ngods - godNames.length);
      const fullNames = (nToFind > 0)
        ? [...uniqGods].concat(selectN(God.allNames.filter(gn => !uniqGods.includes(gn)), ngods - uniqGods.length))
        : (nToFind < 0) ? selectN(uniqGods, ngods) : uniqGods;
      fullNames.length = Math.min(fullNames.length, 5);
      return fullNames;
    }
    const fillGuardNames = (pguards: GuardIdent, sguards: GuardIdent) => {
      [0, 1, 2].forEach((rank: 0 | 1 | 2) => {
        pguards[rank] = (!!pguards?.[rank] ? pguards[rank] : undefined) ?? sguards?.[rank] ?? Guardian.randomGuard(rank);
      })
      return pguards;
    }
    Guardian.setGuardiansByName();
    fillGuardNames(this.guards ?? [undefined, undefined, undefined], [undefined, undefined, undefined]);
    // console.log(stime(this, `.startup: guardNames =`), this.guards, guardNames);
    if (scenario.turn === undefined || scenario.godNames === undefined) scenario.godNames = fillGodNames(scenario.ngods, this.godNames); // inject requested Gods.
    if (scenario.turn === undefined || scenario.guards === undefined) scenario.guards = fillGuardNames(this.guards, scenario.guards);

    // Inject Table into GamePlay & make allPlayers:
    const gamePlay = new GamePlay(scenario, table, this) // hexMap, players, fillBag, gStats, mouse/keyboard->GamePlay
    this.gamePlay = gamePlay;

    // Inject GamePlay to Table; all the GUI components, makeAllDistricts(), addTerrain, initialRegions
    table.layoutTable(gamePlay);     // mutual injection & make all panelForPlayer
    gamePlay.forEachPlayer(p => table.setPlayerScore(p, 0));

    this.gamePlay.turnNumber = -1;   // in prep for setNextPlayer or parseScenario
    // Place Pieces and Figures on map:
    this.parseScenenario(scenario); // may change gamePlay.turnNumber, gamePlay.phase (& conflictRegion)
    this.gamePlay.logWriterLine0();

    gamePlay.forEachPlayer(p => p.newGame(gamePlay))        // make Planner *after* table & gamePlay are setup
    // if (this.stage.canvas) {
    //   console.groupCollapsed('initParamGUI')
    //   // table.miniMap.mapCont.y = Math.max(gui.ymax, gui2.ymax) + gui.y + table.miniMap.wh.height / 2
    //   console.groupEnd()
    // }
    this.godNames = scenario.godNames ?? this.godNames;
    this.makeParamGUI0(table.scaleCont, -340, 260);
    table.startGame(scenario); // parseScenario; allTiles.makeDragable(); setNextPlayer();
    return gamePlay
  }

  scenarioParser: ScenarioParser;
  parseScenenario(scenario: Scenario) {
    const hexMap = this.gamePlay.hexMap;
    const scenarioParser = this.scenarioParser = new ScenarioParser(hexMap, this.gamePlay);
    this.gamePlay.logWriter.writeLine(`// GameSetup.parseScenario: ${scenario.Aname}`)
    scenarioParser.parseScenario(scenario);
  }

  makeParamGUI0(parent: Container, x: number, y: number) {
    const gui = new ParamGUI(this, { textAlign: 'right'});
    parent.addChild(gui);
    gui.x = x;
    gui.y = y;
    gui.makeParamSpec('scene', ['MiddleKingdom', 'OldKingdom']);
    gui.makeParamSpec('ngods', [2, 3, 4, 5], { fontColor: "blue" });
    gui.makeParamSpec('godNames', God.allNames, { fontColor: "blue", chooser: MultiChoice });
    gui.spec("godNames").onChange = (item: MultiItem) => {
      const name = item.text; // God name
      if (this.godNames.includes(name)) {
        removeEltFromArray(name, this.godNames);
        item.button.style.textColor = item.button.style.textColorOver = 'white';
      } else {
        this.godNames.push(name);
        item.button.style.textColor = item.button.style.textColorOver = 'green';
      }
      this.ngods = Math.min(5, Math.max(2, this.godNames.length));
      const ngodsChooser = gui.findLine('ngods').chooser;
      ngodsChooser.select(ngodsChooser.items[this.ngods - 2]);
      console.log(stime(this, `.onChange: gods=${this.godNames}, ngods=${this.ngods}`));
      return;
    };
    Guardian.namesByRank.forEach((guards, n) => {
      const gn = `guard-${n+1}`;
      this[gn] = this.guards[n];
      gui.makeParamSpec(gn, guards, { fontColor: "blue" });
      gui.spec(gn).onChange = ((item: ChoiceItem) => { this.guards[n] = item.text });
    })

    gui.makeLines();
    console.log(stime(this, `.makeGUI: gods=`), this.godNames);
    gui.findLine('godNames').chooser.items.forEach((item: MultiItem, n) => {
      const render = (item: MultiItem, color: string) => {
        item.button.style.textColor = item.button.style.textColorOver = color;
        item.button.render();
      }
      render(item, (this.godNames.includes(item.text)) ? 'green' : 'white');
    });
    return;
  }

  /** affects the rules of the game & board
   *
   * ParamGUI   --> board & rules [under stats panel]
   * ParamGUI2  --> AI Player     [left of ParamGUI]
   * NetworkGUI --> network       [below ParamGUI2]
   */
  makeParamGUI(table: Table, parent: Container, x: number, y: number) {
    let restart = false
    const gui = new ParamGUI(TP, { textAlign: 'right'})
    const schemeAry = TP.schemeNames.map(n => { return { text: n, value: TP[n] } })
    // const setSize = (dpb: number, dop: number) => { restart && this.restart.call(this, dpb, dop) };
    gui.makeParamSpec("nh", [6, 7, 8, 9, 10, 11], { fontColor: "red" }); TP.nHexes;
    gui.makeParamSpec("mh", [0, 1, 2, 3], { fontColor: "red" }); TP.mHexes;
    gui.makeParamSpec("colorScheme", schemeAry, { chooser: CycleChoice, style: { textAlign: 'center' } });

    // gui.spec("nh").onChange = (item: ParamItem) => { setSize(item.value, TP.mHexes) }
    // gui.spec("mh").onChange = (item: ParamItem) => { setSize(TP.nHexes, item.value) }

    parent.addChild(gui)
    gui.x = x // (3*cw+1*ch+6*m) + max(line.width) - (max(choser.width) + 20)
    gui.y = y
    gui.makeLines()
    const gui2 = this.makeParamGUI2(parent, x - 320, y)
    const gui3 = this.makeNetworkGUI(parent, x - 320, y + gui.ymax + 20 );
    gui.parent.addChild(gui) // bring to top
    gui.stage.update()
    restart = true // *after* makeLines has stablilized selectValue
    return [gui, gui2, gui3]
  }
  /** configures the AI player */
  makeParamGUI2(parent: Container, x: number, y: number) {
    const gui = new ParamGUI(TP, { textAlign: 'center' })
    gui.makeParamSpec("log", [-1, 0, 1, 2], { style: { textAlign: 'right' } }); TP.log
    gui.makeParamSpec("maxPlys", [1, 2, 3, 4, 5, 6, 7, 8], { fontColor: "blue" }); TP.maxPlys
    gui.makeParamSpec("maxBreadth", [5, 6, 7, 8, 9, 10], { fontColor: "blue" }); TP.maxBreadth
    parent.addChild(gui)
    gui.x = x; gui.y = y
    gui.makeLines()
    gui.stage.update()
    return gui
  }
  netColor: string = "rgba(160,160,160, .8)"
  netStyle: DropdownStyle = { textAlign: 'right' };
  /** controls multiplayer network participation */
  makeNetworkGUI (parent: Container, x: number, y: number) {
    const gui = this.netGUI = new ParamGUI(TP, this.netStyle)
    gui.makeParamSpec("Network", [" ", "new", "join", "no", "ref", "cnx"], { fontColor: "red" })
    gui.makeParamSpec("PlayerId", ["     ", 0, 1, 2, 3, "ref"], { chooser: PidChoice, fontColor: "red" })
    gui.makeParamSpec("networkGroup", [TP.networkGroup], { chooser: EBC, name: 'gid', fontColor: C.GREEN, style: { textColor: C.BLACK } }); TP.networkGroup

    gui.spec("Network").onChange = (item: ParamItem) => {
      if (['new', 'join', 'ref'].includes(item.value)) {
        const group = (gui.findLine('networkGroup').chooser as EBC).editBox.innerText
        // this.gamePlay.closeNetwork()
        // this.gamePlay.network(item.value, gui, group)
      }
      // if (item.value == "no") this.gamePlay.closeNetwork()     // provoked by ckey
    }
    (this.stage.canvas as HTMLCanvasElement)?.parentElement?.addEventListener('paste', (ev) => {
      const text = ev.clipboardData?.getData('Text')
      ;(gui.findLine('networkGroup').chooser as EBC).setValue(text)
    });
    this.showNetworkGroup()
    parent.addChild(gui)
    gui.makeLines()
    gui.x = x; gui.y = y;
    parent.stage.update()
    return gui
  }
  showNetworkGroup(group_name = TP.networkGroup) {
    document.getElementById('group_name').innerText = group_name
    const line = this.netGUI.findLine("networkGroup"), chooser = line?.chooser
    chooser?.setValue(group_name, chooser.items[0], undefined)
  }
}
