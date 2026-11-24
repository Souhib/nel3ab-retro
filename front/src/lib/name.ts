/**
 * The name this browser plays under.
 *
 * There is no account and no password: the room is private and shared with
 * people already on the network, so the name exists so a seat can say "Souhib"
 * rather than "player 2" (ADR D12). It is kept in this browser so the second
 * visit does not ask again.
 */
export const NAME_MAX = 24;

/** Le nom qu'un champ a reçu, sans ses espaces de bord et borné à
 * `NAME_MAX`, ou `null` quand il n'y a rien à garder : le champ le refuse
 * alors avec sa raison (`ChampNom`), au lieu d'un bouton grisé muet. */
export function verifierNom(tape: string): string | null {
  const nom = tape.trim().slice(0, NAME_MAX);
  return nom === "" ? null : nom;
}

const REMEMBERED = "nel3ab:name";

export function rememberedName(): string {
  try {
    return localStorage.getItem(REMEMBERED) ?? "";
  } catch {
    // A browser with storage refused still gets to play; it just asks each time.
    return "";
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(REMEMBERED, name);
  } catch {
    /* see above */
  }
}

/** Forgets it, for the "this is not me" button on the lobby screen. */
export function forgetName(): void {
  try {
    localStorage.removeItem(REMEMBERED);
  } catch {
    /* see above */
  }
}
