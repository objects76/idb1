//
// key optimized indexed db blob saver with tick.
//
"use strict";
import { getRandomInt, getTestBlob, verifyTestBlob, getByteSize, addTestWidget, downloadBlob } from "./Devtools.js";

const MAX_CHUNK_SIZE_ = 10 * 1024 * 1024;
const BLOB_TYPE_ = "application/octet-stream";

if (!window.indexedDB) window.indexedDB = window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;

const getKey = (tick, seq) => {
  console.assert(typeof tick === "number", `tick is ${typeof tick}`);
  console.assert(typeof seq === "number", `seq is ${typeof seq}`);
  return tick * 256 + seq;
};

const getTick = (key) => {
  console.assert(typeof key === "number", `key is ${typeof key}`);
  return Math.floor(key / 256);
};

const STORE0 = "store0";
export default class BlobIDB {
  constructor(dbname = "blob.test.db") {
    this.idb;
    const request = window.indexedDB.open(dbname, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const store = db.createObjectStore(STORE0);
    };

    request.onsuccess = (evt) => {
      this.idb = request.result;
      console.log(`'${dbname}' is opened`);
    };
  }
  close = () => {
    this.idb.close();
    this.idb = undefined;
  };
  static drop = (dbname) => {
    const request = window.indexedDB.deleteDatabase(dbname);
    request.onsuccess = (evt) => console.log(`${dbname} successfully deleted`);
    request.onerror = (evt) => console.error(`${dbname} error when delete database`);
    this.idb = undefined;
  };

  put = (blob, blobOffset, key) => {
    console.debug(`[db.write] ${key.toString(16)}, ${blob.size}, offset=${blobOffset}`);

    const tx = this.idb.transaction([STORE0], "readwrite", { durability: "relaxed" });
    const request = tx.objectStore(STORE0).put({ blob, blobOffset }, key);
    request.onsuccess = (evt) => console.debug(`${evt.target.result} done for ${key.toString(16)}`);

    //return new Promise((resolve, reject) => setuptx(tx, resolve, reject));
  };

  getLastChunk = (tick, onLastChunk) => {
    const range = BlobIDB.getBound(tick);

    const tx = this.idb.transaction([STORE0], "readonly");
    var request = tx.objectStore(STORE0).openCursor(range, "prev");
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const chunkKey = cursor.key;
        const blob = cursor.value.blob;
        const blobOffset = cursor.value.blobOffset;

        onLastChunk(chunkKey, blob, blobOffset);
        cursor.advance(999);
      }
    };

    return new Promise((resolve, reject) => setuptx(tx, resolve, reject));
  };

  getBlob = (tick) => {
    return new Promise((resolve, reject) => {
      const range = BlobIDB.getBound(tick);
      const tx = this.idb.transaction([STORE0], "readonly");
      const request = tx.objectStore(STORE0).getAll(range);
      request.onerror = () => reject(request.error || `Can't read ${tick}`);
      request.onsuccess = () => {
        console.debug(`all blobs = #${request.result.length}`);
        resolve(
          new Blob(
            request.result.map((v) => v.blob),
            { type: BLOB_TYPE_ }
          )
        );
      };
    });
  };

  // delete file: [tickStart, tickEnd]
  delete = async (tickStart, tickEnd = Date.now()) => {
    const range = tickStart ? BlobIDB.getBound(tickStart, tickEnd) : undefined;

    const tx = this.idb.transaction([STORE0], "readwrite");
    tx.objectStore(STORE0).delete(range);
    return new Promise((resolve, reject) => {
      setuptx(tx, resolve, reject);
    });
  };

  exist = async (tick) => {
    tick = Number(tick);
    const tx = this.idb.transaction([STORE0], "readonly");
    const request = tx.objectStore(STORE0).get(getKey(tick, 0));

    let existed = false;
    request.onsuccess = (evt) => (existed = !!evt.target.result);

    return new Promise((resolve, reject) => {
      setuptx(tx, () => resolve(existed), reject);
    });
  };

  // return list of files in idb. [tickStart, tickEnd]
  dir = async (tickStart = undefined, tickEnd = undefined) => {
    const range = tickStart ? BlobIDB.getBound(tickStart, tickEnd || Date.now()) : undefined;

    const tx = this.idb.transaction([STORE0], "readonly");
    var request = tx.objectStore(STORE0).openCursor(range, "prev");
    const pathlist = new Map();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const tick = getTick(cursor.key);
        if (!pathlist.get(tick)) {
          const size = cursor.value.blobOffset + cursor.value.blob.size;
          pathlist.set(tick, size);
        }
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      setuptx(tx, () => resolve(pathlist), reject);
    });
  };

  static getBound = (tickStart, tickEnd = undefined) => {
    tickEnd = tickEnd || tickStart;
    return IDBKeyRange.bound(getKey(Number(tickStart), 0), getKey(Number(tickEnd) + 1, 0), false, true);
  };

  // writer class
  static BlobWriter = class {
    constructor(db, tick = undefined, append = true) {
      console.assert(db, `${db}`);
      this.dbWrapper = db;
      this.blobs = [];
      this.tickWritten = Date.now();
      this.key = getKey(tick ? Number(tick) : Date.now(), 0);
      this.chunkOffset = 0;

      // get previous data.
      // TODO: await is needed?
      if (append) {
        this.dbWrapper.getLastChunk(tick, (chunkKey, blob, blobOffset) => {
          this.key = chunkKey;
          this.blobs.push(blob);
          this.chunkOffset = blobOffset;
          console.debug(
            `BlobWriter: ${tick.toString(16)}, last chunk: key=${chunkKey.toString(16)}, blob=${
              blob.size
            }, blobOffset=${blobOffset}`
          );
        });
      } else {
        this.dbWrapper.delete(tick);
      }
    }

    write = async (blob, delayed = 100) => {
      if (!this.dbWrapper) {
        console.warn("BlobWriter is closed.");
        return;
      }
      this.blobs.push(blob);
      if (Date.now() - this.tickWritten < delayed) return;
      this.tickWritten = Date.now();

      const blobJoined = new Blob(this.blobs, { type: BLOB_TYPE_ });
      const key = this.key;
      const chunkOffset = this.chunkOffset;
      if (blobJoined.size >= MAX_CHUNK_SIZE_) {
        ++this.key;
        this.blobs = [];
        this.chunkOffset += blobJoined.size;
        if ((this.key & 0xff) === 0) {
          console.warn(`Write reached to maximum file size.`);
          this.close();
        }
      }

      this.dbWrapper.put(blobJoined, chunkOffset, key);
    };

    close = async () => {
      await this.write(new Blob(), 0);
      this.blobs = [];
      console.debug(`${this.key} is closed, last chunk is ${this.key & 0xff}`);
      this.dbWrapper = undefined;
    };
  }; // BlobWriter
} // class BlobIDB

function setuptx(tx, resolve, reject) {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error || new DOMException("IDBError", "IDBError"));
  tx.onabort = () => reject(tx.error || new DOMException("IDBAbort", "IDBAbort"));
}

//
//
//
//
//------------------------------------------------------------------------------
// test: utils for test setup.
//------------------------------------------------------------------------------

const SEND_INTERVAL = 50; // ms
const DELAYED_WRITE = 100;

if (window.IDBBlobTest) {
  let idbdb;
  window.onload = () => {
    idbdb = new BlobIDB();
  };

  addTestWidget(
    `<input type='file' multiple/>`,
    async (evt) => {
      for (const file of evt.target.files) {
        //idbdb.upload(file, "/upload");
        writer = new BlobIDB.BlobWriter(idbdb);
        writer.write(file);
        writer.close();
      }
    },
    "change"
  );
  addTestWidget(`<hr/><input id='fs-path'></input>`);

  //
  // write
  //
  let writer;
  addTestWidget(`<button>WRITE FILE</button>`, async (evt) => {
    if (writer) return;

    let tick = document.querySelector("#fs-path").value;
    if (tick.length < 3) {
      tick = Date.now();
      document.querySelector("#fs-path").value = tick;
    }

    writer = new BlobIDB.BlobWriter(idbdb, tick);

    let offset = 0;
    const testBlob = getTestBlob(1024 * 1024 * 150);
    await verifyTestBlob(testBlob);
    console.debug(`write test: blob=${getByteSize(testBlob.size)}`);

    const writeInterval = setInterval(() => {
      if (!writer) clearInterval(writeInterval);
      else {
        const n = getRandomInt(3 * 1024 * 1024, 10 * 1024 * 1024 + 1);
        const chunk = testBlob.slice(offset, offset + n - (n % 256));
        console.debug(`try write ${getByteSize(chunk.size)}`);
        writer.write(chunk, DELAYED_WRITE);
        offset += chunk.size;
        if (offset >= testBlob.size) {
          clearInterval(writeInterval);
          writer.close();
          writer = undefined;
        }
      }
    }, SEND_INTERVAL);
  });

  addTestWidget(`<button>STOP WRITE and VERIFY</button>`, async (evt) => {
    await writer?.close(); // it means un-expected stop(lik closing browser tab).
    writer = undefined;
    document.querySelector("#read").click();
  });
  //
  // read file
  //
  addTestWidget(`<button id='read'>VERIFY FILE</button>`, async (evt) => {
    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) return;
    document.querySelector("#fs-path").value = "";

    const blob = await idbdb.getBlob(path);
    console.log(`[read] size= ${getByteSize(blob)}`);
    if (await verifyTestBlob(blob, 0)) console.log("verified");
  });

  //
  // download
  //
  addTestWidget(`<button>DOWNLOAD</button>`, async (evt) => {
    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) return;

    const blob = await idbdb.getBlob(path);
    console.log(`[read] size= ${getByteSize(blob)}`);
    downloadBlob(blob, path);
  });

  //
  // dir
  //
  addTestWidget(`<button id='dir'>DIR</button>`, async (evt) => {
    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) path = undefined;

    const pathlist = await idbdb.dir(path);
    console.log("---------------------------------------------------");
    console.log([...pathlist].join("\n"));

    const htmls = [];
    htmls.push(`<li>[${path ? path : "all"}, ${new Date().toLocaleString()}]</li>`);
    for (const [path, size] of pathlist) {
      htmls.push(`<li><a href='#${path}'>${new Date(path).toLocaleString()}</a>, size=${getByteSize(size)}</li>`);
    }

    document.querySelector("#ui-dir").innerHTML = htmls.join("\n");
  });

  //
  // existed
  //
  addTestWidget(`<button>EXISTED</button>`, async (evt) => {
    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) return;

    console.log(path, "=", await idbdb.exist(path));
  });

  //
  // list ui
  //
  addTestWidget("<ul id='ui-dir'></ul>", (evt) => {
    evt.stopPropagation();
    evt.preventDefault();
    if (evt.target.hash) document.querySelector("#fs-path").value = window.decodeURI(evt.target.hash.substring(1));
  });
}
