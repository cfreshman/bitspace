export const CLIENT_EVENTS = Object.freeze({
  input: "client:input",
  setName: "client:set-name"
});

export const SERVER_EVENTS = Object.freeze({
  welcome: "server:welcome",
  lobby: "server:lobby",
  snapshot: "server:snapshot",
  notice: "server:notice",
  error: "server:error"
});
