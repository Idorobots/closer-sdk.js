import { ArtichokeAPI } from "./api";
import { Callback, EventHandler } from "./events";
import { Logger } from "./logger";
import { createMessage, Message } from "./message";
import { CallMessage, CallActiveDevice, CallEnd } from "./protocol/events";
import * as proto from "./protocol/protocol";
import * as wireEntities from "./protocol/wire-entities";
import { actionTypes, error, Event, eventTypes } from "./protocol/wire-events";
import {
  createRTCPool,
  HackedRTCOfferOptions as RTCOfferOptions,
  RemoteStreamCallback,
  RTCAnswerOptions,
  RTCConfig,
  RTCConnectionConstraints,
  RTCPool
} from "./rtc";

export namespace callType {
  export enum CallType {
    DIRECT,
    GROUP,
    BUSINESS,
  }

  export function isDirect(call: Call): call is DirectCall {
    return call.callType === CallType.DIRECT;
  }

  export function isGroup(call: Call): call is GroupCall {
    return call.callType === CallType.GROUP;
  }

  export function isBusiness(call: Call): call is BusinessCall {
    return call.callType === CallType.BUSINESS;
  }
}

export abstract class Call implements wireEntities.Call {
  public id: proto.ID;
  public created: proto.Timestamp;
  public ended: proto.Timestamp;
  public users: Array<proto.ID>;
  public direct: boolean;
  public orgId: proto.ID;
  public externalId: string;

  protected api: ArtichokeAPI;
  protected events: EventHandler<Event>;

  private log: Logger;
  protected pool: RTCPool;
  private onActiveDeviceCallback: Callback<CallActiveDevice>;
  private onLeftCallback: Callback<Message>;
  private onOfflineCallback: Callback<Message>;
  private onOnlineCallback: Callback<Message>;
  private onJoinedCallback: Callback<Message>;
  private onTransferredCallback: Callback<Message>;
  protected onInvitedCallback: Callback<Message>;
  private onAnsweredCallback: Callback<Message>;
  private onRejectedCallback: Callback<Message>;

  public abstract readonly callType: callType.CallType;

  constructor(call: wireEntities.Call, config: RTCConfig, log: Logger, events: EventHandler<Event>,
              api: ArtichokeAPI, stream?: MediaStream) {
    this.id = call.id;
    this.created = call.created;
    this.ended = call.ended;
    this.users = call.users;
    this.direct = call.direct;
    this.orgId = call.orgId;
    this.externalId = call.externalId;

    this.log = log;
    this.events = events;
    this.api = api;

    this.pool = createRTCPool(this.id, config, log, events, api);

    if (stream) {
      this.addStream(stream);
    }

    // By default do nothing:
    this.onActiveDeviceCallback = (e: CallActiveDevice) => {
      // Do nothing.
    };

    this.events.onConcreteEvent(eventTypes.CALL_ACTIVE_DEVICE, this.id, (e: CallActiveDevice) => {
      this.pool.destroyAll();
      this.onActiveDeviceCallback(e);
    });

    let nop = (a: Message) => {
      // Do nothing.
    };

    this.onLeftCallback = nop;
    this.onOfflineCallback = nop;
    this.onOnlineCallback = nop;
    this.onJoinedCallback = nop;
    this.onTransferredCallback = nop;
    this.onInvitedCallback = nop;
    this.onAnsweredCallback = nop;
    this.onRejectedCallback = nop;

    this.events.onConcreteEvent(eventTypes.CALL_MESSAGE, this.id, (e: CallMessage) => {
      switch (e.message.tag) {
        case actionTypes.CALL_JOINED:
          this.users.push(e.message.user);
          this.pool.create(e.message.user);
          this.onJoinedCallback(e.message);
          break;

        case actionTypes.CALL_TRANSFERRED:
          this.pool.destroy(e.message.user);
          this.pool.create(e.message.user);
          this.onTransferredCallback(e.message);
          break;

        case actionTypes.CALL_LEFT:
          this.users = this.users.filter((u) => u !== e.message.user);
          this.pool.destroy(e.message.user);
          this.onLeftCallback(e.message);
          break;

        case actionTypes.CALL_OFFLINE:
          this.onOfflineCallback(e.message);
          break;

        case actionTypes.CALL_ONLINE:
          this.onOnlineCallback(e.message);
          break;

        case actionTypes.CALL_INVITED:
          this.onInvitedCallback(e.message);
          break;

        case actionTypes.CALL_ANSWERED:
          this.onAnsweredCallback(e.message);
          break;

        case actionTypes.CALL_REJECTED:
          this.onRejectedCallback(e.message);
          break;

        default:
          this.events.notify(error("Invalid event", e));
      }
    });
  }

  addStream(stream: MediaStream) {
    stream.getTracks().forEach((track) => this.addTrack(track, stream));
  }

  removeStream(stream: MediaStream) {
    stream.getTracks().forEach((track) => this.removeTrack(track));
  }

  addTrack(track: MediaStreamTrack, stream?: MediaStream) {
    this.pool.addTrack(track, stream);
  }

  removeTrack(track: MediaStreamTrack) {
    this.pool.removeTrack(track);
  }

  onRemoteStream(callback: RemoteStreamCallback) {
    this.pool.onRemoteStream(callback);
  }

  setAnswerOptions(options: RTCAnswerOptions) {
    this.pool.setAnswerOptions(options);
  }

  setOfferOptions(options: RTCOfferOptions) {
    this.pool.setOfferOptions(options);
  }

  setConnectionConstraints(constraints: RTCConnectionConstraints) {
    this.pool.setConnectionConstraints(constraints);
  }

  getUsers(): Promise<Array<proto.ID>> {
    return Promise.resolve(this.users);
  }

  getMessages(): Promise<Array<Message>> {
    return this.api.getCallHistory(this.id).then((msgs) => msgs.map((m) => {
      return createMessage(m, this.log, this.events, this.api);
    }));
  }

  answer(stream: MediaStream): Promise<void> {
    this.addStream(stream);
    return this.api.answerCall(this.id);
  }

  reject(reason: string): Promise<void> {
    return this.api.rejectCall(this.id, reason);
  }

  pull(stream: MediaStream): Promise<void> {
    this.addStream(stream);
    return this.api.pullCall(this.id);
  }

  leave(reason: string): Promise<void> {
    this.pool.destroyAll();
    return this.api.leaveCall(this.id, reason);
  }

  onAnswered(callback: Callback<Message>) {
    this.onAnsweredCallback = callback;
  }

  onRejected(callback: Callback<Message>) {
    this.onRejectedCallback = callback;
  }

  onLeft(callback: Callback<Message>) {
    this.onLeftCallback = callback;
  }

  onOffline(callback: Callback<Message>) {
    this.onOfflineCallback = callback;
  }

  onOnline(callback: Callback<Message>) {
    this.onOnlineCallback = callback;
  }

  onJoined(callback: Callback<Message>) {
    this.onJoinedCallback = callback;
  }

  onTransferred(callback: Callback<Message>) {
    this.onTransferredCallback = callback;
  }

  onActiveDevice(callback: Callback<CallActiveDevice>) {
    this.onActiveDeviceCallback = callback;
  }

  onEnd(callback: Callback<CallEnd>) {
    this.events.onConcreteEvent(eventTypes.CALL_END, this.id, (e: CallEnd) => {
      this.ended = e.timestamp;
      callback(e);
    });
  }
}

export class DirectCall extends Call {
  public readonly callType: callType.CallType = callType.CallType.DIRECT;
}

export class GroupCall extends Call {
  public readonly callType: callType.CallType = callType.CallType.GROUP;

  invite(user: proto.ID): Promise<void> {
    return this.api.inviteToCall(this.id, user);
  }

  join(stream: MediaStream): Promise<void> {
    this.addStream(stream);
    return this.api.joinCall(this.id);
  }

  onInvited(callback: Callback<Message>) {
    this.onInvitedCallback = callback;
  }
}

export class BusinessCall extends GroupCall {
  public readonly callType: callType.CallType = callType.CallType.BUSINESS;
}

export function createCall(call: wireEntities.Call, config: RTCConfig, log: Logger, events: EventHandler<Event>,
                           api: ArtichokeAPI, stream?: MediaStream): Call {
  if (call.direct) {
    return new DirectCall(call, config, log, events, api, stream);
  } else if (call.orgId) {
    return new BusinessCall(call, config, log, events, api, stream);
  } else {
    return new GroupCall(call, config, log, events, api, stream);
  }
}
