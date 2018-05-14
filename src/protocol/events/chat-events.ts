import { DomainEvent } from "./domain-event";

export namespace chatEvents {

  export abstract class ChatEvent implements DomainEvent {
    protected constructor(eventId: string, tag: string) {
      this.eventId = eventId;
      this.tag = tag;
    }

    readonly eventId: string;
    readonly tag: string;
    readonly __discriminator__ = "domainEvent";
  }

  export interface NormalizedEvent {
    readonly id: string;
    readonly authorId: string;
    readonly channelId: string;
    readonly tag: string;
    readonly data: Object;
    readonly timestamp: number;
  }

  export class Received extends ChatEvent {
    static readonly tag = "chat_received";

    constructor(eventId: string, message: NormalizedEvent, ref?: string) {
      super(eventId, Received.tag);

      this.message = message;
      this.ref = ref;
    }

    readonly message: NormalizedEvent;
    readonly ref: string | undefined;
  }

}