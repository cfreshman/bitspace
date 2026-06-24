export const CLIENT_EVENTS = Object.freeze({
  input: "client:input",
  setName: "client:set-name",
  talk: "client:talk",
  upgrade: "client:upgrade",
  buildWall: "client:build-wall",
  heartbeat: "client:heartbeat",
  ready: "client:ready",
  joinNamedRoom: "client:join-named-room",
  resume: "client:resume",
  start: "client:start",
  leave: "client:leave",
  voiceJoin: "client:voice-join",
  voiceLeave: "client:voice-leave",
  voiceSignal: "client:voice-signal"
});

export const SERVER_EVENTS = Object.freeze({
  welcome: "server:welcome",
  room: "server:room",
  asteroid: "server:asteroid",
  asteroidUpdate: "server:asteroid-update",
  lobby: "server:lobby",
  snapshot: "server:snapshot",
  notice: "server:notice",
  beep: "server:beep",
  voicePeers: "server:voice-peers",
  voicePeerJoined: "server:voice-peer-joined",
  voicePeerLeft: "server:voice-peer-left",
  voiceSignal: "server:voice-signal",
  error: "server:error"
});
