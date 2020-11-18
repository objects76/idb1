//
// using idb as binary file saving.
//

//window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

// DON'T use "var indexedDB = ..." if you're not in a function.
// Moreover, you may need references to some window.IDB* objects:
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;

const FILE_DB_ = "db for files";
const FILE_STORE_ = "files";
const MAX_CHUNK_SIZE_ = 5 * 1024 * 1024;
const BLOB_TYPE = "application/octet-stream; charset=utf-8";

export class IDBFile {
  constructor(fullPath, db) {
    this._file = {
      fullPath,
      blob: new Blob([]),
    };
    this.lastModifiedDate = Date.now() - 500;
    this.chunkSeq = 0;
    //this.totolSize = 0;
    this.key = this._file.fullPath + ":" + this.chunkSeq;

    this.idbdb = db;
  }

  write = async (blob) => {
    this._file.blob = new Blob([this._file.blob, blob], { type: BLOB_TYPE });
    if (Date.now() - this.lastModifiedDate >= 1000) {
      this.lastModifiedDate = Date.now();
      // write every 1sec.
      return this.idbdb.put(this); // ok();
    }
  };
  close = async () => {
    if (this._file.blob.size > 0) return this.idbdb.put(this);
  };
  _nextChunk = () => {
    if (this._file.blob.size >= MAX_CHUNK_SIZE_) {
      ++this.chunkSeq;
      this._file.blob = new Blob([]);
      this.key = this._file.fullPath + ":" + this.chunkSeq;
    }
  };

  _set = (chunkSeq, totalSize, blob) => {
    this.chunkSeq = chunkSeq;
    //this.totalSize = totalSize;
    this.key = this._file.fullPath + ":" + this.chunkSeq;
    this._file.blob = blob;
  };
}

export default class IDBBlob {
  constructor() {
    this.db;

    var openRequest = window.indexedDB.open(FILE_DB_, 1);
    openRequest.onupgradeneeded = (event) => {
      const db = event.target.result;
      db.onerror = (evt) => console.error(evt);

      if (!db.objectStoreNames.contains(FILE_STORE_)) {
        const store = db.createObjectStore(FILE_STORE_ /*,{keyPath: 'id', autoIncrement: true}*/);
        store.createIndex("fullPath", "fullPath", { unique: false });
      }
    };

    openRequest.onsuccess = (evt) => {
      this.db = openRequest.result;
      console.log(`'${FILE_DB_}' is opened`);
    };
  }

  put = (idbfile) => {
    return new Promise((ok, ng) => {
      const tx = this.db.transaction([FILE_STORE_], "readwrite");
      const request = tx.objectStore(FILE_STORE_).put(idbfile._file, idbfile.key);
      tx.onabort = () => ng(request.error);
      tx.onerror = () => ng(request.error);
      tx.oncomplete = (evt) => {
        // TODO: Error is thrown if we pass the request event back instead.
        console.log("write done:", idbfile.key, getByteSize(idbfile._file.blob.size));
        idbfile._nextChunk();
        ok();
      };
    });
  };

  open = async (fullPath, for_write = true) => {
    const idbfile = new IDBFile(fullPath, this);

    if (for_write) {
      const chunk = await this.getLastChunk(fullPath);
      if (chunk) idbfile._set(chunks.chunkSeq, chunks.totalSize, chunks.blob);
    } else {
      const chunk = await this.getChunks(fullPath);
      if (!chunk) throw new Error("No data for " + fullPath);
      idbfile._set(chunk.chunkSeq, chunk.totalSize, chunk.blob);
    }
    return idbfile;
  };

  getLastChunk = (fullPath) => {
    const tx = this.db.transaction([FILE_STORE_], "readonly");
    const index = tx.objectStore(FILE_STORE_);
    return new Promise((ok, ng) => {
      const request = index.openCursor(IDBKeyRange.only(fullPath), "prev");
      request.onerror = () => ng(request.error);
      request.onsuccess = (evt) => {
        const cursor = evt.target.result;
        if (cursor) {
          const chunkSeq = IDBBlob.getChunkSequence(cursor.primaryKey);
          ok({ chunkSeq, blob: cursor.value.blob, totalSize: -1 });
          cursor.advance(99999);
        } else {
          ok(undefined);
        }
      };
    });
  };

  getChunks = (fullPath) => {
    const tx = this.db.transaction([FILE_STORE_], "readonly");
    const index = tx.objectStore(FILE_STORE_).index("fullPath");
    return new Promise((ok, ng) => {
      const request = index.getAll(IDBKeyRange.only(fullPath));
      request.onerror = () => ng(request.error);
      request.onsuccess = () => {
        console.log(request.result);
        ok(new Set());
      };
    });

    // const tx = this.db.transaction([FILE_STORE_], "readonly");
    // const index = tx.objectStore(FILE_STORE_).index("fullPath");

    // return new Promise((ok, ng) => {
    //   const blobs = [];
    //   let lastKey;
    //   const request = index.openCursor(IDBKeyRange.only(fullPath));
    //   request.onerror = () => ng(request.error);
    //   request.onsuccess = (evt) => {
    //     const cursor = evt.target.result;
    //     if (cursor) {
    //       lastKey = cursor.primaryKey;
    //       blobs.push(cursor.value.blob);
    //       cursor.continue();
    //     } else {
    //       // { chunkSeq, blob, totalSize }
    //       if (lastKey) {
    //         const chunkSeq = IDBBlob.getChunkSequence(lastKey);
    //         const blob = new Blob(blobs, { type: BLOB_TYPE });
    //         ok({ chunkSeq, blob, totalSize });
    //       } else {
    //         ok(undefined);
    //       }
    //     }
    //   };
    // });
  };

  static getChunkSequence = (key) => {
    return Number(key.substring(key.lastIndexOf(":") + 1));
  };
  static dropDb = (dbname) => {
    console.log(`req: drop ${dbname}`);
    const request = window.indexedDB.deleteDatabase(dbname);
    request.onsuccess = (evt) => {
      console.log(`${dbname} successfully cleared and dropped`);
    };
    request.onerror = (evt) => {
      console.error(`${dbname} error when drop database`);
    };
  };

  // return list of files in idb.
  dir = async (folder) => {
    const tx = this.db.transaction([FILE_STORE_], "readonly");
    const objectStore = tx.objectStore(FILE_STORE_);
    if (folder) {
      const DIR_SEPARATOR = "/";
      const DIR_OPEN_BOUND = String.fromCharCode(DIR_SEPARATOR.charCodeAt(0) + 1);
      //var request = tx.objectStore(FILE_STORE_).get(fullPath);
      return new Promise((ok, ng) => {
        var range = IDBKeyRange.bound(folder, folder + DIR_OPEN_BOUND, false, true);
        var request = tx.objectStore(FILE_STORE_).openCursor(range);
        let results = new Set([]);
        request.onerror = () => ng(request.error);
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            results.add(cursor.value.fullPath);
            cursor.continue();
          } else {
            ok(results);
          }
        };
      });
    }

    return new Promise((ok, ng) => {
      const request = objectStore.openCursor();
      let results = new Set([]);
      request.onerror = () => ng(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.add(cursor.value.fullPath);
          cursor.continue();
        } else {
          ok(results);
        }
      };
    });
  };

  delete = async (fullPath) => {
    const keyRangeValue = IDBKeyRange.only(fullPath);
    const tx = this.db.transaction([FILE_STORE_], "readwrite");
    const objectStore = tx.objectStore(FILE_STORE_).index("fullPath");

    return new Promise((ok, ng) => {
      const request = objectStore.openCursor(keyRangeValue);
      request.onerror = () => ng(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          ok();
        }
      };
    });
  };
} // class IDBBlob

const getByteSize = (n) => {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(2) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
};

function main(symbol) {
  if (!symbol) return;

  //   // TODO:
  //   // 1. get list in db.
  //   // 2. delete file in db.
  //   //
  //   return;

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

  //------------------------------------------------------------------------------
  // test
  //------------------------------------------------------------------------------

  let idbdb;
  window.onload = () => {
    //IDBBlob.dropDb(FILE_DB_); // first clear old db.
    idbdb = new IDBBlob();
  };

  let fileWriter;
  let writeInterval;
  const stopWriter = async () => {
    if (!writeInterval) return false;

    clearInterval(writeInterval);
    writeInterval = undefined;
    await fileWriter?.close();
    fileWriter = undefined;
    return true;
  };
  setHandler(`<button id='fs-write'>write</button>`, async (evt) => {
    if (!stopWriter()) return;

    const path = `/folder1/rec-${new Date().toLocaleString().replace(/[/:]/g, ".")}.mp4`;
    fileWriter = await idbdb.open(path, true);

    writeInterval = setInterval(() => {
      const sizePerSec = (5000 / 8) * 30;
      const newData = new Blob([new ArrayBuffer(sizePerSec)], { type: BLOB_TYPE });
      fileWriter.write(newData);
    }, 0);
  });

  setHandler(`<button id='fs-read'>read</button>`, async (evt) => {
    const path = "/folder1/folder2/test1.txt";

    stopWriter();

    const reader = await idbdb.open(path, false);

    console.log(reader);
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

  setHandler(`<button id='fs-download'>download</button>`, async (evt) => {
    const path = "/folder1/folder2/test1.txt";

    stopWriter();

    const reader = await idbdb.open(path, false);

    if (reader) downloadBlob(reader._file.blob, reader._file.fullPath);
  });

  //
  // list files
  //
  setHandler(`<button id='fs-list'>list</button>`, async (evt) => {
    stopWriter();

    const files = await idbdb.dir("/folder1");
    console.log(new Array(...files).join("\n"));
  });

  //
  // delete files
  //
  setHandler(`<hr/><input id='fs-path'></input>`);
  setHandler(`<button id='fs-delete'>delete</button>`, async (evt) => {
    stopWriter();
    const path = document.querySelector("#fs-path").value;

    await idbdb.delete(path);

    const files = await idbdb.dir();
    console.log(new Array(...files).join("\n"));
    document.querySelector("#fs-path").value = "";
  });
}
main(window.IDBBlobTest);