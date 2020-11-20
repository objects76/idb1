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

export function getByteSize(n) {
  if (n instanceof Blob) n = n.size;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(2) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export function buildArrayBuffer(n, seed = 0) {
  console.assert(n >= 4);
  const buffer = new ArrayBuffer(n);
  const cptr = new Uint8Array(buffer);
  for (let i = 0; i < cptr.length; ++i, ++seed) cptr[i] = seed % 256;

  return { nextSeed: seed, buffer };
}

const check = (arrbuf, seed) => {
  const cptr = new Uint8Array(arrbuf);
  for (let i = 0; i < cptr.length; ++i, ++seed) {
    if (cptr[i] !== seed % 256) {
      console.error(`[${i}/${getByteSize(i)}]: expect ${seed % 256}, but ${cptr[i]}`);
      return false;
    }
  }
  console.log(`buffer(${getByteSize(arrbuf.byteLength)} verified)`);
  return true;
};

export async function checkBuffer(buf, seed = 0) {
  return new Promise((ok, ng) => {
    if (buf instanceof Blob) {
      const blobReader = new FileReader();
      blobReader.onabort = () => ng(blobReader.error);
      blobReader.onload = () => {
        ok(check(blobReader.result, seed));
      };
      blobReader.readAsArrayBuffer(buf);
      console.log(`state=${blobReader.readyState}`);
    } else if (buf instanceof ArrayBuffer) {
      ok(check(buf, seed));
    } else {
      throw new Error("invalid buffer type");
    }
  });
}

// export async function checkLinear(blob) {
//   return new Promise((ok) => {
//     const blobReader = new FileReader();
//     blobReader.onload = () => {
//       const intptr = new Uint8Array(blobReader.result);
//       ok(check(intptr, intptr[0]));
//     };
//     blobReader.readAsArrayBuffer(blob);
//   });
// }

export async function getAt(buf, idx) {
  if (buf instanceof Blob) {
    return new Promise((ok, ng) => {
      const blobReader = new FileReader();
      blobReader.onabort = () => ng(blobReader.error);
      blobReader.onload = () => {
        const intptr = new Uint8Array(blobReader.result);
        console.log(`buf[${idx} = ${intptr[idx]}`);
        ok(intptr[idx]);
      };
    });
    blobReader.readAsArrayBuffer(buf);
    console.log(`state=${blobReader.readyState}`);
  } else if (buf instanceof ArrayBuffer) {
    const intptr = new Uint8Array(buf);
    console.log(`buf[${idx} = ${intptr[idx]}`);
    Promise.resolve(intptr[idx]);
  } else {
    throw new Error("invalid buffer type");
  }
}
