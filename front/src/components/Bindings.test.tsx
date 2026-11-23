import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { InputStream } from "../media/input";
import { Bindings } from "./Bindings";

const rien = () => {};
const monter = (patch: Partial<ReturnType<InputStream["state"]>>) => {
  const state = { ...new InputStream(() => "", rien).state(), ...patch };
  return render(
    <Bindings
      console="gc"
      held={0}
      state={state}
      onPickKeys={rien}
      onNewKeys={rien}
      onForgetKeys={rien}
      onCapture={rien}
      onUse={rien}
      onCancel={rien}
      onLearn={rien}
      onSkip={rien}
      onResetPad={rien}
      onResetKeys={rien}
      onClose={rien}
    />,
  ).container;
};

it("dit la fin du pas à pas avec les commandes passées, nommées", () => {
  const page = monter({
    lessonResult: { retenues: 14, passees: ["B", "START"], garde: "avant" },
  });
  expect(page.querySelector("[data-fin-lecon]")?.textContent).toBe(
    "14 commandes réglées. Tu as passé B et Start : elles gardent leur réglage d'avant. Tu peux les changer dans la liste.",
  );
  // Le jumeau : sans pas à pas fini, rien n'est dit.
  expect(monter({}).querySelector("[data-fin-lecon]")).toBeNull();
});

it("dit qu'un pas à pas débranché s'est arrêté sans rien écrire", () => {
  const page = monter({ suspendu: { etape: 5, total: 16, id: "manette" } });
  expect(page.querySelector("[data-suspendu]")?.textContent).toContain("arrêté à l'étape 5");
  expect(monter({}).querySelector("[data-suspendu]")).toBeNull();
});
