import { ArtichokeAPI } from "./api";
import { Callback, EventHandler } from "./events";
import { Logger } from "./logger";
import { createMessage, Message } from "./message";
import { roomEvents } from "./protocol/events/room-events";
import { ID } from "./protocol/protocol";
import * as proto from "./protocol/protocol";
import * as wireEntities from "./protocol/wire-entities";
import { randomUUID, TransferFunction, UUID } from "./utils";

export namespace roomType {
  export enum RoomType {
    GROUP,
    DIRECT,
    BUSINESS,
  }

  export function isDirect(room: Room): room is DirectRoom {
    return room.roomType === RoomType.DIRECT;
  }

  export function isGroup(room: Room): room is GroupRoom {
    return room.roomType === RoomType.GROUP;
  }

  export function isBusiness(room: Room): room is BusinessRoom {
    return room.roomType === RoomType.BUSINESS;
  }
}

export abstract class Room implements wireEntities.Room {
  protected readonly uuid: UUID = randomUUID();

  public id: proto.ID;
  public name: string;
  public created: proto.Timestamp;
  public users: Array<proto.ID>;
  public direct: boolean;
  public orgId: proto.ID;
  public marks: { [type: string]: proto.Timestamp };

  private log: Logger;
  protected events: EventHandler;
  protected api: ArtichokeAPI;

  protected onTextMessageCallback: Callback<roomEvents.MessageSent>;
  protected onCustomCallbacks: { [tag: string]: Callback<roomEvents.CustomMessageSent> };

  public abstract readonly roomType: roomType.RoomType;

  constructor(room: wireEntities.Room, log: Logger, events: EventHandler, api: ArtichokeAPI) {
    this.id = room.id;
    this.name = room.name;
    this.created = room.created;
    this.users = room.users;
    this.direct = room.direct;
    this.orgId = room.orgId;
    this.marks = room.marks;
    this.log = log;
    this.events = events;
    this.api = api;
    this.onCustomCallbacks = {};
    this.onTextMessageCallback = (m: roomEvents.MessageSent) => {
      // Do nothing.
    };
    this.defineCallbacks();
  }

  protected defineCallbacks() {
    this.events.onConcreteEvent(roomEvents.MessageSent.tag, this.id, this.uuid, (e: roomEvents.MessageSent) => {
      this.onTextMessageCallback(e);
    });
  }

  getLatestMessages(count?: number, filter?: proto.HistoryFilter): Promise<proto.Paginated<Message>> {
    return this.doGetHistory(this.api.getRoomHistoryLast(this.id, count || 100, filter));
  }

  getMessages(offset: number, limit: number, filter?: proto.HistoryFilter): Promise<proto.Paginated<Message>> {
    return this.doGetHistory(this.api.getRoomHistoryPage(this.id, offset, limit, filter));
  }

  private doGetHistory(p: Promise<proto.Paginated<wireEntities.Message>>) {
    return this.wrapPagination(p, (m: Message) => {
      return createMessage(m, this.log, this.events, this.api);
    });
  }

  private wrapPagination<T, U>(p: Promise<proto.Paginated<T>>, f: TransferFunction<T, U>): Promise<proto.Paginated<U>> {
    return p.then((t) => {
      return {
        offset: t.offset,
        limit: t.limit,
        items: t.items.map(f)
      };
    });
  }

  getUsers(): Promise<Array<proto.ID>> {
    return this.api.getRoomUsers(this.id);
  }

  getMark(user: ID): Promise<number> {
    // NOTE No need to retrieve the list if it's cached here.
    return Promise.resolve((this.marks && this.marks[user]) || 0);
  }

  setMark(timestamp: proto.Timestamp): Promise<void> {
    if (!this.marks) {
      this.marks = {};
    }
    this.marks[this.api.sessionId] = timestamp;
    return this.api.setMark(this.id, timestamp);
  }

  send(message: string): Promise<Message> {
    return this.api.sendMessage(this.id, message).then((m) => {
      return createMessage(m, this.log, this.events, this.api);
    });
  }

  sendCustom(message: string, tag: string, context: proto.Context): Promise<Message> {
    return this.api.sendCustom(this.id, message, tag, context).then((m) => {
      return createMessage(m, this.log, this.events, this.api);
    });
  }

  indicateTyping(): Promise<void> {
    return this.api.sendTyping(this.id);
  }

  onMarked(callback: Callback<roomEvents.MarkSent>) {
    this.events.onConcreteEvent(roomEvents.MarkSent.tag, this.id, this.uuid, (mark: roomEvents.MarkSent) => {
      if (!this.marks) {
        this.marks = {};
      }
      this.marks[mark.authorId] = mark.timestamp;
      callback(mark);
    });
  }

  onMessage(callback: Callback<roomEvents.MessageSent>) {
    this.onTextMessageCallback = callback;
  }

  onCustom(tag: string, callback: Callback<roomEvents.CustomMessageSent>) {
    this.onCustomCallbacks[tag] = callback;
  }

  onTyping(callback: Callback<roomEvents.TypingSent>) {
    this.events.onConcreteEvent(roomEvents.TypingSent.tag, this.id, this.uuid, callback);
  }
}

export class DirectRoom extends Room {
  public readonly roomType: roomType.RoomType = roomType.RoomType.DIRECT;
}

export class GroupRoom extends Room {
  public readonly roomType: roomType.RoomType = roomType.RoomType.GROUP;

  private onJoinedCallback: Callback<roomEvents.Joined>;
  private onLeftCallback: Callback<roomEvents.Left>;
  private onInvitedCallback: Callback<roomEvents.Invited>;

  constructor(room: wireEntities.Room, log: Logger, events: EventHandler, api: ArtichokeAPI) {
    super(room, log, events, api);

    this.onLeftCallback = (e: roomEvents.Left) => { /* nothing */ };
    this.onJoinedCallback = (e: roomEvents.Joined) => { /* nothing */ };
    this.onInvitedCallback = (e: roomEvents.Invited) => { /* nothing */ };
  }

  protected defineCallbacks() {
    this.events.onConcreteEvent(roomEvents.Joined.tag, this.id, this.uuid, (e: roomEvents.Joined) => {
      this.users.push(e.authorId);
      this.onJoinedCallback(e);
    });
    this.events.onConcreteEvent(roomEvents.Left.tag, this.id, this.uuid, (e: roomEvents.Left) => {
      this.users = this.users.filter((u) => u !== e.authorId);
      this.onLeftCallback(e);
    });
    this.events.onConcreteEvent(roomEvents.Invited.tag, this.id, this.uuid, (e: roomEvents.Invited) => {
      this.onInvitedCallback(e);
    });
    this.events.onConcreteEvent(roomEvents.MessageSent.tag, this.id, this.uuid, (e: roomEvents.MessageSent) => {
      this.onTextMessageCallback(e);
    });
    // TODO: CustomMessage
    // this.events.onConcreteEvent(roomEvents.MessageSent.tag, this.id, this.uuid, (e: roomEvents.MessageSent) => {
    //   switch (e.tag) {
    // default:
    //   if (e.message.tag in this.onCustomCallbacks) {
    //     this.onCustomCallbacks[e.message.tag](e.message);
    //   } else {
    //     this.events.notify(error("Invalid event", e));
    //   }
    // }
    // });
  }

  getUsers(): Promise<Array<proto.ID>> {
    // NOTE No need to retrieve the list if it's cached here.
    return Promise.resolve(this.users);
  }

  join(): Promise<void> {
    return this.api.joinRoom(this.id);
  }

  leave(): Promise<void> {
    return this.api.leaveRoom(this.id);
  }

  invite(user: proto.ID): Promise<void> {
    return this.api.inviteToRoom(this.id, user);
  }

  onJoined(callback: Callback<roomEvents.Joined>) {
    this.onJoinedCallback = callback;
  }

  onLeft(callback: Callback<roomEvents.Left>) {
    this.onLeftCallback = callback;
  }

  onInvited(callback: Callback<roomEvents.Invited>) {
    this.onInvitedCallback = callback;
  }
}

export class BusinessRoom extends GroupRoom {
  public readonly roomType: roomType.RoomType = roomType.RoomType.BUSINESS;
}

export function createRoom(room: wireEntities.Room, log: Logger, events: EventHandler, api: ArtichokeAPI): Room {
  if (room.direct) {
    return new DirectRoom(room, log, events, api);
  } else if (room.orgId) {
    return new BusinessRoom(room, log, events, api);
  } else {
    return new GroupRoom(room, log, events, api);
  }
}
