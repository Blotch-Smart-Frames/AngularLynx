export type TicketedEvent = {
  readonly id: string;
  readonly title: string;
  readonly venue: string;
  readonly color: string;
};

export const EVENTS: readonly TicketedEvent[] = [
  {
    id: 'jazz-night',
    title: 'Jazz Night',
    venue: 'Blue Room, Friday 9 pm',
    color: '#1d4ed8',
  },
  {
    id: 'film-club',
    title: 'Film Club',
    venue: 'Picture House, Sunday 7 pm',
    color: '#b91c1c',
  },
  {
    id: 'poetry-slam',
    title: 'Poetry Slam',
    venue: 'The Loft, Thursday 8 pm',
    color: '#15803d',
  },
];
