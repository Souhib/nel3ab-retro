/** Only controller normalization differs between consoles. InputStream retains
 * the socket, seat, reconnect, keyboard release and rumble lifecycle. */
export interface InputSource {
  readonly pad: Gamepad | null;
  poll(held: ReadonlySet<string>, pads: readonly (Gamepad | null)[]): void;
  frame(port: number, neutral: boolean): Uint8Array<ArrayBuffer>;
  releaseBeforePlay(): void;
  handlesKey(code: string): boolean;
  captureKey(event: KeyboardEvent): boolean;
}
