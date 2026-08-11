/**
 * Opcode format for Lynx SSR snapshot serialization.
 * Mirrors the opcode types used by React Lynx's renderToOpcodes system —
 * the Lynx engine expects this format from ssrEncode().
 */
export const enum Opcode {
  Begin = 0,
  End = 1,
  Attr = 2,
  Text = 3,
}

/**
 * Builds a flat opcode array in the format expected by ssrEncode().
 * The array is a packed sequence of [opcode, ...args] tuples concatenated
 * without delimiters. The consumer (buildElementQueueFromOpcodes) advances
 * by the fixed arg count for each opcode type.
 * Example: [Begin, "0", "view", Attr, "style", "color:red", End]
 */
export class OpcodeRecorder {
  readonly opcodes: unknown[] = [];
  #nextSsrId = 0;

  nextId(): string {
    return String(this.#nextSsrId++);
  }

  begin(ssrId: string, tag: string): void {
    this.opcodes.push(Opcode.Begin, ssrId, tag);
  }

  end(): void {
    this.opcodes.push(Opcode.End);
  }

  attr(key: string, value: unknown): void {
    this.opcodes.push(Opcode.Attr, key, value);
  }

  text(ssrId: string, content: string): void {
    this.opcodes.push(Opcode.Text, ssrId, content);
  }
}
