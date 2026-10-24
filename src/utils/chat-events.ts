import { PartnerStatus } from '../types.ts';

export interface PartnerStatusChangeEvent {
  partnerId: string;
  status: PartnerStatus;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type StatusListener = (status: PartnerStatus, event: PartnerStatusChangeEvent) => void;

class ChatEventManager {
  private listeners: Map<string, Set<StatusListener>> = new Map();
  private statusMap: Map<string, PartnerStatus> = new Map();

  /**
   * Subscribes a listener to status change events for a specific partner.
   * Returns an unsubscribe function.
   */
  public subscribeToPartnerStatus(partnerId: string, listener: StatusListener): () => void {
    if (!this.listeners.has(partnerId)) {
      this.listeners.set(partnerId, new Set());
    }
    this.listeners.get(partnerId)!.add(listener);

    // Call listener immediately with current status if available
    const currentStatus = this.getStatus(partnerId);
    listener(currentStatus, {
      partnerId,
      status: currentStatus,
      timestamp: Date.now(),
    });

    return () => {
      const set = this.listeners.get(partnerId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(partnerId);
        }
      }
    };
  }

  /**
   * Emits a status change event for a partner and notifies all subscribed listeners.
   */
  public emitPartnerStatus(
    partnerId: string,
    status: PartnerStatus,
    metadata?: Record<string, unknown>
  ): PartnerStatusChangeEvent {
    this.statusMap.set(partnerId, status);
    const event: PartnerStatusChangeEvent = {
      partnerId,
      status,
      timestamp: Date.now(),
      metadata,
    };

    const listenersForPartner = this.listeners.get(partnerId);
    if (listenersForPartner) {
      listenersForPartner.forEach((listener) => {
        try {
          listener(status, event);
        } catch (err) {
          console.error(`Error in partner status listener for ${partnerId}:`, err);
        }
      });
    }

    return event;
  }

  /**
   * Gets the current status of a partner. Defaults to 'online'.
   */
  public getStatus(partnerId: string): PartnerStatus {
    return this.statusMap.get(partnerId) || 'online';
  }

  /**
   * Simulates a typing sequence where the partner switches to 'typing' status
   * and automatically reverts to 'online' after the specified duration.
   */
  public simulateTypingBurst(
    partnerId: string,
    durationMs: number = 2500,
    onComplete?: () => void
  ): () => void {
    this.emitPartnerStatus(partnerId, 'typing');

    const timeout = setTimeout(() => {
      this.emitPartnerStatus(partnerId, 'online');
      if (onComplete) {
        onComplete();
      }
    }, durationMs);

    return () => {
      clearTimeout(timeout);
      this.emitPartnerStatus(partnerId, 'online');
    };
  }

  /**
   * Clears all listeners and reset statuses (useful for test resets).
   */
  public clear(): void {
    this.listeners.clear();
    this.statusMap.clear();
  }
}

export const chatEventManager = new ChatEventManager();

if (typeof window !== 'undefined') {
  (window as unknown as { __chatEventManager: ChatEventManager }).__chatEventManager = chatEventManager;
}
