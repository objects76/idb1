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
      width: 15rem;
      margin: 0.5em auto;
      box-sizing: border-box;
    }
</style>`
);

const setHandler = (element, callback = undefined, eventName = "click") => {
  document.querySelector("#test-buttons").insertAdjacentHTML("beforeend", element);

  const match = /id=['"]([^'"]+)/g.exec(element);
  if (match && callback) {
    const el = document.querySelector("#" + match[1]);
    if (el) el.addEventListener(eventName, callback);
    else console.error(`no element for <${selector}>`);
  }
};

//
//
//
// In the following line, you should include the prefixes of implementations you want to test.
//window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

// DON'T use "var indexedDB = ..." if you're not in a function.
// Moreover, you may need references to some window.IDB* objects:
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;
// (Mozilla has never prefixed these objects, so we don't need window.mozIDB*)
const FILE_STORE_ = "files";
const MAX_CHUNK_SIZE_ = 5 * 1024 * 1024;
var db;

window.onload = function () {
  // open db
  var openRequest = window.indexedDB.open("db for files", 1);
  openRequest.onupgradeneeded = function (event) {
    db = event.target.result;
    db.onerror = (event) => console.error(event);

    if (!db.objectStoreNames.contains(FILE_STORE_)) {
      const store = db.createObjectStore(FILE_STORE_ /*,{keyPath: 'id', autoIncrement: true}*/);
      store.createIndex("fullPath", "fullPath", { unique: false });
    }
  };

  openRequest.onsuccess = function (event) {
    db = openRequest.result;
  };
};

setHandler(`<button id='fs-open'>key range</button>`, async (evt) => {
  displayData();
});

const getByteSize = (n) => {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(2) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
};

//
// bolb write test
//
const entry = {
  blob: new Blob([]),
  fullPath: undefined,
  lastModifiedDate: undefined,
  createdDate: undefined,
};
entry.createdDate = Date.now();
entry.lastModifiedDate = Date.now();
entry.fullPath = "/folder/file1.blob:";
let chunkSeq = 0;

let writeInterval;

const getLastChunk = (key) => {
  const keyRangeValue = IDBKeyRange.only(entry.fullPath);
  const tx = db.transaction([FILE_STORE_], "readonly");
  const objectStore = tx.objectStore(FILE_STORE_).index("fullPath");

  return new Promise((ok, ng) => {
    let lastEntry;
    let lastKey;
    let totalSize = 0;
    const request = objectStore.openCursor(keyRangeValue);
    request.onerror = () => ng(request.error);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        lastKey = cursor.primaryKey;
        lastEntry = cursor.value;
        writtenSize += cursor.value.blob.size;
        cursor.continue();
      } else {
        const chunkSeq = Number(lastKey.substring(lastKey.lastIndexOf(":") + 1));
        ok({ chunkSeq, entry: lastEntry, totalSize });
      }
    };
  });
};

setHandler(`<button id='fs-write'>write</button>`, async (evt) => {
  // if (!entry.lastModifiedDate) {
  //   // get saved if existed.
  //   try {
  //     const oldentry = await get(entry.fullPath);
  //     entry.lastModifiedDate = oldentry.lastModifiedDate;
  //     entry.createdDate = oldentry.createdDate;
  //     entry.blob = oldentry.blob;
  //     console.log(
  //       ["old entry:", entry.fullPath, getByteSize(entry.blob.size), new Date(entry.createdDate).toLocaleString()].join(
  //         " - "
  //       )
  //     );
  //   } catch (err) {}
  // }
  if (chunkSeq === 0) {
    try {
      const lastChunk = await getLastChunk(entry.fullPath);
      chunkSeq = lastChunk.chunkSeq;
      entry.blob = lastChunk.entry.blob;
    } catch (err) {}
  }

  writeInterval = setInterval(() => {
    const sizePerSec = (5000 / 8) * 30;
    const newData = new Blob([new ArrayBuffer(sizePerSec)], { type: "application/octet-stream; charset=utf-8" });

    // join into entry
    entry.blob = new Blob([entry.blob, newData], { type: "application/octet-stream; charset=utf-8" });
    if (Date.now() - entry.lastModifiedDate >= 1000) {
      entry.lastModifiedDate = Date.now();

      // put to db
      const key = entry.fullPath + chunkSeq;
      const tx = db.transaction([FILE_STORE_], "readwrite");
      const request = tx.objectStore(FILE_STORE_).put(entry, key);
      tx.onabort = console.error;
      tx.onerror = () => {
        console.error("write:", request.error);
      };
      tx.oncomplete = function (e) {
        // TODO: Error is thrown if we pass the request event back instead.
        console.log(
          "write done:",
          key,
          [entry.fullPath, getByteSize(entry.blob.size), new Date(entry.createdDate).toLocaleString()].join(" - ")
        );
        if (entry.blob.size >= MAX_CHUNK_SIZE_) {
          ++chunkSeq;
          entry.blob = new Blob([]);
        }
      };
    }
  }, 100);
});

//
// read test
//
const get = async (key) => {
  return new Promise((ok, ng) => {
    const tx = db.transaction([FILE_STORE_], "readonly");
    const request = tx.objectStore(FILE_STORE_).get(key);
    tx.onabort = () => ng(request.error);
    tx.onerror = () => ng(request.error);
    tx.oncomplete = (e) => {
      if (request.result) ok(request.result);
      else ng(new Error("No item for " + key));
    };
  });
};

setHandler(`<button id='fs-read'>read</button>`, async (evt) => {
  // const key = entry.fullPath; // + "-invalid";
  // if (writeInterval) {
  //   clearInterval(writeInterval);
  //   writeInterval = undefined;
  // }
  // try {
  //   const entry = await get(key);
  //   console.log(
  //     ["read done:", entry.fullPath, getByteSize(entry.blob.size), new Date(entry.createdDate).toLocaleString()].join(
  //       " - "
  //     )
  //   );
  // } catch (err) {
  //   console.error(err);
  // }

  // stream saver
  // const open_writer = (download_name) => {
  //   const { readable, writable } = new TransformStream({
  //     transform: (blob, ctrl) => blob.arrayBuffer().then((b) => ctrl.enqueue(new Uint8Array(b))),
  //   });
  //   readable.pipeTo(streamSaver.createWriteStream(download_name));
  //   return writable.getWriter();
  // };
  // const writer = open_writer("download.blob");

  // get cursor
  const keyRangeValue = IDBKeyRange.only(entry.fullPath);
  const tx = db.transaction([FILE_STORE_], "readonly");
  const objectStore = tx.objectStore(FILE_STORE_).index("fullPath");

  const blobs = [];
  objectStore.openCursor(keyRangeValue).onsuccess = async (event) => {
    const cursor = event.target.result;
    if (cursor) {
      const blob = cursor.value.blob;
      try {
        console.log(cursor.primaryKey, cursor.value, "size=", blob.size);
        blobs.push(blob);
        cursor.continue();
      } catch (err) {
        console.error(err);
      }
    } else {
      console.log("Entries all displayed.");
      downloadBlob(new Blob(blobs, { type: "application/octet-stream" }), entry.fullPath);
    }
  };
});

//
// download
//
function downloadBlob(blob, destName) {
  const link = document.createElement("a");

  link.download = destName;
  link.href = window.URL.createObjectURL(blob);

  const clickEvent = document.createEvent("MouseEvents");
  clickEvent.initMouseEvent("click", true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
  link.dispatchEvent(clickEvent);
}
