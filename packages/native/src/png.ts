import { closeSync, openSync, readSync } from 'node:fs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Reads a PNG's dimensions from its header, without decoding it. Enough to
 * reject an icon of the wrong size before Xcode's asset compiler does, with a
 * clearer message.
 */
export const readPngSize = (
  file: string,
): { readonly width: number; readonly height: number } => {
  const header = Buffer.alloc(24);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  // The IHDR chunk always comes first: 8-byte signature, 4-byte length,
  // "IHDR", then width and height.
  if (
    !header.subarray(0, 8).equals(SIGNATURE) ||
    header.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error(`${file} is not a PNG file.`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};
