"use strict";

function devInit(...args) {
  // replace assert
  console.log("console.assert is replaced");
  console.assert = (c, ...msgs) => {
    if (!c) {
      console.debug(new Error().stack);
      const output = msgs.length ? msgs.join(", ") : "";
      window.alert("ASSERTION FAILED:\n" + output);
      throw new Error(output);
    }
  };
}
devInit();

// get [min, max)
export function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

export function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
export function getByteSize(n) {
  if (n instanceof Blob) n = n.size;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(2) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export function getTestBlob(n, seed = 0) {
  console.assert(n >= 4);
  const buffer = new ArrayBuffer(n);
  const cptr = new Uint8Array(buffer);
  for (let i = 0; i < cptr.length; ++i, ++seed) cptr[i] = seed % 256;

  return new Blob([buffer], { type: "application/octet-stream" });
}

export async function verifyTestBlob(buf, seed = 0) {
  if (!buf) return Promise.reject("null buffer");

  const check = (arrbuf) => {
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

  return new Promise((resolve, reject) => {
    if (buf instanceof Blob) {
      const blobReader = new FileReader();
      blobReader.onload = () => resolve(check(blobReader.result));
      blobReader.readAsArrayBuffer(buf);
    } else if (buf instanceof ArrayBuffer) {
      resolve(check(buf));
    } else {
      throw new Error("invalid buffer type");
    }
  });
}

export async function getAt(buf, idx) {
  const get = (arrbuf, idx) => {
    const cptr = new Uint8Array(arrbuf);
    console.log(`buf[${idx} = ${cptr[idx]}`);
    return cptr[idx];
  };
  if (buf instanceof Blob) {
    return new Promise((ok, ng) => {
      const blobReader = new FileReader();
      blobReader.onabort = () => ng(blobReader.error);
      blobReader.onload = () => ok(get(blobReader.result, idx));
      blobReader.readAsArrayBuffer(buf);
      console.log(`state=${blobReader.readyState}`);
    });
  } else if (buf instanceof ArrayBuffer) {
    return Promise.resolve(get(buf, idx));
  } else {
    throw new Error("invalid buffer type");
  }
}

//
// html
//
export const addTestWidget = (element, callback = undefined, eventName = "click") => {
  if (!document.querySelector("#test-buttons")) {
    document.body.insertAdjacentHTML("beforeend", `<div id='test-buttons' style="width: 100%"></div>`);
    document.head.insertAdjacentHTML(
      "beforeend",
      `<style>
      #test-buttons
      button, input {
          display: block;
          width: 20rem;
          margin: 0.5em auto;
          box-sizing: border-box;
        }
    </style>`
    );
  }
  document.querySelector("#test-buttons").insertAdjacentHTML("beforeend", element);

  if (!callback) return;

  const el = document.querySelector("#test-buttons").querySelector(":last-child");
  if (el) el.addEventListener(eventName, callback);
  else console.error(`no element for <${element}>`);
};

//
// download blob
//
export const downloadBlob = (blob, path) => {
  const link = document.createElement("a");
  link.download = path;
  link.href = window.URL.createObjectURL(blob);
  link.click();
  window.URL.revokeObjectURL(link.href); // jjkim
};
