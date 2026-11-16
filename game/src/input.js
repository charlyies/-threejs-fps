// Keyboard and mouse, and the pointer lock that turns the mouse into look.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, aiming: false, lookX: 0, lookY: 0 };
  function onKey(e, down) {
    if (e.code === 'Space') e.preventDefault();
    if (down) keys.add(e.code); else keys.delete(e.code);
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => { keys.clear(); state.firing = false; state.aiming = false; });
  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX; state.lookY += e.movementY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.aiming = true; // right mouse: aim down sights
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    onLockChange(state.locked);
  });
  return {
    state,
    requestLock() { canvas.requestPointerLock?.(); },
    releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    consumeLook() { const x = state.lookX, y = state.lookY; state.lookX = 0; state.lookY = 0; return { x, y }; },
  };
}
