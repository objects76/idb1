"use strict";
import devInit, { getRandomInt, getTestBlob, verifyTestBlob, getByteSize } from "./Devtools.js";
devInit();

const FILE_DB_ = "blob.test.db";
const FILE_STORE_ = "blobstore";
const MAX_CHUNK_SIZE_ = 1 * 1024 * 1024;
const MAX_FILE_SIZE_ = 512 * 1024 * 1024;
const BLOB_TYPE = "application/octet-stream";
const MINIMUN_WRITE_INTERVAL = 100; // ms

if (!window.indexedDB) window.indexedDB = window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;

const getKey = (path, seq) => path + ":" + ("00" + seq).slice(-3); // up to (MAX_CHUNK_SIZE_*1000).
const getPath = (key) => key.slice(0, -4);
const nextChar = (c) => String.fromCharCode(c.charCodeAt(0) + 1);

export default class BlobIDB {
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
  close = () => {
    this.idb.close();
    this.idb = undefined;
  };
  static drop = (dbname) => {
    dbname = dbname || FILE_DB_;
    const request = window.indexedDB.deleteDatabase(dbname);
    request.onsuccess = (evt) => console.log(`${dbname} successfully deleted`);
    request.onerror = (evt) => console.error(`${dbname} error when delete database`);
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

  getLastChunk = (fullPath, onLastChunk) => {
    const range = IDBKeyRange.bound(fullPath + ":", fullPath + nextChar(":"), false, true);

    const tx = this.idb.transaction([FILE_STORE_], "readonly");
    var request = tx.objectStore(FILE_STORE_).openCursor(range, "prev");
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const chunkSeq = Number(cursor.key.slice(-3));
        const blob = cursor.value.blob;
        const blobOffset = cursor.value.blobOffset;

        onLastChunk(chunkSeq, blob, blobOffset);
        cursor.advance(999);
      }
    };

    return new Promise((resolve, reject) => setuptx(tx, resolve, reject));
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

  // delete file
  delete = async (folder) => {
    const tx = this.idb.transaction([FILE_STORE_], "readwrite");
    const range = IDBKeyRange.bound(folder + ":", folder + nextChar(":"), false, true);
    tx.objectStore(FILE_STORE_).delete(range);
    return new Promise((resolve, reject) => {
      setuptx(tx, resolve, reject);
    });
  };

  exist = async (fullPath) => {
    const tx = this.idb.transaction([FILE_STORE_], "readonly");
    const request = tx.objectStore(FILE_STORE_).get(getKey(fullPath, 0));

    let existed = false;
    request.onsuccess = (evt) => (existed = !!evt.target.result);

    return new Promise((resolve, reject) => {
      setuptx(tx, () => resolve(existed), reject);
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
} // class BlobDB

function setuptx(tx, resolve, reject) {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error || new DOMException("IDBError", "IDBError"));
  tx.onabort = () => reject(tx.error || new DOMException("IDBAbort", "IDBAbort"));
}

export function BlobWriter(fullPath, db, append = true) {
  this.blobs = [];
  this.tickWritten = Date.now();
  this.chunkSeq = 0;
  this.chunkOffset = 0;

  // get previous data.
  // TODO: await is needed?
  if (append) {
    db.getLastChunk(fullPath, (chunkSeq, blob, blobOffset) => {
      this.chunkSeq = chunkSeq;
      this.blobs.push(blob);
      this.chunkOffset = blobOffset;
      console.debug(
        `BlobWriter: ${fullPath}, last chunk: seed=${chunkSeq}, blob=${blob.size}, blobOffset=${blobOffset}`
      );
    });
  } else {
    db.delete(fullPath);
  }

  this.write = async (blob, delayed = MINIMUN_WRITE_INTERVAL) => {
    if (!db) {
      console.warn("invalid db reference");
      return;
    }
    this.blobs.push(blob);
    if (Date.now() - this.tickWritten < delayed) return;
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
    await this.write(new Blob(), 0);
    this.blobs = [];
    console.debug(`${this.fullPath} is closed`);
    db = undefined;
  };
} // BlobWriter

if (window.IDBBlobTest) {
  let idbdb;
  window.onload = () => {
    idbdb = new BlobIDB();
  };
  window.onbeforeunload = () => {
    idbdb.close();
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
        //idbdb.upload(file, "/upload");
        writer = new BlobWriter("/upload/" + file.name, idbdb);
        writer.write(file);
        writer.close();
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
      n -= n % 256; // align 256.

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

  setHandler(`<button>STOP WRITE and READ</button>`, async (evt) => {
    await writer?.close(); // it means un-expected stop(lik closing browser tab).
    writer = undefined;
    document.querySelector("#read").click();
  });
  //
  // read file
  //
  setHandler(`<button id='read'>READ FILE</button>`, async (evt) => {
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
    htmls.push(`<li>[${path ? path : "/"}, ${new Date().toLocaleString()}]</li>`);
    for (const [path, size] of pathlist) {
      htmls.push(`<li><a href='#${path}'>${path}</a>, size=${size}</li>`);
    }

    ul.innerHTML = htmls.join("\n");
  });

  //
  // rmdir
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

  //
  // existed
  //
  setHandler(`<button>EXISTED</button>`, async (evt) => {
    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) return;

    console.log(path, "=", await idbdb.exist(path));
  });
}
