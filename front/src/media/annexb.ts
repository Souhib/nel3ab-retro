/**
 * Just enough H.264 to know what a picture is.
 *
 * The page needs two facts about an access unit: whether it can start a decoder
 * (an IDR), and what profile to configure one with. Everything else is the
 * decoder's business.
 */

/** Where the payload of the first NAL of `kind` starts, or null. */
export function findNal(bytes: Uint8Array, kind: number): number | null {
  // Walked rather than assumed at a fixed offset: parameter sets only precede
  // the picture on IDR access units, so the offset is not a constant.
  for (let index = 0; index + 3 < bytes.length; index++) {
    if (bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 1) {
      if ((bytes[index + 3] & 0x1f) === kind) return index + 3;
    }
  }
  return null;
}

/** Whether this access unit can start a decoder. */
export const hasIdr = (bytes: Uint8Array): boolean => findNal(bytes, 5) !== null;

/** The codec string for `VideoDecoder.configure`, read out of the SPS. */
export function codecOf(bytes: Uint8Array): string | null {
  const sps = findNal(bytes, 7);
  if (sps === null) return null;
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `avc1.${hex(bytes[sps + 1])}${hex(bytes[sps + 2])}${hex(bytes[sps + 3])}`;
}
