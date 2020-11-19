"use strict";
import devInit, { getRandomInt, buildArrayBuffer, checkBuffer, checkLinear } from "./Devtools.js";
devInit();

let idbdb;
const FILE_STORE_ = "blobstore";
const MAX_CHUNK_SIZE_ = 1 * 1024 * 1024;
const BLOB_TYPE = "application/octet-stream";
const MINIMUN_WRITE_INTERVAL = 100; // ms

window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;
window.onload = () => {
  const openRequest = window.indexedDB.open("blob.test.db", 1);
  openRequest.onupgradeneeded = (event) => {
    const db = event.target.result;
    const store = db.createObjectStore(FILE_STORE_);
  };

  openRequest.onsuccess = (evt) => {
    idbdb = openRequest.result;
    console.log(`'${"blob.test.db"}' is opened`);
  };
};

// indexed db request
let idbdbPromise;

// append
let appendTry = 0;
async function appendBlobIntoIdb(blob, key, done) {
  const tx = idbdb.transaction([FILE_STORE_], "readwrite");
  const store = tx.objectStore(FILE_STORE_);

  // get old if existed
  const oldBlob = await new Promise((ok, ng) => {
    const getRequest = store.get(key);
    getRequest.onsuccess = (evt) => {
      const old = getRequest.result;
      ok(old ? old : undefined);
    };
  });

  if (oldBlob) blob = new Blob([oldBlob, blob], { type: BLOB_TYPE }); // append blob.

  await new Promise((ok, ng) => {
    ++appendTry;
    // https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/put
    const updateBlobRequest = store.put(blob, key);
    updateBlobRequest.onsuccess = () => {
      if (updateBlobRequest.error) console.error("put:", updateBlobRequest.error);
      done(blob);
      ok();
    };
  });
}

let writeBlobs = [];
let chunkSeq = 0;
let lastModifiedDate = Date.now();

let writtenBlobSize = 0;

async function writeFile(blob, fullPath) {
  writeBlobs.push(blob);
  if (Date.now() - lastModifiedDate < MINIMUN_WRITE_INTERVAL) return;

  if (idbdbPromise) await idbdbPromise;
  blob = new Blob(writeBlobs, { type: BLOB_TYPE });
  lastModifiedDate = Date.now();
  writeBlobs = [];

  const key = fullPath + ":" + chunkSeq; // append all blobs to chunk:0.
  await appendBlobIntoIdb(blob, key, (blob) => {
    console.assert(blob.size > writtenBlobSize);
    writtenBlobSize = blob.size;
    console.log(`write ${getByteSize(blob)}, ${--appendTry} remained`);
  });
}

async function writeInit() {
  if (idbdbPromise) await idbdbPromise;
  idbdbPromise = undefined;
  writtenBlobSize = 0;
  writeBlobs = [];
}
function writeFlush() {
  // just throw away remained
  writeBlobs = [];
}

// readall
function nextSep(sep) {
  return String.fromCharCode(sep.charCodeAt(0) + 1);
}

async function getIdbBlob(fullPath) {
  return new Promise((ok, ng) => {
    const range = IDBKeyRange.bound(fullPath + ":", fullPath + nextSep(":"), false, true);
    const tx = idbdb.transaction([FILE_STORE_], "readonly");
    const request = tx.objectStore(FILE_STORE_).getAll(range);
    request.onsuccess = () => {
      console.log(`all blobs = #${request.result.length}`);
      ok(new Blob(request.result, { type: BLOB_TYPE }));
    };
  });
}

async function readFile(fullPath) {
  if (idbdbPromise) await idbdbPromise;
  idbdbPromise = undefined;
  return await getIdbBlob(fullPath);
}

const getByteSize = (n) => {
  if (n instanceof Blob) n = n.size;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(2) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
};

if (window.IDBBlobTest) {
  //------------------------------------------------------------------------------
  // test: utils for test setup.
  //------------------------------------------------------------------------------
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

  const setHandler = (element, callback = undefined, eventName = "click") => {
    document.querySelector("#test-buttons").insertAdjacentHTML("beforeend", element);

    if (!callback) return;

    const el = document.querySelector("#test-buttons").querySelector(":last-child");
    if (el) el.addEventListener(eventName, callback);
    else console.error(`no element for <${element}>`);
  };

  //------------------------------------------------------------------------------
  // test
  //------------------------------------------------------------------------------

  setHandler(
    `<input type='file' multiple/>`,
    async (evt) => {
      stopWriter();

      for (const file of evt.target.files) {
        // { name, size, type }
        idbdb.upload(file, "/upload", 1024 * 1024 * 1024);
      }
    },
    "change"
  );
  setHandler(`<button>reopen idb</button>`, async (evt) => {
    idbdb.closeDB();
    idbdb = new IDBBlob();
  });

  setHandler(`<hr/><input id='fs-path'></input>`);

  //
  // write
  //
  let writeInterval;
  let writeSeed = 0;
  const stopWriter = async () => {
    if (!writeInterval) return false;

    clearInterval(writeInterval);
    writeInterval = undefined;
    //writeFlush();

    console.log(`clearInterval: writeSeed=${writeSeed}`);
    return true;
  };

  setHandler(`<button>WRITE FILE</button>`, async (evt) => {
    if (writeInterval) return;

    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) {
      path = `/folder1/rec-${new Date().toLocaleString().replace(/[/:]/g, ".")}.bin`;
      document.querySelector("#fs-path").value = path;
    }

    writeSeed = 0;
    writeInit();
    writeInterval = setInterval(() => {
      let n = getRandomInt((5000 / 8) * 30 - 4096, (5000 / 8) * 30);
      const { nextSeed, buffer } = buildArrayBuffer(n, writeSeed);
      writeSeed = nextSeed;

      const blob = new Blob([buffer], { type: BLOB_TYPE });
      //console.log(`call writeFile(${getByteSize(blob)})`);
      console.assert(writeInterval);
      writeFile(blob, path);
    }, 0);
  });
  setHandler(`<button>STOP WRITE FILE</button>`, async (evt) => {
    stopWriter();
  });
  //
  // read file
  //
  setHandler(`<button>READ FILE</button>`, async (evt) => {
    stopWriter();
    const path = document.querySelector("#fs-path").value;
    if (path.length < 3) return;
    document.querySelector("#fs-path").value = "";

    const blob = await readFile(path);
    console.log(`[read] size= ${getByteSize(blob)}`);
    if (await checkBuffer(blob, 0)) console.log("verified");
  });

  //
  // download
  //
  function downloadBlob(blob, destName) {}

  setHandler(`<button>DOWNLOAD</button>`, async (evt) => {
    stopWriter();
    const path = document.querySelector("#fs-path").value;
    if (path.length < 3) return;

    const blob = await readFile(path);
    console.log(`[read] size= ${getByteSize(blob)}`);

    const link = document.createElement("a");
    link.download = path;
    link.href = window.URL.createObjectURL(blob);
    link.click();
    window.URL.revokeObjectURL(link.href); // jjkim
  });
}
