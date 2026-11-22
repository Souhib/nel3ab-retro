/**
 * Les deux boutons de la colonne qui portent une décision.
 *
 * Le premier, « ça saccade », a menti pendant une journée: il se réarmait au
 * bout de trois secondes alors que le salon refuse un deuxième repère avant
 * vingt. Il répondait donc « noté, l'instant est marqué » sur un signalement
 * que personne n'écrivait. Trouvé à la main pendant l'audit du 18 août 2026,
 * parce qu'aucun test ne regardait ce composant.
 *
 * Le second propose le format réduit. Il n'a encore trompé personne, et c'est
 * l'intérêt d'écrire son test le même jour que lui.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GardeSignalement } from "../lib/garde-signalement";
import { Sidebar } from "./Sidebar";

function show(overrides: Record<string, unknown> = {}) {
  const props = {
    idle: false,
    mode: "normal" as const,
    onMode: vi.fn(),
    people: [],
    players: 4,
    busy: [false, false, false, false],
    names: new Map<number, string>(),
    mine: null,
    shot: null,
    volume: 0.7,
    onVolume: vi.fn(),
    onSound: vi.fn(),
    seated: false,
    onWatch: vi.fn(),
    onPlay: vi.fn(),
    onLeave: vi.fn(),
    onComplain: vi.fn().mockResolvedValue(undefined),
    garde: new GardeSignalement(),
    onTakeHalf: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

it("ne décrit pas la salle au repos comme une connexion vidéo coupée", async () => {
  const shot = {
    padOnly: false,
    sound: { state: "suspended" },
    video: { connected: false, picture: { width: 0, height: 0 } },
  };
  await act(async () => {
    show({ idle: true, shot });
  });
  expect(document.querySelector("#connection-diagnostic")).toBeNull();
});

it("décrit une coupure quand un jeu devrait envoyer de la vidéo", async () => {
  const shot = {
    padOnly: false,
    sound: { state: "suspended" },
    video: { connected: false, picture: { width: 0, height: 0 } },
  };
  await act(async () => {
    show({ idle: false, shot });
  });
  expect(document.querySelector("#connection-diagnostic")).toHaveTextContent(
    "reconnexion en cours",
  );
});

describe("le bouton « ça saccade »", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("pose un repère et le dit", async () => {
    const { onComplain } = show();

    await act(async () => {
      fireEvent.click(screen.getByText("signaler un problème"));
    });

    expect(onComplain).toHaveBeenCalledTimes(1);
    expect(screen.getByText("signalement enregistré")).toBeInTheDocument();
  });

  it("reste désarmé aussi longtemps que le salon refuse", async () => {
    // Le défaut exact: à quatre secondes le bouton se réarmait, le clic
    // suivant répondait « noté » et le salon jetait le repère. Un contrôle qui
    // annonce ce qu'il n'a pas fait est pire qu'un contrôle absent.
    show();
    const button = screen.getByText("signaler un problème");

    await act(async () => {
      fireEvent.click(button);
    });
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByText("déjà signalé")).toBeDisabled();
  });

  it("se réarme quand le salon accepterait de nouveau", async () => {
    // Le jumeau: un bouton désarmé pour toujours satisferait le test d'au-dessus
    // en rendant le signalement possible une seule fois par visite.
    show();

    await act(async () => {
      fireEvent.click(screen.getByText("signaler un problème"));
    });
    act(() => vi.advanceTimersByTime(21_000));

    expect(screen.getByText("signaler un problème")).not.toBeDisabled();
  });
});

describe("la proposition de format réduit", () => {
  it("n'est plus dans la colonne: elle vit sur l'image, visible aussi au téléphone (E2)", () => {
    // La colonne est repliée d'office sur un téléphone: une proposition qui n'y
    // vivait que là n'était vue par personne, et le journal la disait
    // « proposée » quand même. Elle est maintenant dans `EtatSalle`.
    show();
    expect(document.querySelector("#rough")).toBeNull();
    expect(screen.queryByText("passer en réduit")).toBeNull();
  });
});

describe("les personnes dans la salle", () => {
  it("liste les spectateurs et indique le chef même sans manette", () => {
    show({
      people: [
        { name: "Souhib", id: "one", seat: null, seat_pending: false },
        { name: "Yassine", id: "two", seat: 2 },
      ],
      owner: { name: "Souhib", id: "one", seat: null },
      names: new Map([[2, "Yassine"]]),
      busy: [false, true, false, false],
    });
    expect(screen.getByText("Souhib")).toBeInTheDocument();
    expect(screen.getByLabelText("chef de la salle")).toBeInTheDocument();
    expect(screen.queryByText(/occupée|occupé/)).not.toBeInTheDocument();
  });
  it("le droit administrateur n'invente pas un chef sur une place libre", () => {
    show({ owner: { name: "Souhib", id: "one", seat: 2 }, busy: [false, false, false, false] });
    expect(screen.queryByLabelText("chef de la salle")).not.toBeInTheDocument();
  });
  // Le chef se reconnaît par son repère depuis que l'état ne porte plus
  // d'adresse. Deux repères nuls ne désignent pas la même personne: sans la
  // garde, `null === null` couronnerait chaque anonyme.
  it("ne couronne ni un autre repère ni un anonyme", () => {
    show({
      people: [
        { name: "Kim", id: null, seat: null, seat_pending: false },
        { name: "Nora", id: "two", seat: null, seat_pending: false },
      ],
      owner: { name: "Kim", id: null, seat: null },
    });
    expect(screen.getByLabelText("spectateurs")).toHaveTextContent("Kim");
    expect(screen.queryByLabelText("chef de la salle")).not.toBeInTheDocument();
  });
});

it("ne présente pas un joueur sans attribution confirmée comme un spectateur ou une place vide", () => {
  show({
    people: [
      { name: "Alice", id: "alice", seat: null, seat_pending: true },
      { name: "Benoit", id: "benoit", seat: null, seat_pending: false },
    ],
    busy: [true, false, false, false],
  });
  expect(screen.getAllByText("personne")).toHaveLength(3);
  expect(screen.getByLabelText("spectateurs")).toHaveTextContent("Benoit");
  expect(screen.getByLabelText("spectateurs")).not.toHaveTextContent("Alice");
  expect(screen.getByLabelText("attributions en attente")).toHaveTextContent("Alice");
  expect(screen.getByLabelText("attributions en attente")).not.toHaveTextContent("Benoit");
  expect(screen.queryByText(/occupé/)).not.toBeInTheDocument();
});

it("attend l'accusé du salon, puis montre le refus sans annoncer un enregistrement", async () => {
  let refuse: (error: Error) => void = () => {};
  show({
    onComplain: () =>
      new Promise<void>((_, reject) => {
        refuse = reject;
      }),
  });
  fireEvent.click(screen.getByText("signaler un problème"));
  expect(screen.getByText("envoi…")).toBeDisabled();
  expect(screen.queryByText("signalement enregistré")).not.toBeInTheDocument();
  await act(async () => {
    refuse(new Error("Salon indisponible"));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Salon indisponible");
  expect(screen.getByText("signaler un problème")).not.toBeDisabled();
  expect(screen.queryByText("signalement enregistré")).not.toBeInTheDocument();
});

it("rappelle de sauvegarder quand un jeu tourne", () => {
  show({ idle: false });

  expect(screen.getByText(/sauvegarder/i)).toBeTruthy();
});

it("ne rappelle rien quand la salle est sur son menu", () => {
  // Le jumeau: un rappel affiché en permanence cesse d'être lu, et il n'y a
  // rien à sauvegarder quand aucun jeu ne tourne.
  show({ idle: true });

  expect(screen.queryByText(/sauvegarder/i)).toBeNull();
});

it("ramène à la liste des salles, à la racine du domaine", () => {
  // Une adresse ABSOLUE: le salon est le même pour toutes les salles et vit à
  // la racine, alors que la page, elle, est servie sous `/r/<n>/`. Relative,
  // ce lien mènerait à `/r/1/`, c'est-à-dire nulle part ailleurs qu'ici.
  show();

  const lien = screen.getByText("les salles");

  expect(lien.getAttribute("href")).toBe("/");
});

it("laisse « quitter » rendre la place plutôt que changer de page", () => {
  // Le jumeau: les deux boutons voisins ne font pas la même chose, et confondre
  // les deux ferait perdre sa manette à qui voulait juste voir la liste.
  const props = show();

  fireEvent.click(screen.getByText("quitter"));

  expect(props.onLeave).toHaveBeenCalled();
  expect(screen.getByText("les salles").getAttribute("href")).toBe("/");
});

describe("ce que la colonne dit d'elle-même (audit A11Y-10, A11Y-11, T02)", () => {
  it("dit quel mode est choisi, et pas seulement par la bordure", () => {
    show({ mode: "details" });
    expect(document.querySelector("#mode-details")?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#mode-normal")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("nomme le bouton qui replie la colonne autrement que « ✕ »", () => {
    show({ onFold: vi.fn() });
    expect(screen.getByRole("button", { name: "replier la colonne" })).toBeInTheDocument();
  });

  it("nomme la glissière du volume", () => {
    // Au repos: le diagnostic de la liaison, qui lit la vidéo, n'est pas monté.
    show({ idle: true, shot: { sound: { state: "running" }, padOnly: false } });
    expect(screen.getByRole("slider", { name: "volume" })).toBeInTheDocument();
  });

  it("ne promet Échap qu'au clavier", () => {
    show({ appareil: "clavier" });
    expect(screen.getByText(/Échap ouvre le menu/)).toBeInTheDocument();
  });

  it("au doigt, parle du bouton « menu » et pas d'une touche absente", () => {
    show({ appareil: "tactile" });
    expect(screen.queryByText(/Échap/)).not.toBeInTheDocument();
    expect(screen.getByText(/« menu » ouvre le menu/)).toBeInTheDocument();
  });
});
