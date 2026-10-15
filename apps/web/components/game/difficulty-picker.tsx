import { cn } from "@buckshot/ui/lib/utils";
import { useCallback, useId } from "react";
import { PIECE_GLYPHS } from "@/lib/pieces";
import {
  armySizeLabel,
  type DifficultyOption,
  findDifficulty,
} from "./difficulty";

export interface DifficultyPickerProps {
  readonly difficulties: readonly DifficultyOption[];
  /** The engine is still loading: there is no board to rebuild yet. */
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
  readonly selectedId: string;
}

/** "♔ ♕ ♖×2 …": the army at a glance, with the kinds spelled out for screen readers. */
function ArmyGlyphs({ option }: { readonly option: DifficultyOption }) {
  return (
    <ul
      aria-label={`${option.name} army`}
      className="flex flex-wrap justify-center gap-x-3 text-[#0A0C0E] text-xl tracking-widest"
    >
      {option.pieces.map(({ count, kind }) => (
        <li className="whitespace-nowrap" key={kind}>
          <span aria-hidden="true">{PIECE_GLYPHS[kind]}</span>
          <span className="sr-only">
            {count} {kind}
            {count > 1 ? "s" : ""}
          </span>
          {count > 1 ? (
            <span aria-hidden="true" className="ml-0.5 font-mono text-xs">
              ×{count}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One segment of the picker: the difficulty's name over its army size. */
function DifficultySegment({
  detailsId,
  disabled,
  onSelect,
  option,
  pressed,
}: {
  /** The details block describing the pressed segment (its glyphs and description). */
  readonly detailsId: string;
  readonly disabled: boolean;
  readonly onSelect: (id: string) => void;
  readonly option: DifficultyOption;
  readonly pressed: boolean;
}) {
  const select = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  return (
    <button
      aria-describedby={pressed ? detailsId : undefined}
      aria-pressed={pressed}
      className={cn(
        "flex min-h-16 flex-col items-center justify-center gap-1 border-[#0A0C0E] border-l px-2 py-2.5 transition-colors first:border-l-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-[#E80C0C] focus-visible:outline-offset-2 disabled:cursor-wait",
        pressed
          ? "bg-[#0A0C0E] text-white"
          : "text-[#0A0C0E] hover:bg-[rgba(10,12,14,0.08)]"
      )}
      disabled={disabled}
      onClick={select}
      type="button"
    >
      <span className="font-black text-lg uppercase leading-none tracking-[0.2em]">
        {option.name}
      </span>
      <span
        className={cn(
          "font-mono text-[10px] uppercase leading-tight tracking-[0.15em]",
          pressed ? "text-white/75" : "text-[rgba(10,12,14,0.6)]"
        )}
      >
        {armySizeLabel(option)}
      </span>
    </button>
  );
}

/**
 * Easy / Medium / Hard as a segmented row of toggle buttons (native buttons, so Tab, Enter and
 * Space work; `aria-pressed` marks the pick). Picking rebuilds the board behind the overlay, so
 * the player sees the army they are about to face before they click to play.
 */
export function DifficultyPicker({
  difficulties,
  disabled,
  onSelect,
  selectedId,
}: DifficultyPickerProps) {
  const detailsId = useId();
  const selected = findDifficulty(difficulties, selectedId);
  return (
    <fieldset className="flex w-full max-w-xl flex-col items-center gap-3">
      <legend className="mb-3 w-full text-center font-mono text-[11px] text-[rgba(10,12,14,0.55)] uppercase tracking-[0.45em]">
        Difficulty
      </legend>
      <div className="grid w-full grid-cols-3 border border-[#0A0C0E] bg-white/60">
        {difficulties.map((option) => (
          <DifficultySegment
            detailsId={detailsId}
            disabled={disabled}
            key={option.id}
            onSelect={onSelect}
            option={option}
            pressed={option.id === selectedId}
          />
        ))}
      </div>
      {selected ? (
        <div
          aria-live="polite"
          className="flex flex-col items-center gap-1.5"
          id={detailsId}
        >
          <ArmyGlyphs option={selected} />
          <p className="text-[13px] text-[rgba(10,12,14,0.62)]">
            {selected.description}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

/** The difficulty of the run in progress, for the pause screen (no switching mid-run). */
export function DifficultyLabel({
  option,
}: {
  readonly option: DifficultyOption;
}) {
  return (
    <p className="font-mono text-[11px] text-[rgba(10,12,14,0.62)] uppercase tracking-[0.3em]">
      Difficulty{" "}
      <span className="font-black text-[#0A0C0E]">{option.name}</span> ·{" "}
      {armySizeLabel(option)}
    </p>
  );
}
