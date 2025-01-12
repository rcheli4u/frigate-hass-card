import { isEqual } from 'lodash-es';
import { FrigateCardError } from '../types';

/**
 * Dispatch a Frigate Card event.
 * @param element The element to send the event.
 * @param name The name of the Frigate card event to send.
 * @param detail An optional detail object to attach.
 */
export function dispatchFrigateCardEvent<T>(
  target: EventTarget,
  name: string,
  detail?: T,
): void {
  target.dispatchEvent(
    new CustomEvent<T>(`frigate-card:${name}`, {
      bubbles: true,
      composed: true,
      detail: detail,
    }),
  );
}

/**
 * Prettify a title by converting '_' to spaces and capitalizing words.
 * @param input The input Frigate (camera/label/zone) name.
 * @returns A prettified name.
 */
export function prettifyTitle(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }
  const words = input.split(/[_\s]+/);
  return words
    .map((word) => {
      return word[0].toUpperCase() + word.substring(1);
    })
    .join(' ');
}

/**
 * Move an element within an array.
 * @param target Target array.
 * @param from From index.
 * @param to To index.
 */
export function arrayMove(target: unknown[], from: number, to: number): void {
  const element = target[from];
  target.splice(from, 1);
  target.splice(to, 0, element);
}

/**
 * Determine if the contents of the n(ew) and o(ld) values have changed. For use
 * in lit web components that may have a value that changes address but not
 * contents -- and for which a re-render is expensive/jarring.
 * @param n The new value.
 * @param o The old value.
 * @returns `true` is the contents have changed.
 */
export function contentsChanged(n: unknown, o: unknown): boolean {
  return !isEqual(n, o);
}

/**
 * Log an error as a warning to the console.
 * @param e The Error object.
 * @param func The Console func to call.
 */
export function errorToConsole(e: Error, func?: CallableFunction): void {
  if (!func) {
    func = console.warn;
  }
  if (e instanceof FrigateCardError && e.context) {
    func(e, e.context);
  } else {
    func(e);
  }
}

/**
 * Determine if the device supports hovering.
 * @returns `true` if the device supports hovering, `false` otherwise.
 */
export const isHoverableDevice = (): boolean => window.matchMedia(
  '(hover: hover) and (pointer: fine)',
).matches;
