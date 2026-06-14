export const CLIENT_EVENTS = Object.freeze({
  input: "client:input",
  setName: "client:set-name",
  talk: "client:talk"
});

export const SERVER_EVENTS = Object.freeze({
  welcome: "server:welcome",
  asteroid: "server:asteroid",
  asteroidUpdate: "server:asteroid-update",
  lobby: "server:lobby",
  snapshot: "server:snapshot",
  notice: "server:notice",
  error: "server:error"
});
