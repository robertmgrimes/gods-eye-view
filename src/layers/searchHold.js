/**
 * Keep a camera opened from Find cameras on the layer until the next view
 * load includes it. A reload that has not reached the camera yet must not
 * drop the open still.
 * @param {{ byId: Map<string, object>, records: object[], searchHold?: object }} state
 * @param {object | null | undefined} record
 */
export function rememberSearchCamera(state, record) {
  if (!record?.id) return false;
  state.searchHold = record;
  if (!state.byId.has(record.id)) {
    state.byId.set(record.id, record);
    if (!state.records.some((row) => row?.id === record.id))
      state.records = state.records.concat(record);
  }
  return true;
}

/**
 * Put the held camera back after a view reload replaces the pin set.
 * @param {{ byId: Map<string, object>, records: object[], searchHold?: object }} state
 */
export function keepSearchHold(state) {
  const held = state.searchHold;
  if (!held?.id || state.byId.has(held.id)) return;
  state.byId.set(held.id, held);
  state.records = state.records.concat(held);
}

/** Screen point for a still opened from the search list. */
export function revealScreen(viewer) {
  const rect = viewer?.scene?.canvas?.getBoundingClientRect?.();
  if (!rect) return { x: 24, y: 80 };
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + Math.min(160, rect.height / 3),
  };
}
