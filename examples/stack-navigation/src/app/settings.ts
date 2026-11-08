/** A row on a section's screen, which opens a screen of its own. */
export type Item = { readonly id: string; readonly title: string };

/** A row on the first screen, which opens a section. */
export type Section = {
  readonly id: string;
  readonly title: string;
  /** The Tailwind class of the square behind the row's initial. */
  readonly color: string;
  readonly items: readonly Item[];
};

export const SECTIONS: readonly Section[] = [
  {
    id: 'general',
    title: 'General',
    color: 'bg-zinc-500',
    items: [
      { id: 'about', title: 'About' },
      { id: 'software-update', title: 'Software Update' },
      { id: 'storage', title: 'Storage' },
    ],
  },
  {
    id: 'display',
    title: 'Display & Brightness',
    color: 'bg-blue-500',
    items: [
      { id: 'brightness', title: 'Brightness' },
      { id: 'text-size', title: 'Text Size' },
      { id: 'night-shift', title: 'Night Shift' },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy & Security',
    color: 'bg-indigo-500',
    items: [
      { id: 'location', title: 'Location Services' },
      { id: 'camera', title: 'Camera' },
      { id: 'photos', title: 'Photos' },
    ],
  },
  {
    id: 'sounds',
    title: 'Sounds & Haptics',
    color: 'bg-rose-500',
    items: [
      { id: 'ringtone', title: 'Ringtone' },
      { id: 'text-tone', title: 'Text Tone' },
      { id: 'keyboard', title: 'Keyboard Feedback' },
    ],
  },
];

/** The section with `id`, or the first for one that isn't there. */
export const sectionOf = (id: string): Section =>
  SECTIONS.find((section) => section.id === id) ?? SECTIONS[0]!;
