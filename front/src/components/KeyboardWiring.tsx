import { useEffect, useRef } from "react";
import { EMULATED } from "../lib/padmap";
import { previewKeyboard } from "../lib/keyboard-preview";
import type { Pad } from "../lib/saves";
import { keyLabel } from "../media/describe";
import type { KeyProfile } from "../media/pad";
import { PadMapView } from "./PadMap";

export function KeyboardWiring({
  profile,
  pad,
  layout,
  disabled,
}: {
  profile: KeyProfile;
  pad: Pad;
  layout: Map<string, string> | null;
  disabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current && !disabled) return previewKeyboard(root.current, profile, layout);
  }, [profile, pad, layout, disabled]);
  return (
    <div ref={root} className="n3-controller-pair n3-keyboard-wiring">
      <PadMapView map={EMULATED[pad]!} title="Depuis le clavier" note={EMULATED[pad]!.name} />
      <button
        type="button"
        className="n3-controller n3-keyboard-test"
        aria-label="Tester le clavier"
        disabled={disabled}
      >
        <strong>Ton clavier → la manette du jeu</strong>
        <span className="n3-keyboard-caps">
          {Object.keys(profile).map((code) => (
            <kbd key={code} data-code={code}>
              {keyLabel(code, layout)}
            </kbd>
          ))}
        </span>
        <output> Clique ici pour tester le clavier. </output>
        <span>Les appuis éclairent le dessin sans agir dans la partie.</span>
      </button>
    </div>
  );
}
