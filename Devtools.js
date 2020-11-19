"use strict";

export default function devInit(...args) {
  // replace assert
  console.assert = (c, ...msgs) => {
    if (!c) {
      const output = msgs.length ? msgs.join(", ") : "Assertion failed";
      window.alert(output);
      throw new Error(output);
    }
  };

  console.log("console.assert is replaced");
}

export function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function buildArrayBuffer(n, seed) {
  const buffer = new ArrayBuffer(n);
  const intptr = new Uint8Array(buffer);
  for (let i = 0; i < intptr.length; ++i, ++seed) intptr[i] = seed % 256;

  return { nextSeed: seed, buffer };
}

const check = (intptr, seed) => {
  for (let i = 0; i < intptr.length; ++i, ++seed) {
    if (intptr[i] !== seed % 256) {
      console.error(`[${i}]: expect ${seed % 256}, but ${intptr[i]}`);
      return false;
    }
  }
  return true;
};

export async function checkBuffer(buf, seed) {
  return new Promise((ok, ng) => {
    if (buf instanceof Blob) {
      const blobReader = new FileReader();
      blobReader.onabort = () => ng(blobReader.error);
      blobReader.onload = () => {
        const intptr = new Uint8Array(blobReader.result);
        ok(check(intptr, seed));
      };
      blobReader.readAsArrayBuffer(buf);
      console.log(`state=${blobReader.readyState}`);
    } else if (buf instanceof ArrayBuffer) {
      ok(check(new Uint8Array(buf), seed));
    } else {
      throw new Error("invalid buffer type");
    }
  });
}

export async function checkLinear(blob) {
  return new Promise((ok) => {
    const blobReader = new FileReader();
    blobReader.onload = () => {
      const intptr = new Uint8Array(blobReader.result);
      ok(check(intptr, intptr[0]));
    };
    blobReader.readAsArrayBuffer(blob);
  });
}
