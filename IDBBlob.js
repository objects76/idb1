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

  getLastChunk = async (fullPath) => {
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

  getChunks = async (fullPath) => {
    const tx = this.db.transaction([FILE_STORE_], "readonly");
    const index = tx.objectStore(FILE_STORE_).index("fullPath");
    return new Promise((ok, ng) => {
      const request = index.getAll(IDBKeyRange.only(fullPath));
      request.onerror = () => ng(request.error);
      request.onsuccess = () => {
        const blob = new Blob(
          request.result.map((v) => v.blob),
          { type: BLOB_TYPE }
        );
        ok({ chunkSeq: request.result.size - 1, blob, totalSize: blob.size });
        console.log(request.result);
      };
    });
  };

  static getChunkSequence = (key) => {
    return Number(key.substring(key.lastIndexOf(":") + 1));
  };
  static dropDb = () => {
    const request = window.indexedDB.deleteDatabase(FILE_DB_);
    request.onsuccess = (evt) => {
      console.log(`${FILE_DB_} successfully cleared and dropped`);
    };
    request.onerror = (evt) => {
      console.error(`${FILE_DB_} error when drop database`);
    };
  };

  // return list of files in idb.
  dir = async (folder) => {
    const tx = this.db.transaction([FILE_STORE_], "readonly");
    const objectStore = tx.objectStore(FILE_STORE_);

    let range;
    if (folder) {
      // select all '/folder/*'
      if (folder[folder.length - 1] === "/") folder = folder.slice(0, -1);
      range = IDBKeyRange.bound(folder + "/", folder + "0", false, true); // ASCII: />0>1>2
    }

    return new Promise((ok, ng) => {
      var request = objectStore.openCursor(range);
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

  upload = async (fileobj, to) => {
    if (to[to.length - 1] !== "/") to += "/";
    const fullPath = to + fileobj.name;
    const writer = await this.open(fullPath, true);
    await writer.write(fileobj);
    await writer.close();
    console.log(fullPath, "is uploaded");
  };
} // class IDBBlob

const getByteSize = (n) => {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(2) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
};

if (window.IDBBlobTest) {
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

  let idbdb;
  window.onload = () => {
    //IDBBlob.dropDb(); // first clear old db.
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

  setHandler(
    `<input type='file' multiple/>`,
    async (evt) => {
      stopWriter();

      for (const file of evt.target.files) {
        // { name, size, type }
        idbdb.upload(file, "/upload");
      }
    },
    "change"
  );

  setHandler(`<hr/><input id='fs-path'></input>`);

  //
  // list files
  //
  setHandler(`<button id='fs-list'>list</button>`, async (evt) => {
    stopWriter();
    const path = document.querySelector("#fs-path").value;
    document.querySelector("#fs-path").value = "";

    const files = await idbdb.dir(path);
    console.log(new Array(...files).join("\n"));
  });

  //
  // delete files
  //
  setHandler(`<button id='fs-read'>read</button>`, async (evt) => {
    const path = document.querySelector("#fs-path").value;
    document.querySelector("#fs-path").value = "";

    stopWriter();
    const reader = await idbdb.open(path, false);
    console.log("reader=", reader);
  });

  //
  // download
  //
  function downloadBlob(blob, destName) {
    const link = document.createElement("a");
    link.download = destName;
    link.href = window.URL.createObjectURL(blob);
    link.click();
  }

  setHandler(`<button id='fs-download'>download</button>`, async (evt) => {
    stopWriter();
    const path = document.querySelector("#fs-path").value;
    document.querySelector("#fs-path").value = "";
    const reader = await idbdb.open(path, false);
    if (reader) downloadBlob(reader._file.blob, reader._file.fullPath);
  });

  setHandler(`<button id='fs-delete'>delete</button>`, async (evt) => {
    stopWriter();
    const path = document.querySelector("#fs-path").value;
    document.querySelector("#fs-path").value = "";
    await idbdb.delete(path);

    const files = await idbdb.dir();
    console.log(new Array(...files).join("\n"));
  });
}
