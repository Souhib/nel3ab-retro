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
import { ROOM_KEY } from "./room";

export const ME_KEY = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<Me | null> => {
      try {
        const answer = (await readMe({ throwOnError: true })).data;
        // Vérifié plutôt que cru: le worker répond la PAGE à tout chemin qu'il
        // ne connaît pas, donc une salle servie sans plan de contrôle rend du
        // HTML avec un code 200. Sans ce test, la page croirait avoir une
        // identité vide au lieu de savoir qu'elle n'en a pas.
        return typeof answer?.name === "string" ? answer : null;
      } catch {
        return null;
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
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
      void client.invalidateQueries({ queryKey: ROOM_KEY });
    },
  });
}
