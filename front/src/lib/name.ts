/**
 * The name this browser plays under.
 *
 * There is no account and no password: the room is private and shared with
 * people already on the network, so the name exists so a seat can say "Souhib"
 * rather than "player 2" (ADR D12). It is kept in this browser so the second
 * visit does not ask again.
 */
export const NAME_MAX = 24;

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
