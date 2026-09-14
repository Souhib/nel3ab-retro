/**
 * L'appareil dit à l'arrivée: ce qu'il garde, et ce qu'il borne.
 */
import { describe, expect, it } from "vitest";
import { AGENT_MAX, device, type DeviceSource } from "./device";

function source(nav: Partial<DeviceSource["navigator"]> = {}): DeviceSource {
  return {
    navigator: {
      hardwareConcurrency: 8,
      maxTouchPoints: 5,
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128.0 Mobile",
      deviceMemory: 8,
      connection: { effectiveType: "4g" },
      ...nav,
    },
    screen: { width: 412, height: 915 },
    innerWidth: 412,
    innerHeight: 780,
    devicePixelRatio: 2.625,
  };
}

describe("l'appareil d'une personne", () => {
  it("dit l'écran, la machine et le réseau d'un téléphone", () => {
    expect(device(source())).toEqual({
      écran: "412x915",
      fenêtre: "412x780",
      densité: 2.63,
      cœurs: 8,
      mémoire: 8,
      tactile: 5,
      réseau: "4g",
      navigateur: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128.0 Mobile",
    });
  });

  it("dit « inconnu » par un nul quand le navigateur ne donne pas la mémoire ni le réseau", () => {
    // Le jumeau: Firefox et Safari n'ont ni `deviceMemory` ni `connection`. Un
    // zéro y dirait « aucune mémoire », ce qui est faux et se lirait comme vrai.
    const firefox = device(source({ deviceMemory: undefined, connection: undefined }));

    expect(firefox.mémoire).toBeNull();
    expect(firefox.réseau).toBeNull();
  });

  it("coupe un identifiant de navigateur trop long", () => {
    const long = device(source({ userAgent: "x".repeat(1000) }));

    expect(long.navigateur).toHaveLength(AGENT_MAX);
    // Et un appareil entier tient dans la borne du salon, 512 octets.
    expect(new TextEncoder().encode(JSON.stringify(long)).length).toBeLessThan(512);
  });
});
