/**
 * La jaquette d'un jeu, telle que son disque la porte.
 *
 * Chaque disque GameCube contient un fichier `opening.bnr`: une image de 96 par
 * 32 dessinée par l'éditeur, et à côté le nom long du jeu, son studio et une
 * phrase de présentation. Le worker la lit et la sert à `/art/<index>.png`.
 *
 * # Trois choses que la forme décide
 *
 * **Ce n'est pas un carré.** L'image fait trois de large pour un de haut, et
 * c'est cette proportion qui est reprise partout: les menus n'ont plus une seule
 * case carrée. La hauteur n'est donc jamais donnée, elle se déduit.
 *
 * **Les pixels restent des pixels.** `image-rendering: pixelated` parce qu'une
 * image de 96 pixels agrandie deux ou trois fois est floue si on la lisse, et
 * nette si on ne la lisse pas. Sur un projet qui s'appelle rétro, un gros pixel
 * est un choix; un bord flou est un défaut.
 *
 * **Il y a un fond noir derrière.** La plupart de ces images ont un fond
 * transparent: elles ont été dessinées pour le menu de la console, qui était
 * sombre. Sans ce fond, un logo blanc sur un menu clair disparaît.
 *
 * Quand le disque n'a rien donné, la bande reste, avec le nom écrit dedans. La
 * forme ne change pas selon qu'un jeu a une image ou non, sinon une rangée de
 * jeux devient une rangée de hauteurs différentes.
 */
import { cn } from "../lib/cn";

/** L'image d'origine, en pixels. Tous les disques, sans exception. */
const NATIVE = { width: 96, height: 32 };

export function Art({
  index,
  name,
  has,
  width,
  className,
}: {
  /** Sa place dans la bibliothèque, qui est la seule façon de la demander. */
  index: number;
  /** Ce qu'on écrit quand il n'y a pas d'image. */
  name: string;
  /** Ce que le worker a dit: il en sert une, ou non. */
  has: boolean;
  /** La largeur voulue. La hauteur en découle et n'est jamais passée. */
  width: number;
  className?: string;
}) {
  const height = (width * NATIVE.height) / NATIVE.width;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden",
        className,
      )}
      style={{ width, height, background: "#0b0b0f" }}
    >
      {has ? (
        <img
          src={`/art/${index}.png`}
          width={width}
          height={height}
          alt=""
          className="block"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span
          className="truncate px-2 text-center text-white/55"
          style={{ fontSize: Math.max(9, height * 0.28) }}
        >
          {name}
        </span>
      )}
    </span>
  );
}
