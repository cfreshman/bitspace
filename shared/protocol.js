export const CLIENT_EVENTS = Object.freeze({
  input: "client:input",
  setName: "client:set-name",
  talk: "client:talk",
  upgrade: "client:upgrade",
  buildWall: "client:build-wall",
  ready: "client:ready",
  resume: "client:resume",
  start: "client:start",
  leave: "client:leave"
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
  error: "server:error"
});
