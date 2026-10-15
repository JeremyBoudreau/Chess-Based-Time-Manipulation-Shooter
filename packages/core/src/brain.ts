import type { PieceAction, PieceState, WorldState } from "./types";

/**
 * Default enemy brain:
 * 1. If the king's square is attackable → attack it.
 * 2. Else move to the quiet move whose centre is closest to the king, if it gets closer than now.
 * 3. Else move randomly, weighting moves that point towards the king more heavily.
 * 4. No legal moves → wait.
 */
export const decidePieceAction = (
  _world: WorldState,
  _piece: PieceState,
  _rng: () => number
): PieceAction => {
  throw new Error("not implemented");
};
