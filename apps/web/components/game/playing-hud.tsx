import type { HudSnapshot } from "@buckshot/engine";
import { AmmoDisplay } from "./ammo-display";
import { Crosshair } from "./crosshair";
import { StatusReadout } from "./status-readout";
import { ThreatWarning } from "./vignettes";

/**
 * The in-run HUD: reticle, ammo, time/king readout and the threat warning. Hidden once the run
 * ends so the death camera / victory chant own the screen.
 */
export function PlayingHud({
  active,
  hud,
}: {
  /** Playing and pointer-locked (not under the pause overlay). */
  readonly active: boolean;
  readonly hud: HudSnapshot;
}) {
  return (
    <>
      <ThreatWarning active={active && hud.playerThreatened} />
      <Crosshair
        capacity={hud.capacity}
        fireReady={hud.fireReady}
        loaded={hud.loaded}
        reloadProgress={hud.reloadProgress}
      />
      <AmmoDisplay
        capacity={hud.capacity}
        loaded={hud.loaded}
        pickupsOnBoard={hud.pickupsOnBoard}
        reloadProgress={hud.reloadProgress}
        reserve={hud.reserve}
        reserveMax={hud.reserveMax}
      />
      <StatusReadout
        gameTime={hud.gameTime}
        muted={hud.muted}
        sprinting={hud.sprinting}
        timeScale={hud.timeScale}
        whiteKingHp={hud.whiteKingHp}
        whiteKingMaxHp={hud.whiteKingMaxHp}
      />
    </>
  );
}
