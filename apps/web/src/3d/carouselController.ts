/** Imperative state shared between the HTML carousel controls and the render loop (no three.js imports). */
export interface CarouselController {
  rotation: number;
  velocity: number;
  /** Slot to settle on (set by arrows / keyboard / click). */
  target: number | null;
  dragging: boolean;
  /** The current/last pointer gesture moved the ring (so its click must not open a video). */
  dragMoved: boolean;
  /** performance.now() of the last user interaction (pauses the idle spin). */
  lastInteraction: number;
  slotCount: number;
  step: number;
}

export function createCarouselController(): CarouselController {
  return { rotation: 0, velocity: 0, target: null, dragging: false, dragMoved: false, lastInteraction: 0, slotCount: 1, step: 1 };
}
