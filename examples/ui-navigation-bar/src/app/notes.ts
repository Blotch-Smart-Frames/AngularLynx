export type Note = {
  readonly id: number;
  readonly title: string;
  readonly excerpt: string;
  /** A color for the note's card, as a CSS gradient. */
  readonly cover: string;
};

const GRADIENTS = [
  'linear-gradient(135deg, #f97316, #db2777)',
  'linear-gradient(135deg, #22d3ee, #6366f1)',
  'linear-gradient(135deg, #a3e635, #059669)',
  'linear-gradient(135deg, #facc15, #ea580c)',
  'linear-gradient(135deg, #c084fc, #4f46e5)',
];

const TITLES = [
  ['Trip to Kyoto', 'Temples to see, and where to eat near the market.'],
  ['Groceries', 'Oat milk, lemons, rice, basil, coffee beans.'],
  ['Book club', 'Chapters 4 to 7, and questions for Thursday.'],
  ['Garden plan', 'Tomatoes by the fence, herbs in the window box.'],
  ['Gift ideas', 'A film camera, the blue scarf, concert tickets.'],
  ['Recipes', 'Miso soup, focaccia, and the green curry again.'],
];

/** Enough notes to scroll under the bars. */
export const NOTES: readonly Note[] = Array.from({ length: 18 }, (_, i) => ({
  id: i + 1,
  title: TITLES[i % TITLES.length][0],
  excerpt: TITLES[i % TITLES.length][1],
  cover: GRADIENTS[i % GRADIENTS.length],
}));
