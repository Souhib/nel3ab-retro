/**
 * La jaquette d'un jeu, en étiquette de cartouche, servie localement par le
 * worker à `/art/<index>.png`.
 *
 * # Trois choses que la forme décide
 *
 * **Ce n'est pas un carré.** L'étiquette fait trois de large pour un de haut,
 * la proportion des bannières GameCube (96 par 32, `opening.bnr`). Une
 * illustration Switch ou Xbox 360 garde ses propres proportions dedans, sans
 * découpage ni étirement.
 *
 * **Les pixels restent des pixels.** `image-rendering: pixelated` pour une
 * bannière, parce qu'une image de 96 pixels agrandie deux ou trois fois est
 * floue si on la lisse. Une illustration lissée (`smoothArt`) garde le
 * lissage du navigateur : l'effet « nettes » ne la touche jamais.
 *
 * **Il y a un fond noir derrière.** La plupart de ces images ont un fond
 * transparent, dessinées pour un menu de console sombre.
 *
 * Quand le disque n'a rien donné, l'étiquette est en pointillé avec l'icône
 * de manette, et rien d'écrit dedans (B9, 24 novembre 2026) : le nom se lit
 * sous la cartouche, en 16 px, au lieu d'un nom en 9 px dans la bande.
 */
import { under } from "../lib/base";
import { smoothArt } from "../lib/consoles";
import { iconePixelSVG } from "../retro/icones";

/** Le cadre hérité des bannières GameCube. */
const NATIVE = { width: 96, height: 32 };

export function Art({
  index,
  has,
  width,
  console,
}: {
  /** Sa place dans la bibliothèque, qui est la seule façon de la demander. */
  index: number;
  /** Ce que le worker a dit : il en sert une, ou non. */
  has: boolean;
  /** La largeur voulue. La hauteur en découle et n'est jamais passée. */
  width: number;
  /** Une illustration lissée garde le lissage du navigateur. */
  console?: string;
}) {
  const height = (width * NATIVE.height) / NATIVE.width;
  return (
    <span className="n3-art" data-vide={has ? undefined : ""} style={{ width, height }}>
      {has ? (
        <img
          src={under(`/art/${index}.png`).toString()}
          width={width}
          height={height}
          alt=""
          style={{ imageRendering: smoothArt(console) ? "auto" : "pixelated" }}
        />
      ) : (
        <span
          className="n3-art-icone"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: iconePixelSVG("manette") }}
        />
      )}
    </span>
  );
}
