import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

// --- Minimal browser APIs jsdom does not implement -------------------------
try {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: webcrypto,
  });
} catch (e) {
  /* ignore */
}

(globalThis as any).TextEncoder = (globalThis as any).TextEncoder || TextEncoder;
(globalThis as any).TextDecoder = (globalThis as any).TextDecoder || TextDecoder;

if (typeof (globalThis as any).URL.createObjectURL !== 'function') {
  (globalThis as any).URL.createObjectURL = () => 'blob:mock';
  (globalThis as any).URL.revokeObjectURL = () => {};
}

if (!(globalThis as any).window.matchMedia) {
  (globalThis as any).window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!(globalThis as any).window.scrollTo) {
  (globalThis as any).window.scrollTo = () => {};
}

if (!(globalThis as any).window.print) {
  (globalThis as any).window.print = () => {};
}

// jsdom has no canvas implementation; jsPDF / barcode renderers only need a stub
(globalThis as any).HTMLCanvasElement.prototype.getContext = function () {
  return {
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    fillText: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 0 }),
    transform: () => {},
    rect: () => {},
    clip: () => {},
  };
};
