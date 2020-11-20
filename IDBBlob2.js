"use strict";
import devInit, { getRandomInt, buildArrayBuffer, checkBuffer, getByteSize } from "./Devtools.js";
devInit();

const FILE_DB_ = "blob.test.db";
const FILE_STORE_ = "blobstore";
const MAX_CHUNK_SIZE_ = 1 * 1024 * 1024;
const BLOB_TYPE = "application/octet-stream";
const MINIMUN_WRITE_INTERVAL = 100; // ms
const SEND_INTERVAL = 0; // ms

window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;

const getKey = (path, seq) => path + ":" + ("00" + seq).slice(-3);
const getPath = (key) => key.slice(0, -4);
const nextChar = (c) => String.fromCharCode(c.charCodeAt(0) + 1);

class BlobIDB {
  constructor() {
    this.idbdb;
    const request = window.indexedDB.open(FILE_DB_, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const store = db.createObjectStore(FILE_STORE_);
    };

    request.onsuccess = (evt) => {
      this.idbdb = request.result;
      console.log(`'${FILE_DB_}' is opened`);
    };
  }
  closeDB = () => this.idbdb.close();
  drop = () => {
    const request = window.indexedDB.deleteDatabase(FILE_DB_);
    request.onsuccess = (evt) => console.log(`${FILE_DB_} successfully cleared and dropped`);
    request.onerror = (evt) => console.error(`${FILE_DB_} error when drop database`);
  };

  put = (blob, blobOffset, key) => {
    console.debug(`[db.write] ${key}, ${blob.size}, offset=${blobOffset}`);

    const tx = this.idbdb.transaction([FILE_STORE_], "readwrite");
    const updateBlobRequest = tx.objectStore(FILE_STORE_).put({ blob, blobOffset }, key);
    updateBlobRequest.onsuccess = (evt) => console.debug(`${evt.target.result} done for ${key}`);

    //return new Promise((resolve, reject) => setuptx(tx, resolve, reject));
  };

  getBlob = (fullPath) => {
    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(fullPath + ":", fullPath + nextChar(":"), false, true);
      const tx = this.idbdb.transaction([FILE_STORE_], "readonly");
      const request = tx.objectStore(FILE_STORE_).getAll(range);
      request.onerror = () => reject(request.error || `Can't read ${fullPath}`);
      request.onsuccess = () => {
        console.log(`all blobs = #${request.result.length}`);
        resolve(
          new Blob(
            request.result.map((v) => v.blob),
            { type: BLOB_TYPE }
          )
        );
      };
    });
  };

  // return list of files in idb.
  dir = async (folder) => {
    let range;
    if (folder) {
      if (folder.slice(-1) === "/") folder = folder.slice(0, -1);
      range = IDBKeyRange.bound(folder + "/", folder + nextChar("/"), false, true);
    }

    const tx = this.idbdb.transaction([FILE_STORE_], "readonly");

    var request = tx.objectStore(FILE_STORE_).openCursor(range, "prev");
    const pathlist = new Map();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const fullPath = getPath(cursor.key);
        if (!pathlist.get(fullPath)) {
          const size = cursor.value.blobOffset + cursor.value.blob.size;
          pathlist.set(fullPath, size);
        }
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      setuptx(tx, () => resolve(pathlist), reject);
    });
  };

  // upload a fileblob
  upload = async (fileblob, toFolder) => {
    if (toFolder.slice(-1) !== "/") toFolder += "/";
    const fullPath = toFolder + fileblob.name;
    const key = getKey(fullPath, 0);
    this.put(fileblob, 0, key);
    console.log(key, "is uploaded");
  };
} // class BlobDB

function BlobWriter(fullPath, db) {
  this.fullPath = fullPath;
  this.db = db;
  this.blobs = [];
  this.tickWritten = Date.now();
  this.chunkSeq = 0;
  this.chunkOffset = 0;

  this.write = async (blob) => {
    this.blobs.push(blob);
    if (Date.now() - this.tickWritten < MINIMUN_WRITE_INTERVAL) return;
    this.tickWritten = Date.now();

    const blobJoined = new Blob(this.blobs, { type: BLOB_TYPE });
    const key = getKey(fullPath, this.chunkSeq);

    if (blobJoined.size >= MAX_CHUNK_SIZE_) {
      ++this.chunkSeq;
      this.blobs = [];
      this.chunkOffset += blobJoined.size;
    }

    this.db.put(blobJoined, this.chunkOffset, key);
  };

  this.close = async () => {
    if (this.blobs.length) {
      this.tickWritten = 0;
      await this.write(new Blob());
      this.blobs = [];
    }
    console.debug(`${this.fullPath} is closed`);
    this.db = undefined;
  };
} // BlobWriter

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

if (window.IDBBlobTest) {
  let idbdb;
  window.onload = () => {
    idbdb = new BlobIDB();
  };

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
      for (const file of evt.target.files) {
        // { name, size, type }
        idbdb.upload(file, "/upload");
      }
    },
    "change"
  );
  setHandler(`<button>reopen idb</button>`, async (evt) => {
    idbdb.closeDB();
    idbdb = new BlobIDB();
  });

  setHandler(`<hr/><input id='fs-path'></input>`);

  //
  // write
  //
  let writer;
  setHandler(`<button>WRITE FILE</button>`, async (evt) => {
    if (writer) return;

    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) {
      path = `/folder1/rec-${new Date().toLocaleString().replace(/[/:]/g, ".")}.bin`;
      document.querySelector("#fs-path").value = path;
    }

    writer = new BlobWriter(path, idbdb);

    let offset = 0;
    const { buffer } = buildArrayBuffer(1024 * 1024 * 15);
    checkBuffer(buffer);

    const writeInterval = setInterval(() => {
      let n = getRandomInt((5000 / 8) * 30 - 4096, (5000 / 8) * 30);
      const chunk = buffer.slice(offset, offset + n);
      const blob = new Blob([chunk], { type: BLOB_TYPE });
      writer.write(blob);

      offset += n;
      if (offset >= buffer.byteLength) {
        clearInterval(writeInterval);
        writer.close();
        writer = undefined;
      }
    }, SEND_INTERVAL);
  });

  setHandler(`<button>STOP WRITE and DIR</button>`, async (evt) => {
    await writer.close();

    const pathlist = await idbdb.dir(path);
    console.log("---------------------------------------------------");
    console.log([...pathlist].join("\n"));
  });
  //
  // read file
  //
  setHandler(`<button>READ FILE</button>`, async (evt) => {
    const path = document.querySelector("#fs-path").value;
    if (path.length < 3) return;
    document.querySelector("#fs-path").value = "";

    const blob = await idbdb.getBlob(path);
    console.log(`[read] size= ${getByteSize(blob)}`);
    if (await checkBuffer(blob, 0)) console.log("verified");
  });

  //
  // download
  //

  setHandler(`<button>DOWNLOAD</button>`, async (evt) => {
    const path = document.querySelector("#fs-path").value;
    if (path.length < 3) return;

    const blob = await idbdb.getBlob(path);
    console.log(`[read] size= ${getByteSize(blob)}`);

    const link = document.createElement("a");
    link.download = path;
    link.href = window.URL.createObjectURL(blob);
    link.click();
    window.URL.revokeObjectURL(link.href); // jjkim
  });

  setHandler(`<button>DIR</button>`, async (evt) => {
    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) path = undefined;

    const pathlist = await idbdb.dir(path);
    console.log("---------------------------------------------------");
    console.log([...pathlist].join("\n"));
  });
}
