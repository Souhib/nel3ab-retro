import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ keep: vi.fn() }));
vi.mock("../client", () => ({ keepBindings: api.keep }));

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  api.keep.mockReset();
});

it("conserve les changements refusés par le service au prochain semis", async () => {
  const bindings = await import("./bindings");
  await bindings.reconcile("one", { pads: {}, keys: {} });
  localStorage.setItem(bindings.KEYS_STORED, JSON.stringify({ active: "nouveau" }));
  api.keep.mockRejectedValue(new Error("offline"));
  bindings.push();
  await bindings.flushed();
  // Une nouvelle visite recharge le module; la copie non confirmée est sur disque.
  vi.resetModules();
  const next = await import("./bindings");
  await next.reconcile("one", { pads: {}, keys: { active: "ancien" } });
  expect(next.gather().keys).toEqual({ active: "nouveau" });
  expect(api.keep).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: { pads: {}, keys: { active: "nouveau" } } }),
  );
});

it("un semis sans modification en attente reçoit les changements de l'autre appareil", async () => {
  const b = await import("./bindings");
  localStorage.setItem(b.KEYS_STORED, JSON.stringify({ active: "local" }));
  await b.reconcile("one", { pads: {}, keys: { active: "ailleurs" } });
  expect(b.gather().keys).toEqual({ active: "ailleurs" });
  expect(api.keep).not.toHaveBeenCalled();
});

it("sérialise les envois et ne confirme pas une modification encore en attente", async () => {
  const b = await import("./bindings");
  await b.reconcile("one", { pads: {}, keys: {} });
  let release!: () => void;
  api.keep.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  api.keep.mockRejectedValue(new Error("offline"));
  localStorage.setItem(b.KEYS_STORED, JSON.stringify({ active: "un" }));
  b.push();
  await vi.waitFor(() => expect(api.keep).toHaveBeenCalledTimes(1));
  localStorage.setItem(b.KEYS_STORED, JSON.stringify({ active: "deux" }));
  b.push();
  expect(api.keep).toHaveBeenCalledTimes(1);
  release();
  await b.flushed();
  await b.reconcile("one", { pads: {}, keys: { active: "un" } });
  expect(b.gather().keys).toEqual({ active: "deux" });
});

it("ne publie pas les changements en attente sous une autre identité", async () => {
  const b = await import("./bindings");
  await b.reconcile("one", { pads: {}, keys: {} });
  api.keep.mockRejectedValue(new Error("offline"));
  localStorage.setItem(b.KEYS_STORED, JSON.stringify({ active: "privé" }));
  b.push();
  await b.flushed();
  api.keep.mockClear();
  await b.reconcile("two", { pads: {}, keys: { active: "autre" } });
  expect(api.keep).not.toHaveBeenCalled();
  expect(b.gather().keys).toEqual({ active: "autre" });
});

it("après confirmation le service redevient la référence du prochain chargement", async () => {
  const b = await import("./bindings");
  await b.reconcile("one", { pads: {}, keys: {} });
  api.keep.mockResolvedValue({});
  localStorage.setItem(b.KEYS_STORED, JSON.stringify({ active: "confirmé" }));
  b.push();
  await b.flushed();
  await b.reconcile("one", { pads: {}, keys: { active: "ailleurs" } });
  expect(b.gather().keys).toEqual({ active: "ailleurs" });
});

it("synchronise les profils Switch différés et les sépare entre identités", async () => {
  const b = await import("./bindings");
  await b.reconcile("alice", { pads: {}, keys: {}, switch: {} });
  api.keep.mockRejectedValue(new Error("offline"));
  const profiles = { named: { Tennis: { console: "switch" } } };
  b.saveSwitchBindings(JSON.stringify(profiles));
  await b.flushed();
  await b.reconcile("alice", { pads: {}, keys: {}, switch: { named: {} } });
  expect(b.gather().switch).toEqual(profiles);
  api.keep.mockClear();
  await b.reconcile("benoit", { pads: {}, keys: {}, switch: {} });
  expect(b.gather().switch).toBeUndefined();
  expect(api.keep).not.toHaveBeenCalled();
});

it("dit qu'une copie attend, et « Réessayer maintenant » renvoie le même instantané", async () => {
  const b = await import("./bindings");
  await b.reconcile("one", { pads: {}, keys: {} });
  expect(b.enAttente()).toBe(false);
  api.keep.mockRejectedValue(new Error("offline"));
  localStorage.setItem(b.KEYS_STORED, JSON.stringify({ active: "gardé" }));
  b.push();
  await b.flushed();
  expect(b.enAttente()).toBe(true);
  const envoye = api.keep.mock.calls.at(-1)?.[0].body;
  api.keep.mockReset();
  api.keep.mockResolvedValue(undefined);
  await b.reessayer();
  expect(api.keep).toHaveBeenCalledTimes(1);
  expect(api.keep.mock.calls[0]?.[0].body).toEqual(envoye);
  // Le jumeau : une fois accepté, plus rien n'attend.
  expect(b.enAttente()).toBe(false);
  await b.reessayer();
  expect(api.keep).toHaveBeenCalledTimes(1);
});

it("une copie d'une autre identité n'est pas « en attente » pour celle-ci", async () => {
  const b = await import("./bindings");
  await b.reconcile("one", { pads: {}, keys: {} });
  api.keep.mockRejectedValue(new Error("offline"));
  b.push();
  await b.flushed();
  expect(b.enAttente("one")).toBe(true);
  expect(b.enAttente("deux")).toBe(false);
  expect(b.enAttente(null)).toBe(false);
});
