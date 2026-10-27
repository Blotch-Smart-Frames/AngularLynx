import { Injectable, computed, signal } from '@angular/core';

export type Message = {
  id: number;
  from: string;
  subject: string;
  body: string;
  read: boolean;
};

/**
 * The inbox's messages, shared by the Inbox screens and the tab bar's badge.
 */
@Injectable({ providedIn: 'root' })
export class Inbox {
  readonly #messages = signal<Message[]>([
    {
      id: 1,
      from: 'Ada',
      subject: 'Lunch on Friday?',
      body: 'There is a new place by the station. Noon works for me.',
      read: false,
    },
    {
      id: 2,
      from: 'Grace',
      subject: 'Release notes',
      body: 'The draft is ready for a read before we publish it.',
      read: false,
    },
    {
      id: 3,
      from: 'Linus',
      subject: 'Build fixed',
      body: 'The flaky test was a timezone. It passes everywhere now.',
      read: false,
    },
    {
      id: 4,
      from: 'Margaret',
      subject: 'Trip photos',
      body: 'Uploaded them to the shared album last night.',
      read: true,
    },
  ]);

  readonly messages = this.#messages.asReadonly();
  readonly unread = computed(
    () => this.#messages().filter((message) => !message.read).length,
  );

  find(id: number): Message | undefined {
    return this.#messages().find((message) => message.id === id);
  }

  markRead(id: number): void {
    this.#messages.update((messages) =>
      messages.map((message) =>
        message.id === id ? { ...message, read: true } : message,
      ),
    );
  }

  markAllRead(): void {
    this.#messages.update((messages) =>
      messages.map((message) => ({ ...message, read: true })),
    );
  }
}
