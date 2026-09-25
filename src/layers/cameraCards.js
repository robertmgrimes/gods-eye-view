/** One camera card at a time. Opening another closes the one already on screen. */
const open = new Set();

export function claimCameraCard(card) {
  for (const other of [...open]) {
    if (other !== card) other.hide?.();
  }
  open.add(card);
}

export function releaseCameraCard(card) {
  open.delete(card);
}
