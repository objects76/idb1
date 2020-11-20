"use strict";
import devInit, { getRandomInt, getTestBlob, verifyTestBlob, getByteSize } from "./Devtools.js";
devInit();

let idbdb;
const FILE_STORE_ = "blobstore";
const MAX_CHUNK_SIZE_ = 1 * 1024 * 1024;
const BLOB_TYPE = "application/octet-stream";
const MINIMUN_WRITE_INTERVAL = 100; // ms
const SEND_INTERVAL = 0; // ms

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

function setuptx(tx, resolve, reject) {
  const unlisten = () => {
    tx.removeEventListener("complete", complete);
    tx.removeEventListener("error", error);
    tx.removeEventListener("abort", error);
  };
  const complete = () => {
    resolve();
    unlisten();
  };
  const error = () => {
    reject(tx.error || new DOMException("AbortError", "AbortError"));
    unlisten();
  };
  tx.addEventListener("complete", complete);
  tx.addEventListener("error", error);
  tx.addEventListener("abort", error);
}
// append
let appendTry = 0;
async function appendBlobIntoIdb(blob, key, done) {
  const tx = idbdb.transaction([FILE_STORE_], "readwrite");
  const store = tx.objectStore(FILE_STORE_);

  // // get old if existed
  // const oldBlob = await new Promise((ok, ng) => {
  //   const getRequest = store.get(key);
  //   getRequest.onsuccess = (evt) => {
  //     const old = getRequest.result;
  //     ok(old ? old : undefined);
  //   };
  // });

  // if (oldBlob) blob = new Blob([oldBlob, blob], { type: BLOB_TYPE }); // append blob.

  // await new Promise((ok, ng) => {
  //   ++appendTry;
  //   // https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/put
  //   const updateBlobRequest = store.put(blob, key);
  //   updateBlobRequest.onsuccess = () => {
  //     if (updateBlobRequest.error) console.error("put:", updateBlobRequest.error);
  //     done(blob);
  //     ok();
  //   };
  // });
  const getRequest = store.get(key);
  getRequest.onsuccess = (evt) => {
    const oldBlob = getRequest.result;
    if (oldBlob) blob = new Blob([oldBlob, blob], { type: BLOB_TYPE });
    else {
      console.log(`key: ${key.substr(-2)}`);
    }

    ++appendTry;
    const updateBlobRequest = store.put(blob, key);
    updateBlobRequest.onsuccess = (evt) => {
      done(blob);
    };
  };

  await new Promise((ok, ng) => {
    setuptx(tx, ok, ng);
  });
}

// put without get(key)
let putTry = 0;
async function putBlobIntoIdb(blob, key, done) {
  const tx = idbdb.transaction([FILE_STORE_], "readwrite");

  ++putTry;
  const updateBlobRequest = tx.objectStore(FILE_STORE_).put(blob, key);
  updateBlobRequest.onsuccess = (evt) => {
    done(blob);
  };

  await new Promise((ok, ng) => {
    setuptx(tx, ok, ng);
  });
}

// writeFile???
let blobCache = [];
let lastModifiedDate = Date.now();

let writtenBlobSize = 0;

async function writeFile(blob, fullPath) {
  blobCache.push(blob);
  if (Date.now() - lastModifiedDate < MINIMUN_WRITE_INTERVAL) return;

  if (idbdbPromise) await idbdbPromise;
  blob = new Blob(blobCache, { type: BLOB_TYPE });
  lastModifiedDate = Date.now();
  blobCache = [];

  const key = fullPath + ":000"; // append all blobs to chunk:0.
  await appendBlobIntoIdb(blob, key, (blob) => {
    console.assert(blob.size > writtenBlobSize);
    writtenBlobSize = blob.size;
    console.log(`write ${getByteSize(blob)}, ${--appendTry} remained`);
  });
}

let chunkSeq;
let chunkBlobCache;
let oldChunkSize;
let chunkOffset;
async function writeFileWithChunk(blob, fullPath) {
  blobCache.push(blob);
  if (Date.now() - lastModifiedDate < MINIMUN_WRITE_INTERVAL) return;

  if (idbdbPromise) await idbdbPromise;
  lastModifiedDate = Date.now();

  if ("!with appendBlobIntoIdb") {
    const blob4idb = new Blob(blobCache, { type: BLOB_TYPE });
    const key = fullPath + ":" + ("00" + chunkSeq).slice(-3);
    blobCache = [];
    await appendBlobIntoIdb(blob4idb, key, (blobDone) => {
      chunkOffset += blob4idb.size;
      console.assert(blobDone.size >= blob4idb.size);
      console.log(
        `write: key=${key.substr(-4)}, ${getByteSize(blobDone)}/${chunkOffset},${getByteSize(
          chunkOffset
        )}, ${--appendTry} remained`
      );

      if (blobDone.size >= MAX_CHUNK_SIZE_) {
        ++chunkSeq;
      }
    });
  } else {
    // if (writtenBlobSize >= MAX_CHUNK_SIZE_) {
    //   console.log(`write: new chunk=${chunkSeq}, old size= ${getByteSize(writtenBlobSize)}`);
    //   chunkBlobCache = [];
    //   ++chunkSeq;
    //   writtenBlobSize = 0;
    // }
    const chunk4idb = new Blob(blobCache, { type: BLOB_TYPE });
    const key = fullPath + ":" + ("00" + chunkSeq).slice(-3);
    const currentChunkOffset = chunkOffset;
    if (chunk4idb.size >= MAX_CHUNK_SIZE_) {
      // this is last write of current chunk. so update there.
      chunkOffset += chunk4idb.size;
      blobCache = [];
      ++chunkSeq;
    }

    await putBlobIntoIdb(chunk4idb, key, (blobDone) => {
      console.assert(blobDone.size === chunk4idb.size);
      console.log(
        `write: key=${key.substr(-4)}, ${getByteSize(blobDone)}/${currentChunkOffset + blobDone.size},${getByteSize(
          currentChunkOffset + blobDone.size
        )}, ${--putTry} remained`
      );
    });
    // if (chunkBlob.size >= MAX_CHUNK_SIZE_) {
    //   console.log(`write: new chunk=${chunkSeq}, old size= ${getByteSize(chunkBlob)}`);
    //   chunkBlob = new Blob([], { type: BLOB_TYPE });
    //   ++chunkSeq;
    //   writtenBlobSize = 0;
    // }
    // chunkBlob = new Blob([chunkBlob, ...blobCache], { type: BLOB_TYPE });
    // const key = fullPath + ":" + chunkSeq;
    // blobCache = [];

    // await putBlobIntoIdb(chunkBlob.slice(), key, (blobDone) => {
    //   console.assert(
    //     blobDone.size > writtenBlobSize,
    //     `cur=${getByteSize(blobDone)}, old=${getByteSize(writtenBlobSize)}}`
    //   );
    //   writtenBlobSize = blobDone.size;
    //   console.log(`write: chunk=${chunkSeq}, ${getByteSize(blobDone)}, ${--putTry} remained`);
    // });
  }
}

async function writeInit() {
  if (idbdbPromise) await idbdbPromise;
  idbdbPromise = undefined;
  writtenBlobSize = 0;
  blobCache = [];
  chunkSeq = 0;
  chunkBlobCache = [];

  oldChunkSize = 0;
  chunkOffset = 0;
}
function writeFlush() {
  // just throw away remained
  blobCache = [];
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
  const stopWriter = async () => {
    if (!writeInterval) return false;

    clearInterval(writeInterval);
    writeInterval = undefined;
    //writeFlush();

    console.log(`stopWriter: called`);
    return true;
  };

  setHandler(`<button>WRITE FILE</button>`, async (evt) => {
    if (writeInterval) return;

    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) {
      path = `/folder1/rec-${new Date().toLocaleString().replace(/[/:]/g, ".")}.bin`;
      document.querySelector("#fs-path").value = path;
    }

    writeInit();

    let offset = 0;
    const { buffer } = getTestBlob(1024 * 1024 * 15);
    verifyTestBlob(buffer);

    writeInterval = setInterval(() => {
      let n = getRandomInt((5000 / 8) * 30 - 4096, (5000 / 8) * 30);
      const chunk = buffer.slice(offset, offset + n);
      const blob = new Blob([chunk], { type: BLOB_TYPE });
      writeFileWithChunk(blob, path);

      offset += n;
      if (offset >= buffer.byteLength) stopWriter();
    }, SEND_INTERVAL);
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
    if (await verifyTestBlob(blob, 0)) console.log("verified");
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
