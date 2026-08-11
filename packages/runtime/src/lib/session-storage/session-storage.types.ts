/**
 * Tracks an active session storage subscription so it can be cleaned up.
 */
export type SessionStorageSubscription = {
  readonly key: string;
  readonly listenerId: number;
};
