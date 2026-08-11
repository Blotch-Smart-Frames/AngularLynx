import type { ElementRef } from '../types/lynx';
import { Opcode } from './opcodes';

/**
 * Parses the opcode stream produced by ssrEncode and maps each ssrId to its
 * native ElementRef via the refs map from __GetTemplateParts(). Returns an
 * ordered queue that LynxHydrateDocument consumes — one ElementRef per
 * createElement/createText/createComment call during Angular's bootstrap.
 */
export const buildElementQueueFromOpcodes = (
  opcodes: unknown[],
  refsMap: Record<string, ElementRef>,
): ElementRef[] => {
  const queue: ElementRef[] = [];

  let i = 0;
  while (i < opcodes.length) {
    const opcode = opcodes[i];
    switch (opcode) {
      case Opcode.Begin: {
        // Begin: [opcode, ssrId, tag]
        const ssrId = opcodes[i + 1] as string;
        const ref = refsMap[ssrId];
        if (ref) {
          queue.push(ref);
        }
        i += 3;
        break;
      }
      case Opcode.End: {
        i += 1;
        break;
      }
      case Opcode.Attr: {
        // Attr: [opcode, key, value]
        i += 3;
        break;
      }
      case Opcode.Text: {
        // Text: [opcode, ssrId, content]
        const ssrId = opcodes[i + 1] as string;
        const ref = refsMap[ssrId];
        if (ref) {
          queue.push(ref);
        }
        i += 3;
        break;
      }
      default:
        i += 1;
    }
  }

  return queue;
};
