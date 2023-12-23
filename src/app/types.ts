import { EventDispatcher } from '@thegraid/easeljs-module';

/** drill down through value of inner fields. */
export function findFieldValue(obj: object, ... names: Array<string|Array<string>> ) {
  let n = names.shift(), next: any
  if (!n) return obj            // return obj when no more field accessors
  if (typeof(n) == 'string') {
    next = obj[n]
  } else {
    let nn = n.find(n => !!obj[n])
    next = !!nn ? obj[nn] : !!n[0] ? undefined : obj // [null, foo, bar] -> next = obj
  }
  return !!next ? findFieldValue(next, ... names) : undefined
}
/** Interface into RoboPlayer */
export interface Notifyable {
  notify(source: EventDispatcher, eventName: string, dwell?: number): void
  block(source?: EventDispatcher, eventName?: string, dwell?: number): void
  bonusAry(card): number[]
}

/**
 * remove listener from target before invoking listener.
 * @param target the EventDispatcher emitting Event(type)
 * @param type the Event to listener for
 * @param listener the function to run
 * @param scope a thisArg for invoking the listener
 * @param wait if supplied: setTimeout() for wait msecs before calling listener
 */
export function dispatchOnce(target: EventDispatcher, type: string, listener: (evt?: Object, ...args: any[]) => void, scope: Object = target, wait?: number) {
  let removeMe = (evt?: Object, ...args: any) => {
    target.off(type, listnr);
    if (!wait) {
      listener.call(scope, evt, ...args)
    } else {
      setTimeout(() => listener.call(scope, evt, ...args), wait)
    }
  }
  let listnr = target.on(type, removeMe, scope, true) // on Event(type), remove, wait, then run *once*
}
