import { io } from "socket.io-client";

import { CLIENT_EVENTS, SERVER_EVENTS } from "../shared/protocol.js";
import { normalizeInput } from "../shared/input.js";

const url = process.env.BITSPACE_SMOKE_URL || "http://localhost:7023";
const timeoutMs = Number(process.env.BITSPACE_SMOKE_TIMEOUT_MS || 5000);

const socket = io(url, {
  auth: {
    name: "Smoke Test"
  },
  reconnection: false,
  timeout: timeoutMs
});

let playerId = null;
let completed = false;

const timeout = setTimeout(() => {
  fail(new Error(`Timed out waiting for snapshot from ${url}`));
}, timeoutMs);

socket.on("connect_error", fail);
socket.on(SERVER_EVENTS.error, (error) => {
  fail(new Error(error.message || error.code || "Server rejected smoke test"));
});

socket.on(SERVER_EVENTS.welcome, (payload) => {
  playerId = payload.playerId;
  socket.emit(
    CLIENT_EVENTS.input,
    normalizeInput({
      seq: 1,
      moveX: 1,
      moveY: 0,
      aimAngle: 0,
      mining: true
    })
  );
});

socket.on(SERVER_EVENTS.snapshot, (snapshot) => {
  if (!playerId || !snapshot.players.some((player) => player.id === playerId)) {
    return;
  }

  completed = true;
  clearTimeout(timeout);
  socket.close();
  console.log(`Socket smoke test passed at tick ${snapshot.tick}`);
});

socket.on("disconnect", () => {
  if (!completed) {
    fail(new Error("Disconnected before receiving player snapshot"));
  }
});

function fail(error) {
  clearTimeout(timeout);
  socket.close();
  console.error(error.message);
  process.exitCode = 1;
}
