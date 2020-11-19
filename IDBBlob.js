"use strict";
import devInit, { getRandomInt, buildArrayBuffer, checkBuffer, checkLinear } from "./Devtools.js";
// devInit();
//
// using idb as binary file saving.
//
//window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;

console.assert(new Blob(["ä"]).size === 2);

const FILE_DB_ = "db for files";
const FILE_STORE_ = "files";
const MAX_CHUNK_SIZE_ = 1 * 1024 * 1024;
const BLOB_TYPE = "application/octet-stream; charset=utf-8";
const MAX_FILE_SIZE = 1024 * 1024 * 1024 * 1024; // 1GB
const MINIMUN_WRITE_INTERVAL = 100; // ms

export class IDBFile {
  constructor(fullPath, db) {
    this._file = {
      fullPath,
      blob: new Blob([]),
      blobOffset: 0,
    };
    this.lastModifiedDate = Date.now() - 500;
    this.chunkSeq = 0;
    this.key = this._file.fullPath + ":" + this.chunkSeq;

    this.idbdb = db;
    this.lastWrite;
  }

  queuedBlobs = [];
  enterCount = 0;
  writeDelayed2 = async (blob) => {
    this.queuedBlobs.push(blob);

    if (Date.now() - this.lastModifiedDate >= MINIMUN_WRITE_INTERVAL) {
      this._file.blob = new Blob([this._file.blob, ...this.queuedBlobs], { type: BLOB_TYPE });
      this.queuedBlobs = [];
      this.lastModifiedDate = Date.now();

      ++this.enterCount;
      console.debug(
        `enter${this.enterCount - this.exitCount}: offset=${this._file.blobOffset}, size=${this._file.blob.size}, seq=${
          this.enterCount
        }`
      );
      await this.idbdb.put(this._file, this.key, this._nextChunk2); // ok();
    }
  };

  exitCount = 0;
  _nextChunk2 = async (writtenFile) => {
    if (writtenFile.blob.size >= MAX_CHUNK_SIZE_) {
      // make changing where chunk border...
      // make another writeDelayed2.put.
      const sleep = (ms) => new Promise((ok, ng) => setTimeout(ok, ms));
      await sleep(MINIMUN_WRITE_INTERVAL + 100);
      ++this.exitCount;
      console.warn(`exit : offset=${this._file.blobOffset}, size=${writtenFile.blob.size}, seq=${this.exitCount}`);
      //console.assert(this.exitCount === this.enterCount);

      ++this.chunkSeq;

      // remove written blobs from this._file.blob.
      const addedBlobBetweenWrittingInWebApi = this._file.blob.size - writtenFile.blob.size;
      if (addedBlobBetweenWrittingInWebApi)
        console.warn(`addedBlobBetweenWrittingInWebApi = ${addedBlobBetweenWrittingInWebApi}`);

      this._file.blob = this._file.blob.slice(writtenFile.blob.size);
      this._file.blobOffset += writtenFile.blob.size;
      this.key = this._file.fullPath + ":" + this.chunkSeq;
    } else {
      ++this.exitCount;
      console.debug(`exit : offset=${this._file.blobOffset}, size=${writtenFile.blob.size}, seq=${this.exitCount}`);
    }
  };

  writeDelayed3 = async (blob) => {
    this.queuedBlobs.push(blob);

    if (Date.now() - this.lastModifiedDate >= MINIMUN_WRITE_INTERVAL) {
      this.lastModifiedDate = Date.now();
      this._file.blob = new Blob([this._file.blob, ...this.queuedBlobs], { type: BLOB_TYPE });
      this.queuedBlobs = [];

      const curFile = { ...this._file, blob: this._file.blob.slice() };
      this.idbdb.put(curFile, this.key, (writtenFile) => {
        if (writtenFile.blob.size >= MAX_CHUNK_SIZE_) {
          ++this.chunkSeq;
          console.assert(
            this._file.blob.size === writtenFile.blob.size,
            `cursize=${this._file.blob.size}, written=${writtenFile.blob.size}`
          );
          this._file.blobOffset += writtenFile.blob.size;
          this.key = this._file.fullPath + ":" + this.chunkSeq;
          this._file.blob = new Blob([], { type: BLOB_TYPE });
        }
      }); // ok();
    }
  };

  writeDelayed = async (blob) => {
    this._file.blob = new Blob([this._file.blob, blob], { type: BLOB_TYPE });
    if (Date.now() - this.lastModifiedDate >= MINIMUN_WRITE_INTERVAL) {
      this.lastModifiedDate = Date.now();
      this.idbdb.put(this._file, this.key, this._nextChunk); // ok();
    }
  };

  writeTest = async (blob) => {
    this._file.blob = new Blob([this._file.blob, blob], { type: BLOB_TYPE });
    this.idbdb.put(this._file, this.key, (written) => {
      if (this._file.blob.size >= MAX_CHUNK_SIZE_) {
        ++this.chunkSeq;
        this.key = this._file.fullPath + ":" + this.chunkSeq;
        this._file.blobOffset += this._file.blob.size;
        this._file.blob = new Blob([]);
      }
    });
  };

  newblobs = [];
  chunkSize = 0;
  append = async (blob) => {
    this.newblobs.push(blob);

    if (Date.now() - this.lastModifiedDate < MINIMUN_WRITE_INTERVAL) return;
    this.lastModifiedDate = Date.now();

    if (this.chunkSize >= MAX_CHUNK_SIZE_) {
      ++this.chunkSeq;
      this._file.blobOffset += this.chunkSize;
      console.debug(`chunk.${this.chunkSeq}, offset=${this._file.blobOffset}`);
      this.chunkSize = 0;
    }

    const chunk = {
      blob: new Blob(this.newblobs, { type: BLOB_TYPE }),
      blobOffset: this._file.blobOffset,
      fullPath: this._file.fullPath,
    };
    this.newblobs = [];
    this.chunkSize += chunk.blob.size;
    const key = this._file.fullPath + ":" + this.chunkSeq;

    await checkLinear(chunk.blob); // check source is valid, i suspect idb write action.

    await this.idbdb.append(chunk, key, (written) => {});
  };

  write = this.append;
  close = this.close2;

  close2 = async () => {
    this.lastWrite = undefined;

    console.log(`write close: ${this._file.fullPath}`);

    if (this.queuedBlobs.length > 0) {
      this.lastModifiedDate = Date.now();
      this._file.blob = new Blob([this._file.blob, ...this.queuedBlobs], { type: BLOB_TYPE });
      this.queuedBlobs = [];

      const curFile = { ...this._file, blob: this._file.blob.slice() };
      await this.idbdb.put(curFile, this.key, (writtenFile) => {
        console.log("flushed");
      });
    }

    this.idbdb = undefined;
    console.debug(
      `write close: ${this._file.fullPath}, total=${getByteSize(this._file.blobOffset + this._file.blob.size)}`
    );
  };

  close1 = async () => {
    console.log(`write close: ${this._file.fullPath}`);
    // if (this.lastWrite) await this.lastWrite;
    // console.debug(`write close: ${this._file.fullPath}, all write flushed`);

    // if (this._file.blob.size > 0) {
    //   await this.idbdb.put(this._file, this.key, this._nextChunk);
    //   console.debug(`write close: ${this._file.fullPath}, remained data flushed`);
    // }

    console.debug(
      `write close: ${this._file.fullPath}, total=${getByteSize(this._file.blobOffset + this._file.blob.size)}`
    );
    this.lastWrite = undefined;
    this.idbdb = undefined;
  };

  _set = (chunkSeq, _file) => {
    this.chunkSeq = chunkSeq;
    this.key = this._file.fullPath + ":" + this.chunkSeq;
    this._file = _file;
    console.debug(this + "");
  };

  toString = () => {
    const totalSize = getByteSize(this._file.blob.size + this._file.blobOffset);
    const blobSize = getByteSize(this._file.blob.size);
    return `${this.key}: offset=${this._file.blobOffset}, size=${blobSize}/${totalSize}`;
  };
}

//
//
//
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

    openRequest.onerror = (evt) => {
      console.log("dberror:", evt);
      this.db.close();
    };
  }
  closeDB = () => {
    this.db.close();
  };

  put = (_file, key, done) => {
    if (_file.blobOffset + _file.blob.size > MAX_FILE_SIZE) {
      const remained = MAX_FILE_SIZE - _file.blobOffset;
      _file.blob = _file.blob.slice(0, remained);
      console.warn(`Reached max file size(${MAX_FILE_SIZE}) for ${_file.fullPath}`);
    }

    const tx = this.db.transaction([FILE_STORE_], "readwrite");
    const request = tx.objectStore(FILE_STORE_).put(_file, key);
    return new Promise((ok, ng) => {
      tx.onerror = () => ng(request.error);
      tx.oncomplete = (evt) => {
        console.debug(
          "write done:",
          key,
          getByteSize(_file.blob.size),
          getByteSize(_file.blobOffset + _file.blob.size)
        );
        done(_file);
        ok();
      };
    });
  };

  append = async (_file, key, done) => {
    const tx = this.db.transaction([FILE_STORE_], "readwrite");
    const store = tx.objectStore(FILE_STORE_);

    // get old if existed
    const getRequest = store.get(key);
    const oldBlob = await new Promise((ok, ng) => {
      getRequest.onsuccess = (evt) => {
        const old = getRequest.result;
        ok(old ? old.blob : undefined);
      };
    });

    if (old) _file.blob = new Blob([old.blob, _file.blob]); // append blob.

    return new Promise((ok, ng) => {
      const updateBlobRequest = store.put(_file, key);
      updateBlobRequest.onsuccess = (evt) => {
        done(_file);
        ok();
      };
    });

    getRequest.onsuccess = async (evt) => {
      const old = getRequest.result;
      if (old) _file.blob = new Blob([old.blob, _file.blob]); // append blob.
      const updateBlobRequest = store.put(_file, key);
      updateBlobRequest.onerror = (evt) => {
        console.error(updateBlobRequest.error);
        ng(updateBlobRequest.error);
      };

      updateBlobRequest.onsuccess = (evt) => {
        done(_file);
        ok();
      };
    };

    return new Promise((ok, ng) => {
      const getRequest = store.get(key);
      getRequest.onerror = (evt) => {
        console.error(getRequest.error);
        ng(getRequest.error);
      };
      getRequest.onsuccess = async (evt) => {
        const old = getRequest.result;
        if (old) _file.blob = new Blob([old.blob, _file.blob]); // append blob.
        const updateBlobRequest = store.put(_file, key);
        updateBlobRequest.onerror = (evt) => {
          console.error(updateBlobRequest.error);
          ng(updateBlobRequest.error);
        };

        updateBlobRequest.onsuccess = (evt) => {
          done(_file);
          ok();
        };
      };
    });
  };

  open = async (fullPath, for_write = true) => {
    if (for_write) {
      const idbfile = new IDBFile(fullPath, this);
      const chunk = await this.getLastChunk(fullPath);
      if (chunk) idbfile._set(chunk.chunkSeq, chunk._file);
      return idbfile;
    } else {
      const idbfile = new IDBFile(fullPath, undefined);
      const chunk = await this.getChunks(fullPath);
      if (!chunk) throw new Error("No data for " + fullPath);
      idbfile._set(chunk.chunkSeq, chunk._file);
      return idbfile;
    }
  };

  // <script src="https://cdn.jsdelivr.net/npm/web-streams-polyfill@2.0.2/dist/ponyfill.min.js"></script>
  // <script src="https://cdn.jsdelivr.net/npm/streamsaver@2.0.3/StreamSaver.min.js"></script>

  downloadStream = async (fullPath) => {
    // console.warn(
    //   "blob from indexeddb is just handle, real data is in indexeddb(filesystem), so streamsaver.js is not needed."
    // );
    return new Promise((ok, ng) => {
      const range = IDBKeyRange.bound(fullPath + ":", fullPath + IDBBlob.nextSep(":"), false, true);
      const tx = this.db.transaction([FILE_STORE_], "readonly");
      const request = tx.objectStore(FILE_STORE_).getAll(range);
      request.onerror = () => ng(request.error);
      request.oncancel = () => ng(request.error);
      request.onsuccess = async (evt) => {
        const result = evt.target.result;
        const fileStream = streamSaver.createWriteStream(fullPath);
        let writer = fileStream.getWriter();

        console.log(result);
        for (const { blob } of result) {
          const readableStream = blob.stream();
          const reader = readableStream.getReader();

          while (true) {
            const res = await reader.read();
            if (res.done) break;
            await writer.write(res.value);
          }
          console.log("done writing, goto next chunk");
        }
        if (writer) await writer.close();
        ok();
      };
    });

    // Failed to execute 'continue' on 'IDBCursor': The transaction has finished.
    // -  https://stackoverflow.com/questions/16707499/use-cursor-continue-in-a-callback
  };

  getLastChunk = async (fullPath) => {
    return new Promise((ok, ng) => {
      const range = IDBKeyRange.bound(fullPath + ":", fullPath + IDBBlob.nextSep(":"), false, true);
      const tx = this.db.transaction([FILE_STORE_], "readonly");
      const request = tx.objectStore(FILE_STORE_).openCursor(range, "prev");
      request.onerror = () => ng(request.error);
      request.onsuccess = (evt) => {
        const cursor = evt.target.result;
        if (cursor) {
          const chunkSeq = IDBBlob.getChunkSequence(cursor.primaryKey);
          ok({ chunkSeq, _file: cursor.value });
          cursor.advance(99999);
        } else {
          ok(undefined);
        }
      };
    });
  };

  getChunks = async (fullPath) => {
    return new Promise((ok, ng) => {
      const tx = this.db.transaction([FILE_STORE_], "readonly");
      const range = IDBKeyRange.bound(fullPath + ":", fullPath + IDBBlob.nextSep(":"), false, true);
      const request = tx.objectStore(FILE_STORE_).getAll(range);
      request.onerror = () => ng(request.error);
      request.onsuccess = () => {
        const _file = {
          ...request.result[0],
          blob: new Blob(
            request.result.map((v) => v.blob),
            { type: BLOB_TYPE }
          ),
        };
        ok({ chunkSeq: request.result.length - 1, _file });
        console.log(request.result);
      };
    });
  };

  // return list of files in idb.
  dir = async (folder) => {
    let range;
    if (folder) {
      // select all '/folder/*'
      if (folder.slice(-1) === "/") folder = folder.slice(0, -1);
      range = IDBKeyRange.bound(folder + "/", folder + IDBBlob.nextSep("/"), false, true);
    }

    return new Promise((ok, ng) => {
      const tx = this.db.transaction([FILE_STORE_], "readonly");
      const objectStore = tx.objectStore(FILE_STORE_);
      var request = objectStore.openCursor(range);
      let result = new Set([]);
      request.onerror = () => ng(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          result.add(cursor.value.fullPath);
          cursor.continue();
        } else {
          ok(result);
        }
      };
    });
  };

  delete = async (fullPath) => {
    return new Promise((ok, ng) => {
      const tx = this.db.transaction([FILE_STORE_], "readwrite");
      const range = IDBKeyRange.bound(fullPath + ":", fullPath + IDBBlob.nextSep(":"), false, true);
      const request = tx.objectStore(FILE_STORE_).delete(range);
      request.onerror = () => ng(request.error);
      request.onsuccess = ok;
    });
  };

  upload = async (fileblob, to, chunk = 0) => {
    if (to.slice(-1) !== "/") to += "/";
    const fullPath = to + fileblob.name;
    const writer = await this.open(fullPath, true);
    if (chunk > 0) {
      const size = fileblob.size;
      const sleep = (ms) => new Promise((ok, ng) => setTimeout(ok, ms));
      for (let i = 0; i < size; i += chunk) {
        const end = Math.min(i + chunk, size);
        await writer.write(fileblob.slice(i, end));
        await sleep(100); // too fast put do not work in idb.
      }
    } else {
      await writer.write(fileblob);
    }
    await writer.close();
    console.log(fullPath, "is uploaded");
  };

  // static functions
  static nextSep(sep) {
    return String.fromCharCode(sep.charCodeAt(0) + 1);
  }

  static getChunkSequence(key) {
    return Number(key.substring(key.lastIndexOf(":") + 1));
  }
  static dropDb() {
    const request = window.indexedDB.deleteDatabase(FILE_DB_);
    request.onsuccess = (evt) => {
      console.log(`${FILE_DB_} successfully cleared and dropped`);
    };
    request.onerror = (evt) => {
      console.error(`${FILE_DB_} error when drop database`);
    };
  }
} // class IDBBlob

const getByteSize = (n) => {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(2) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
};

if (window.IDBBlobTest) {
  //import DnDFileController from "./dnd.js";
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

  // handlers = [ {callback, eventName} ]
  const setHandlers = (element, handlers) => {
    document.querySelector("#test-buttons").insertAdjacentHTML("beforeend", element);

    const el = document.querySelector("#test-buttons").querySelector(":last-child");

    for (const { callback, eventName } of handlers) {
      el.addEventListener(eventName ? eventName : "click", callback);
    }
  };

  //------------------------------------------------------------------------------
  // test
  //------------------------------------------------------------------------------
  let idbdb;
  window.onload = () => {
    //IDBBlob.dropDb(); // first clear old db.
    idbdb = new IDBBlob();
  };

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
  let lastOpPath;
  let fileWriter;
  let writeInterval;
  let writeSeed = 0;
  const stopWriter = async () => {
    if (!writeInterval) return false;

    clearInterval(writeInterval);
    writeInterval = undefined;

    await fileWriter.close2();
    fileWriter = undefined;

    console.log(`writeSeed=${writeSeed}`);
    return true;
  };

  setHandler(`<button>WRITE FILE</button>`, async (evt) => {
    if (!stopWriter()) return;

    let path = document.querySelector("#fs-path").value;
    if (path.length < 3) {
      path = `/folder1/rec-${new Date().toLocaleString().replace(/[/:]/g, ".")}.bin`;
      document.querySelector("#fs-path").value = path;
    }
    lastOpPath = path;
    fileWriter = await idbdb.open(path, true);

    writeSeed = 0;
    let nth = 0;
    writeInterval = setInterval(() => {
      let n = getRandomInt((5000 / 8) * 30 - 4096, (5000 / 8) * 30);
      const { nextSeed, buffer } = buildArrayBuffer(n, writeSeed);
      writeSeed = nextSeed;
      fileWriter.write(new Blob([buffer], { type: BLOB_TYPE }));
      // console.log(`[${nth++}] - new chunk: chunk=${n}, total=${writeSeed}`);
    }, 0);
  });
  //
  // list files
  //
  setHandler(`<button>LIST FILES</button>`, async (evt) => {
    await stopWriter();
    const path = document.querySelector("#fs-path").value;
    //document.querySelector("#fs-path").value = "";

    const files = await idbdb.dir(path);
    console.log(new Array(...files).join("\n"));
    renderList(files);
  });

  //
  // read file
  //
  setHandler(`<button>READ FILE</button>`, async (evt) => {
    const path = document.querySelector("#fs-path").value;
    //document.querySelector("#fs-path").value = "";

    stopWriter();
    const datafile = await idbdb.open(path, false);
    console.log("[read]", datafile, "done");
    if (await checkBuffer(datafile._file.blob, 0)) console.log("verified");
  });

  //
  // download
  //
  function downloadBlob(blob, destName) {
    const link = document.createElement("a");
    link.download = destName;
    link.href = window.URL.createObjectURL(blob);
    link.click();
    window.URL.revokeObjectURL(link.href); // jjkim
  }

  setHandler(`<button>download</button>`, async (evt) => {
    stopWriter();
    const path = document.querySelector("#fs-path").value;
    //document.querySelector("#fs-path").value = "";
    const reader = await idbdb.open(path, false);
    if (reader) downloadBlob(reader._file.blob, reader._file.fullPath);
    // NOTE: dir() not work after cacel download bob from idb
  });

  // download with StreamSaver.js
  setHandler(`<button>download stream</button>`, async (evt) => {
    stopWriter();
    let path = document.querySelector("#fs-path").value;
    //document.querySelector("#fs-path").value = "";
    await idbdb.downloadStream(path);
  });

  setHandler(`<button>delete</button>`, async (evt) => {
    stopWriter();
    const path = document.querySelector("#fs-path").value;
    //document.querySelector("#fs-path").value = "";
    await idbdb.delete(path);

    const files = await idbdb.dir();
    console.log(new Array(...files).join("\n"));
  });

  //
  // file lists
  //
  setHandlers("<ul id='ui-dir'></ul>", [
    {
      callback: (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        const a = evt.target;
        console.log(a);
        // const fullPath = a.href.substring(a.baseURI.length + 1);
        const fullPath = decodeURI(a.hash.substring(1));
        console.log("fullPath=", fullPath);
        idbdb.downloadStream(fullPath);
      },
      eventName: "dblclick",
    },
    {
      callback: (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        if (evt.target.hash) document.querySelector("#fs-path").value = decodeURI(evt.target.hash.substring(1));
      },
    },
  ]);

  const renderList = (paths) => {
    const ul = document.querySelector("#ui-dir");
    const htmls = [];
    htmls.push(`<li>[${new Date().toLocaleString()}]</li>`);
    for (const path of paths) {
      htmls.push(`<li><a href='#${path}'>${path}</a></li>`);
    }

    ul.innerHTML = htmls.join("\n");
  };

  // test
  async function unittest() {
    console.log("----------------------unittest------------------------");

    let blobs = [];
    let writeSeed = 0;

    for (let i = 0; i < 4; ++i) {
      let n = getRandomInt((5000 / 8) * 30 - 4096, (5000 / 8) * 30);
      const { nextSeed, buffer } = buildArrayBuffer(n, writeSeed);
      writeSeed = nextSeed;
      blobs.push(buffer);
      console.log(`new chunk: ${n}`);
    }

    checkBuffer(new Blob(blobs, { type: BLOB_TYPE }), 0);
  }
  // unittest();
}
