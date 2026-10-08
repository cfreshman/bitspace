const AXIS_DEADZONE = 0.18;
const TRIGGER_THRESHOLD = 0.45;
const BUTTON_THRESHOLD = 0.5;

export function createGamepadControls() {
  let previousButtons = defaultButtons();
  let boundGamepadIndex = null;

  return {
    update() {
      const gamepad = selectedGamepad(boundGamepadIndex);
      if (!gamepad) {
        boundGamepadIndex = null;
        previousButtons = defaultButtons();
        return {
          connected: false,
          active: false,
          leftStick: { x: 0, y: 0 },
          dpad: { x: 0, y: 0 },
          move: { x: 0, y: 0 },
          menuMove: { x: 0, y: 0 },
          aim: { x: 0, y: 0, active: false },
          buttons: defaultButtons(),
          pressed: defaultButtons()
        };
      }
      boundGamepadIndex = gamepad.index;

      const active = gamepadHasInput(gamepad);
      const leftStick = axisPair(gamepad, 0, 1);
      const rightStick = axisPair(gamepad, 2, 3);
      const dpad = dpadVector(gamepad);
      const buttons = {
        select: buttonDown(gamepad, 0),
        reset: buttonDown(gamepad, 1),
        build: buttonDown(gamepad, 2),
        upgrades: buttonDown(gamepad, 3),
        map: buttonDown(gamepad, 12),
        voice: buttonDown(gamepad, 11),
        huckRock: buttonDown(gamepad, 6),
        mining: buttonDown(gamepad, 7)
      };
      const pressed = {
        select: buttons.select && !previousButtons.select,
        reset: buttons.reset && !previousButtons.reset,
        build: buttons.build && !previousButtons.build,
        upgrades: buttons.upgrades && !previousButtons.upgrades,
        map: buttons.map && !previousButtons.map,
        voice: buttons.voice && !previousButtons.voice,
        huckRock: buttons.huckRock && !previousButtons.huckRock,
        mining: buttons.mining && !previousButtons.mining
      };
      previousButtons = buttons;

      return {
        connected: true,
        active,
        id: gamepad.id,
        leftStick,
        dpad,
        move: leftStick,
        menuMove: strongestVector(dpad, leftStick),
        aim: {
          ...rightStick,
          active: Math.hypot(rightStick.x, rightStick.y) > 0
        },
        buttons,
        pressed
      };
    }
  };
}

function selectedGamepad(boundGamepadIndex) {
  const gamepads = navigator.getGamepads?.() || [];
  const bound = Number.isInteger(boundGamepadIndex) ? gamepads[boundGamepadIndex] : null;
  if (bound?.connected) {
    return bound;
  }

  if (!windowHasFocus()) {
    return null;
  }

  return Array.from(gamepads).find((gamepad) => gamepad?.connected && gamepadHasInput(gamepad)) || null;
}

function windowHasFocus() {
  return typeof document === "undefined" || document.hasFocus?.() !== false;
}

function gamepadHasInput(gamepad) {
  const axesActive = Array.from(gamepad.axes || []).some((axis) => applyDeadzone(axis) !== 0);
  const buttonsActive = Array.from(gamepad.buttons || []).some((button, index) => {
    if (!button) {
      return false;
    }

    return button.pressed || Number(button.value || 0) >= triggerThreshold(index);
  });

  return axesActive || buttonsActive;
}

function axisPair(gamepad, xIndex, yIndex) {
  return clampMagnitude(
    applyDeadzone(gamepad.axes?.[xIndex] || 0),
    applyDeadzone(gamepad.axes?.[yIndex] || 0)
  );
}

function dpadVector(gamepad) {
  const x = Number(buttonDown(gamepad, 15)) - Number(buttonDown(gamepad, 14));
  const y = Number(buttonDown(gamepad, 13)) - Number(buttonDown(gamepad, 12));
  return clampMagnitude(x, y);
}

function strongestVector(a, b) {
  return vectorMagnitudeSq(b) > vectorMagnitudeSq(a) ? b : a;
}

function vectorMagnitudeSq(vector) {
  return vector.x * vector.x + vector.y * vector.y;
}

function buttonDown(gamepad, index) {
  const button = gamepad.buttons?.[index];
  if (!button) {
    return false;
  }

  return button.pressed || Number(button.value || 0) >= triggerThreshold(index);
}

function triggerThreshold(index) {
  return index === 6 || index === 7 ? TRIGGER_THRESHOLD : BUTTON_THRESHOLD;
}

function applyDeadzone(value) {
  const number = clamp(Number(value) || 0, -1, 1);
  const magnitude = Math.abs(number);
  if (magnitude <= AXIS_DEADZONE) {
    return 0;
  }

  return Math.sign(number) * ((magnitude - AXIS_DEADZONE) / (1 - AXIS_DEADZONE));
}

function clampMagnitude(x, y) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= 1 || magnitude === 0) {
    return { x, y };
  }

  return {
    x: x / magnitude,
    y: y / magnitude
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultButtons() {
  return {
    select: false,
    reset: false,
    build: false,
    upgrades: false,
    map: false,
    voice: false,
    huckRock: false,
    mining: false
  };
}
