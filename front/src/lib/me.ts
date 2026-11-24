/**
 * Qui je suis, et comment je veux qu'on m'appelle.
 *
 * Deux moitiés qui ne se ressemblent pas. L'**adresse** vient du proxy Tailscale,
 * elle est vérifiée et on n'y touche pas. Le **pseudo** est à la personne: elle
 * le choisit, elle en change quand elle veut, et il est gardé par le service
 * plutôt que par le navigateur, ce qui est tout l'intérêt d'avoir une identité.
 *
 * Sans proxy devant (développement local, ou la page servie par le worker seul),
 * `login` est nul et la page retombe sur un prénom rangé dans le navigateur,
 * comme avant. Une salle sans identité marche encore; elle ne sait juste pas qui
 * est qui.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readMe, renameMe, type Me } from "../client";

export const ME_KEY = ["me"] as const;

async function readIdentity(): Promise<Me | null> {
  try {
    const answer = (await readMe({ throwOnError: true })).data;
    // The worker serves HTML for unknown paths, including /api/me without a lobby.
    return typeof answer?.name === "string" ? answer : null;
  } catch {
    return null;
  }
}

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: readIdentity,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Retry a missing identity when opening the save menu, before it offers a new game.
 * A nickname does not establish an account. A verified account needs no extra request.
 * On 2026-11-11 the browser regression observes one request per opening while
 * unidentified, none for an identified account, and no periodic polling. */
export function useMenuIdentity(open: boolean): boolean {
  const client = useQueryClient();
  const known = client.getQueryData<Me | null>(ME_KEY)?.login;
  return useQuery({
    queryKey: ME_KEY,
    queryFn: readIdentity,
    enabled: open && !known,
    staleTime: 0,
    refetchOnWindowFocus: false,
  }).isFetching;
}

/** Redemande une identité qui manque, à l'ouverture d'une fiche de jeu au
 * repos. Le rayonnage d'une salle sans jeu reste à l'écran : `useMenuIdentity`
 * ne se rallume donc jamais, et une adresse arrivée après la page ne se
 * voyait qu'en rechargeant (save-options.mjs, 24 novembre 2026). Un compte
 * déjà vérifié ne coûte aucune requête. */
export function useRelireIdentite(): () => void {
  const client = useQueryClient();
  return () => {
    if (client.getQueryData<Me | null>(ME_KEY)?.login) return;
    void client.refetchQueries({ queryKey: ME_KEY, exact: true });
  };
}

/** Change son pseudo, et prévient le salon pour que la salle le voie tout de
 * suite plutôt qu'à la prochaine reconnexion. */
export function useRename(announce: (name: string) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<Me> =>
      (await renameMe({ body: { name }, throwOnError: true })).data,
    onSuccess: (me) => {
      client.setQueryData(ME_KEY, me);
      announce(me.name);
      // Le salon pousse le nom confirmé. Un GET concurrent pourrait rétablir
      // celui qui précédait l’événement de renommage.
    },
  });
}
