export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PickerPlacement {
  /** Put the picker under the message instead of above it (no room above). */
  below: boolean;
  /** Horizontal nudge in px so the picker stays inside the chat area. */
  shiftX: number;
}

const GAP = 6;
const EDGE = 8;

/**
 * Decides where a floating reaction picker sits relative to its message: above by default, below when it
 * would be cut off at the top, and slid sideways so it never leaves the chat area. All values are viewport px.
 */
export function computePickerPlacement(
  anchor: Box,
  picker: { width: number; height: number },
  bounds: Box,
  alignRight: boolean
): PickerPlacement {
  const below = anchor.top - picker.height - GAP < bounds.top;
  const desiredLeft = alignRight ? anchor.right - picker.width : anchor.left;
  const maxLeft = bounds.right - picker.width - EDGE;
  const minLeft = bounds.left + EDGE;
  // On a screen narrower than the picker, favour the start edge.
  const clamped = maxLeft < minLeft ? minLeft : Math.min(Math.max(desiredLeft, minLeft), maxLeft);
  return { below, shiftX: Math.round(clamped - desiredLeft) };
}
