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
// create an instance of a db object for us to store the IDB data in

var things = [
  { fThing: "Drum kit", fRating: 10 },
  { fThing: "Family", fRating: 10 },
  { fThing: "Batman", fRating: 9 },
  { fThing: "Brass eye", fRating: 9 },
  { fThing: "The web", fRating: 9 },
  { fThing: "Mozilla", fRating: 9 },
  { fThing: "Firefox OS", fRating: 9 },
  { fThing: "Curry", fRating: 9 },
  { fThing: "Paneer cheese", fRating: 8 },
  { fThing: "Mexican food", fRating: 8 },
  { fThing: "Chocolate", fRating: 7 },
  { fThing: "Heavy metal", fRating: 10 },
  { fThing: "Monty Python", fRating: 8 },
  { fThing: "Aphex Twin", fRating: 8 },
  { fThing: "Gaming", fRating: 7 },
  { fThing: "Frank Zappa", fRating: 9 },
  { fThing: "Open minds", fRating: 10 },
  { fThing: "Hugs", fRating: 9 },
  { fThing: "Ale", fRating: 9 },
  { fThing: "Christmas", fRating: 8 },
];

// In the following line, you should include the prefixes of implementations you want to test.
//window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

// DON'T use "var indexedDB = ..." if you're not in a function.
// Moreover, you may need references to some window.IDB* objects:
window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction;
window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;
// (Mozilla has never prefixed these objects, so we don't need window.mozIDB*)

var db;
window.onload = function () {
  // open db
  var DBOpenRequest = window.indexedDB.open("fThings", 1);
  DBOpenRequest.onsuccess = function (event) {
    db = DBOpenRequest.result;
    //populateData();

    var transaction = db.transaction(["fThings"], "readwrite");
    var objectStore = transaction.objectStore("fThings");
    for (let i = 0; i < things.length; i++) {
      var request = objectStore.put(things[i]);
    }

    transaction.oncomplete = function () {};
  };

  DBOpenRequest.onupgradeneeded = function (event) {
    var db = event.target.result;
    db.onerror = function (event) {
      console.error(event);
    };

    var objectStore = db.createObjectStore("fThings", { keyPath: "fThing" });
    objectStore.createIndex("fRating", "fRating", { unique: false });
  };
};

function displayData() {
  var filterIndex = "fRating";

  var keyRangeValue = null;
  //keyRangeValue = IDBKeyRange.only(onlyText.value);
  keyRangeValue = IDBKeyRange.bound("A", "D", false, false);

  var transaction = db.transaction(["fThings"], "readonly");
  var objectStore = transaction.objectStore("fThings");

  var countRequest = objectStore.count();
  countRequest.onsuccess = function () {
    console.log(countRequest.result);
  };

  //iterate over the fRating index instead of the object store:
  if (filterIndex === "fRating") {
    keyRangeValue = IDBKeyRange.bound(7, 9, false, false);
    keyRangeValue = IDBKeyRange.only(9);
    objectStore = objectStore.index("fRating");
  }

  objectStore.openCursor(keyRangeValue).onsuccess = function (event) {
    var cursor = event.target.result;
    if (cursor) {
      var listItem = document.createElement("li");
      console.log(`${cursor.value.fThing}, ${cursor.value.fRating}`);
      cursor.continue();
    } else {
      console.log("Entries all displayed.");
    }
  };
}

setHandler(`<button id='fs-open'>key range</button>`, async (evt) => {
  displayData();
});
