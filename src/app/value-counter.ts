import { Point, EventDispatcher } from '@thegraid/easeljs-module';
import { TP } from './table-params';
import { XY, S, C } from './basic-intfs';
import { CardEvent, ValueEvent } from './card-event';
import { CardContainer } from './card-container';

import { ValueCounter as CommonValueCounter } from '@thegraid/easeljs-lib';

/** Container with a Box (colored circle/ellispe/shape), a value Text, and optional label Text.
 *
 * Extend standard ValueCounter to attachToStack(), and CardContainer offset methods...
 */
export class ValueCounter extends CommonValueCounter {
  private playerColor(color: string) { return (TP.playerColors.includes(color) || TP.playerRGBcolors.includes(color)) }
  override setValue(value: number | string, color?: string, fontSize?: number, fontName?: string,
    // if not supplied: use C.white over playerColors
    textColor = this.playerColor(color) ? C.white : undefined) {
    super.setValue(value, color, fontSize, fontName, textColor)
  }
  /** addEventHandler (for S.moved, S.removed) to invoke value-setting function at given [row][col]
   * @param cont: identify stack
   * @param row: identify stack
   * @param col: identify stack
   * @param offset location relative to center of slot: {center, center}
   * @param listens Event type(s) to listen for: [S.moved, S.removed]
   * @param updfn updateValue of Counter based on a ValueEvent
   * @param target EventDispatcher to listen to: cont
   */
  attachToStack(cont: CardContainer, row: number = 0, col: number = 0,
    offset: XY = new Point(0, 0),  // offset from CENTER of slot
    listens: string[] = [S.moved, S.removed],
    updfn?: ((e: ValueEvent) => void),
    target: EventDispatcher = cont ) {

    this.name = this.counterName(cont, row, col);
    let counter = this;
    // Position Counter on the overCont:
    let offs = cont.slotXY(row, col, offset.x, offset.y); // offset from center of slot[row,col]
    let overCont = cont.overCont; // may hold (cont.parent as ContainerAt).overCont;
    // cont and overCont have the same (ContainerAt) parent, but may have different translation or offset
    cont.localToLocal(offs.x, offs.y, overCont, counter); // generally a no-op: overlay is at CardContaier(0,0)
    overCont.addChild(counter);
    this.stage.update();
    //console.log(stime(this, ".attachToSlot: counter.xy="), counter.name, counter.x, counter.y)
    if (listens) {
      listens.forEach(type => target.addEventListener(type, updfn));
    }
    // trigger a first update:
    updfn.call(counter, new CardEvent("initial", undefined, row, col, cont));
  }

  counterName(cont: CardContainer, row: number, col: number): string {
    return "Counter:" + cont.name + "[" + row + "][" + col + "]";
  }

  // these should all be methods of CardContainer! (table uses bottomEdge -> marginY)
  // leftEdge, rightEdge, topEdge, bottomEdge ?
  cardEdgeAndMarginX(cont: CardContainer, edge: number = 1, mar = 0) {
    // edge 0 = leftEdge, edge 1 = right edge
    let slotSize = cont.slotSize.width, cardSize = cont.cardSize.width;
    return (edge * slotSize - slotSize / 2) - mar * (slotSize - cardSize);
  }
  cardEdgeAndMarginY(cont: CardContainer, edge: number = 1, mar = 0) {
    // edge 0 = leftEdge, edge 1 = right edge
    let slotSize = cont.slotSize.height, cardSize = cont.cardSize.height;
    return (edge * slotSize - slotSize / 2) - mar * (slotSize - cardSize);
  }
  /** offset.y to center oval (mar+1)*margin up from bottom edge of card */
  cardBottomEdge(cont: CardContainer, mar = 0): number {
    return cont.slotSize.height / 2 - this.cardMarginY(cont, mar);
  }
  cardMarginY(cont: CardContainer, mar = 0): number {
    let mary = (cont.slotSize.height - cont.cardSize.height) / 2;
    return mary * (1 + mar); // Why +1 ??
  }
  cardMarginX(cont: CardContainer, mar = 0): number {
    let marx = (cont.slotSize.width - cont.cardSize.width) / 2;
    return marx * (1 + mar);
  }
  /** offset.x from center to right edge of card */
  cardRightEdge(cont: CardContainer, mar = 0): number {
    return cont.slotSize.width / 2 - this.cardMarginX(cont, mar);
  }
}
