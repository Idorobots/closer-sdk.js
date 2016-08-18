import { RTCConnection } from "./rtc";
import { nop } from "./utils";

const tmpUser = "FIXME Actually dispatch the user...";

class Call {
    constructor(call, artichoke) {
        this.id = call.id;
        this.users = call.users;
        this.log = artichoke.log;
        this.artichoke = artichoke;

        this.connections = {};

        // By default do nothing:
        this.onRemoteStreamCallback = nop;
    }

    offer(stream) {
        let _this = this;
        return new Promise(function(resolve, reject) {
            let rtc = _this._createRTC(tmpUser);
            rtc.addStream(stream);

            rtc.createOffer()
                .then((offer) => resolve(_this.artichoke.socket.sendOffer(_this.id, offer)))
                .catch(reject);
        });
    }

    answer(offer, stream) {
        let _this = this;

        return new Promise(function(resolve, reject) {
            let rtc = _this._createRTC(tmpUser);
            rtc.addStream(stream);

            rtc.setRemoteDescription("offer", offer.sdp, function(candidate) {
                _this.artichoke.socket.sendCandidate(_this.id, candidate);
            });

            rtc.createAnswer()
                .then((answer) => resolve(_this.artichoke.socket.answerCall(_this.id, answer)))
                .catch(reject);
        });
    }

    reject() {
        this.hangup("rejected");
    }

    hangup(reason) {
        this.artichoke.socket.hangupCall(this.id, reason);
        Object.values(this.connections).forEach((c) => c.disconnect());
        this.connections = {};
    }

    onRemoteStream(callback) {
        this.onRemoteStreamCallback = callback;
        let _this = this;
        Object.keys(this.connections).forEach(function(k) {
            _this.connections[k].onRemoteStream(_this._makeStreamCallback(k, callback));
        });
    }

    onAnswer(callback) {
        this._defineCallback("call_answer", callback);
    }

    onOffer(callback) {
        this._defineCallback("call_offer", callback);
    }

    onHangup(callback) {
        this._defineCallback("call_hangup", callback);
    }

    _makeStreamCallback(user, callback) {
        return function(stream) {
            return callback(user, stream);
        };
    }

    _createRTC(user) {
        let rtc = new RTCConnection(this.artichoke.config);

        rtc.onRemoteStream(this._makeStreamCallback(user, this.onRemoteStreamCallback));

        let _this = this;
        // FIXME These need to be dispatched per RTC connection.
        this._defineCallback("call_candidate", (m) => rtc.addICECandidate(m.candidate));
        this._defineCallback("call_hangup", function(m) {
            rtc.disconnect();
            delete _this.connections[user];
        });
        this._defineCallback("call_answer", function(m) {
            rtc.setRemoteDescription("answer", m.sdp, function(candidate) {
                _this.artichoke.socket.sendCandidate(m.id, candidate);
            });
        });

        this.connections[user] = rtc;
        return rtc;
    }

    _defineCallback(type, callback) {
        // FIXME It would be way better to store a hash of rooms and pick the relevant callback directly.
        let _this = this;
        this.artichoke.onEvent(type, function(msg) {
            if (msg.id === _this.id) {
                _this.log("Running callback " + type + " for call: " + _this.id);
                callback(msg);
            }
        });
    }
}

export function createCall(call, artichoke) {
    return new Call(call, artichoke);
}
