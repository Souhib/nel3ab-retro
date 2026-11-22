import type { InputState } from "../media/input";
import { identify } from "../media/families";

export type PlugNotice = { title: string; detail: string; configure: boolean };

/** Une manette branchée qui attend ses correspondances: ni disposition
 * standard, ni profil. La même règle sert l'avis de branchement, qui s'efface
 * au bout de cinq secondes, et l'entrée « touches et manettes » du menu, qui
 * le rappelle ensuite (audit P12). */
export function manetteAConfigurer(
  state: Pick<InputState, "padId" | "padLayout" | "profile">,
): boolean {
  return Boolean(state.padId) && state.padLayout !== "standard" && !state.profile;
}
/** Follows the device model, not the browser index, which changes on replug. */
export class PlugHistory {
  private seen = new Set<string>();
  private previous: string | null = null;
  private key = "";
  private notice: PlugNotice | null = null;
  observe(state: Pick<InputState, "padId" | "padLayout" | "profile">): PlugNotice | null {
    const key = JSON.stringify([state.padId, state.padLayout, Boolean(state.profile)]);
    if (key === this.key) return this.notice;
    this.key = key;
    const id = state.padId;
    if (id) {
      const returning = id !== this.previous && this.seen.has(id);
      this.seen.add(id);
      const configure = manetteAConfigurer(state);
      this.notice = {
        title: `${identify(id, state.padLayout ?? "").name} ${returning ? "reconnectée" : "connectée"}`,
        detail: state.profile
          ? "Ton profil est chargé. Vérifie les commandes avant de reprendre."
          : configure
            ? "Cet adaptateur a besoin de correspondances. Configure-le puis teste les boutons et les sticks."
            : "Disposition standard reconnue. Tu peux vérifier ou personnaliser les commandes.",
        configure,
      };
    } else if (this.previous) {
      this.notice = {
        title: "Manette déconnectée",
        detail:
          "Ta place reste réservée. Rebranche-la puis appuie sur un bouton. Le clavier reste disponible.",
        configure: false,
      };
    }
    this.previous = id;
    return this.notice;
  }
}
