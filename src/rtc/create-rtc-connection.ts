import { Logger } from '../logger';
import { ArtichokeAPI } from '../apis/artichoke-api';
import { ID } from '../protocol/protocol';
import { EventHandler } from '../events/event-handler';
import { RTCConfig } from './rtc-config';
import { RTCAnswerOptions } from './rtc-answer-options';
import { HackedRTCOfferOptions } from './hacked-rtc-offer-options';
import { RTCConnection } from './rtc-connection';

export const createRTCConnection = (call: ID, peer: ID, config: RTCConfig, log: Logger, events: EventHandler,
                                    api: ArtichokeAPI, answerOptions?: RTCAnswerOptions,
                                    offerOptions?: HackedRTCOfferOptions): RTCConnection =>
    new RTCConnection(call, peer, config, log, events, api, answerOptions, offerOptions);
