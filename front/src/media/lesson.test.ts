import { describe, expect, it } from "vitest";
import { Lesson, loudest, type Snapshot } from "./lesson";
import { readPad } from "./pad";

const rest = (): Snapshot => ({ buttons: Array(16).fill(0), axes: [0, 0, 0, 0, -1, -1] });
const pressing = (index: number): Snapshot => {
  const shot = rest();
  shot.buttons[index] = 1;
  return shot;
};

describe("learning a pad", () => {
  it("takes one press per question, and not the release too", () => {
    // The defect this pins was found by the player in three seconds: pressing A
    // took the counter from 1 to 3. A snapshot cannot show it; a sequence can.
    const lesson = new Lesson("adapter", rest());

    for (const [answered, index] of [1, 2, 5, 7].entries()) {
      lesson.feed(pressing(index)); // press
      lesson.feed(pressing(index)); // still held
      lesson.feed(rest()); // let go
      lesson.feed(rest()); // still resting
      expect(lesson.step).toBe(answered + 1);
    }
  });

  it("asks nothing new while a button is still held", () => {
    const lesson = new Lesson("adapter", rest());
    lesson.feed(pressing(3));
    const afterFirst = lesson.step;

    for (let frame = 0; frame < 10; frame++) lesson.feed(pressing(3));

    expect(lesson.step).toBe(afterFirst);
    expect(lesson.waiting).toBe(true);
  });

  it("keeps the axis rather than the button when a trigger moves both", () => {
    // A GameCube trigger clicks a button at the end of its travel. Keeping the
    // button would throw away every value between nothing and everything.
    const lesson = new Lesson("adapter", rest());
    for (let step = 0; step < 10; step++) lesson.skip(); // straight to the triggers
    for (let frame = 0; frame < 3; frame++) lesson.feed(rest());

    const both: Snapshot = { buttons: Array(16).fill(0), axes: [0, 0, 0, 0, 1, -1] };
    both.buttons[6] = 1;
    lesson.feed(both);

    expect(lesson.learned().triggers.L).toEqual({ axis: 4, rest: -1, full: 1 });
  });

  it("takes the direction the player pushed as the positive one", () => {
    const lesson = new Lesson("adapter", rest());
    for (let step = 0; step < 12; step++) lesson.skip();
    for (let frame = 0; frame < 3; frame++) lesson.feed(rest());

    // Asked for RIGHT, and this pad reports right as negative.
    lesson.feed({ buttons: Array(16).fill(0), axes: [-1, 0, 0, 0, -1, -1] });

    expect(lesson.learned().sticks.x).toEqual({ axis: 0, sign: -1 });
  });

  it("produces a profile a pad can be read through", () => {
    const lesson = new Lesson("adapter", rest());
    const answers: Array<Snapshot> = [];
    for (let index = 0; index < 12; index++) answers.push(pressing(index));
    for (const answer of answers) {
      lesson.feed(answer);
      lesson.feed(rest());
      lesson.feed(rest());
    }
    const profile = lesson.learned();

    const pad = {
      buttons: Array.from({ length: 16 }, (_, index) => ({
        pressed: index === 0,
        value: index === 0 ? 1 : 0,
        touched: index === 0,
      })),
      axes: [0, 0, 0, 0, -1, -1],
      id: "adapter",
      mapping: "" as GamepadMappingType,
      connected: true,
      index: 0,
      timestamp: 0,
      vibrationActuator: null,
    } as unknown as Gamepad;

    expect(readPad(pad, profile).buttons).toBe(1); // A, and nothing else
  });
});

describe("fondre deux instantanés du même modèle", () => {
  it("garde ce qui a le plus bougé, entrée par entrée", () => {
    const merged = loudest(
      { buttons: [0, 0.3, 0], axes: [0.1, -0.9] },
      { buttons: [1, 0, 0], axes: [-1, 0.2] },
    );
    expect(merged.buttons).toEqual([1, 0.3, 0]);
    expect(merged.axes).toEqual([-1, -0.9]);
  });

  // Le cas réel: un adaptateur GameCube expose quatre manettes, et trois
  // d'entre elles n'ont rien de branché. Une leçon qui ne regarderait que la
  // première ne pourrait jamais finir.
  it("laisse une manette silencieuse ne rien apporter", () => {
    const silent = { buttons: [0, 0, 0, 0], axes: [0, 0] };
    const pressed = { buttons: [0, 0, 1, 0], axes: [0, -0.8] };
    expect(loudest(silent, pressed)).toEqual(pressed);
    expect(loudest(pressed, silent)).toEqual(pressed);
  });

  it("supporte deux manettes qui n'annoncent pas le même nombre d'entrées", () => {
    expect(loudest({ buttons: [1], axes: [] }, { buttons: [0, 0.5], axes: [0.4] })).toEqual({
      buttons: [1, 0.5],
      axes: [0.4],
    });
  });
});
