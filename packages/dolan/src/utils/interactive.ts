/**
 * Whether anyone can answer a question: stdin is a terminal. In CI, a script
 * or an AI agent it isn't, and clack's prompts wait for input that never
 * comes. The commands used to hang there until stdin closed, then exit 0
 * having done nothing. Without a terminal, each command asks nothing and takes
 * each question's default instead, or exits 1 and names the option to pass
 * when that default would cancel the run.
 */
export const isInteractive = (): boolean => process.stdin.isTTY === true;
