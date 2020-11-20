"use strict";
import devInit, { getRandomInt, getTestBlob, verifyTestBlob, getByteSize } from "./Devtools.js";
devInit();

const FILE_DB_ = "blob.test.db";
const FILE_STORE_ = "blobstore";
const MAX_CHUNK_SIZE_ = 1 * 1024 * 1024;
const MAX_FILE_SIZE_ = 512 * 1024 * 1024;
const BLOB_TYPE = "application/octet-stream";
const MINIMUN_WRITE_INTERVAL = 100; // ms

//window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;

const getKey = (path, seq) => path + ":" + ("00" + seq).slice(-3); // up to (MAX_CHUNK_SIZE_*1000).
const getPath = (key) => key.slice(0, -4);
const nextChar = (c) => String.fromCharCode(c.charCodeAt(0) + 1);

class BlobIDB {
  constructor() {
    this.idb;
    const request = window.indexedDB.open(FILE_DB_, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const store = db.createObjectStore(FILE_STORE_);
    };

    request.onsuccess = (evt) => {
      this.idb = request.result;
      console.log(`'${FILE_DB_}' is opened`);
    };
  }
  closeDB = () => {
    this.idb.close();
    this.idb = undefined;
  };
  drop = () => {
    const request = window.indexedDB.deleteDatabase(FILE_DB_);
    request.onsuccess = (evt) => console.log(`${FILE_DB_} successfully cleared and dropped`);
    request.onerror = (evt) => console.error(`${FILE_DB_} error when drop database`);
    this.idb = undefined;
  };

  put = (blob, blobOffset, key) => {
    if (blobOffset + blob.size > MAX_FILE_SIZE_) {
      const writtableSize = MAX_FILE_SIZE_ - blobOffset;
      if (writtableSize <= 0) throw new Error(`Can not write data. Maximun file size is ${MAX_FILE_SIZE_}`);
      console.warn(`Maximun file size is ${MAX_FILE_SIZE_}, writtable size=${writtableSize}`);

      blob = blob.slice(0, writtableSize);
    }
    console.debug(`[db.write] ${key}, ${blob.size}, offset=${blobOffset}`);

    const tx = this.idb.transaction([FILE_STORE_], "readwrite");
    const request = tx.objectStore(FILE_STORE_).put({ blob, blobOffset }, key);
    request.onsuccess = (evt) => console.debug(`${evt.target.result} done for ${key}`);

    //return new Promise((resolve, reject) => setuptx(tx, resolve, reject));
  };

  getBlob = (fullPath) => {
    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(fullPath + ":", fullPath + nextChar(":"), false, true);
      const tx = this.idb.transaction([FILE_STORE_], "readonly");
      const request = tx.objectStore(FILE_STORE_).getAll(range);
      request.onerror = () => reject(request.error || `Can't read ${fullPath}`);
      request.onsuccess = () => {
        console.debug(`all blobs = #${request.result.length}`);
        resolve(
          new Blob(
            request.result.map((v) => v.blob),
            { type: BLOB_TYPE }
          )
        );
      };
    });
  };

  rmdir = async (folder) => {
    const tx = this.idb.transaction([FILE_STORE_], "readwrite");
    if (folder) {
      if (folder.endsWith("/")) folder = folder.slice(0, -1);
      const range = IDBKeyRange.bound(folder + "/", folder + nextChar("/"), false, true);
      tx.objectStore(FILE_STORE_).delete(range);
    } else {
      tx.objectStore(FILE_STORE_).clear();
    }

    return new Promise((resolve, reject) => {
      setuptx(tx, resolve, reject);
    });
  };
  // return list of files in idb.
  dir = async (folder) => {
    let range;
    if (folder) {
      if (folder.endsWith("/")) folder = folder.slice(0, -1);
      range = IDBKeyRange.bound(folder + "/", folder + nextChar("/"), false, true);
    }

    const tx = this.idb.transaction([FILE_STORE_], "readonly");

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
    if (!toFolder.endsWith("/")) toFolder += "/";
    const fullPath = toFolder + fileblob.name;
    const key = getKey(fullPath, 0);
    this.put(fileblob, 0, key);
    console.log(key, "is uploaded");
  };
} // class BlobDB

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

function BlobWriter(fullPath, db) {
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
    const chunkOffset = this.chunkOffset;
    if (blobJoined.size >= MAX_CHUNK_SIZE_) {
      ++this.chunkSeq;
      this.blobs = [];
      this.chunkOffset += blobJoined.size;
    }

    db.put(blobJoined, chunkOffset, key);
  };

  this.close = async () => {
    if (this.blobs.length) {
      this.tickWritten = 0;
      await this.write(new Blob());
      this.blobs = [];
    }
    console.debug(`${this.fullPath} is closed`);
    db = undefined;
  };
} // BlobWriter

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
  const SEND_INTERVAL = 0; // ms
  setHandler(
    `<input type='file' multiple/>`,
    async (evt) => {
      for (const file of evt.target.files) {
        idbdb.upload(file, "/upload");
      }
    },
    "change"
  );
  setHandler(`<hr/><input id='fs-path'></input>`);

  //
  // write
  //
  let writer;
  setHandler(`<button>WRITE FILE</button>`, async (evt) => {
    if (writer) return;

    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) {
      path = `/test/rec-${new Date().toLocaleString().replace(/[/:]/g, ".")}.bin`;
      document.querySelector("#fs-path").value = path;
    }

    writer = new BlobWriter(path, idbdb);

    let offset = 0;
    const testBlob = getTestBlob(1024 * 1024 * 15);
    await verifyTestBlob(testBlob);

    const writeInterval = setInterval(() => {
      let n = getRandomInt((5000 / 8) * 30 - 4096, (5000 / 8) * 30);
      if (!writer) clearInterval(writeInterval);
      else {
        const chunk = testBlob.slice(offset, offset + n);
        writer.write(chunk);
        offset += n;
        if (offset >= testBlob.size) {
          clearInterval(writeInterval);
          writer.close();
          writer = undefined;
        }
      }
    }, SEND_INTERVAL);
  });

  setHandler(`<button>STOP WRITE and DIR</button>`, async (evt) => {
    await writer?.close(); // it means un-expected stop(lik closing browser tab).
    writer = undefined;
    document.querySelector("#dir").click();
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
    if (await verifyTestBlob(blob, 0)) console.log("verified");
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

  //
  // dir
  //
  setHandler(`<button id='dir'>DIR</button>`, async (evt) => {
    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) path = undefined;

    const pathlist = await idbdb.dir(path);
    console.log("---------------------------------------------------");
    //console.log([...pathlist].join("\n"));

    const ul = document.querySelector("#ui-dir");
    const htmls = [];
    htmls.push(`<li>[${new Date().toLocaleString()}]</li>`);
    for (const [path, size] of pathlist) {
      htmls.push(`<li><a href='#${path}'>${path}</a>, size=${size}</li>`);
    }

    ul.innerHTML = htmls.join("\n");
  });

  //
  // dir
  //
  setHandler(`<button>RMDIR</button>`, async (evt) => {
    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) path = undefined;

    await idbdb.rmdir(path);
  });

  //
  // file lists
  //
  setHandler("<ul id='ui-dir'></ul>", (evt) => {
    evt.stopPropagation();
    evt.preventDefault();
    if (evt.target.hash) document.querySelector("#fs-path").value = window.decodeURI(evt.target.hash.substring(1));
  });
}
