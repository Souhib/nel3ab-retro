/**
 * A name, and nothing else.
 *
 * The video does not start until a name is given. Not because anything checks
 * it, but because a picture running behind a form is a picture nobody is
 * watching, decoded on a machine somebody else is playing on.
 */
import { useState } from "react";
import { NAME_MAX, rememberName } from "../lib/name";

export function Entrance({ onName }: { onName: (name: string) => void }) {
  const [typed, setTyped] = useState("");
  const name = typed.trim().slice(0, NAME_MAX);

  return (
    <div className="flex h-full items-center justify-center p-8">
      <form
        className="flex w-full max-w-sm flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name) return;
          rememberName(name);
          onName(name);
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-indigo">
            nel3ab
          </span>
          <h1 className="text-[22px] font-medium tracking-tight">Qui joue&nbsp;?</h1>
          <p className="text-[12px] text-muted">
            Quatre manettes, une machine, une image. Ton nom sert à ce qu'une place puisse dire qui
            l'occupe, et à rien d'autre.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <input
            id="name"
            autoFocus
            maxLength={NAME_MAX}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="ton nom"
            className="border border-rule bg-panel px-3 py-2 text-[14px] text-text outline-none placeholder:text-faint focus:border-indigo"
          />
          <button
            type="submit"
            disabled={!name}
            className="border border-indigo bg-indigo/10 px-3 py-2 text-[13px] text-indigo transition-colors hover:bg-indigo/20 disabled:opacity-30"
          >
            entrer
          </button>
        </div>
      </form>
    </div>
  );
}
