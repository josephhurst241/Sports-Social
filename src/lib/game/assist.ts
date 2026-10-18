// Aim assist. Within `snap` of the ideal line (golf: straight at the cup;
// bowling: at the headpin) the aim is drawn `pull` of the way to it; past
// that it is shifted by the same amount, so it never jumps. A player aiming
// roughly right lands on the line, and anyone aiming deliberately wide still
// goes wide.

/** How strongly the aim is drawn to the line inside the snap: 0 not at all, 1 onto it. */
export const AIM_PULL = 0.8;

/** The assisted offset from the ideal line, for an aimed offset (radians). */
export function assistAim(offset: number, snap: number, pull = AIM_PULL) {
  if (Math.abs(offset) <= snap) return offset * (1 - pull);
  return offset - Math.sign(offset) * snap * pull;
}
