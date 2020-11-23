import BlobIDB from "./IDBBlob2.js";

// feature check
console.info(
  "canvas.captureStream:",
  "function" === typeof HTMLCanvasElement.prototype.captureStream ? "supported" : "NOT supported"
);

console.info(
  "video.captureStream:",
  "function" === typeof HTMLVideoElement.prototype.captureStream ? "supported" : "NOT supported"
);

const mainVideo = document.getElementById("mainVideo");

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnDownload = document.getElementById("btnResult");

//https://stackoverflow.com/questions/52720894/is-it-possible-to-use-the-mediarecorder-api-with-html5-video

let recordedPath;

const initMp4Recorder = async (stream) => {
  console.assert(navigator.mediaDevices.getUserMedia);
  //const stream = await navigator.mediaDevices.getUserMedia(constraints);

  const DEBUG = true;
  const log = DEBUG ? console.log.bind(console, "[rec]") : console.log;
  // const options = {mimeType: 'video/webm; codecs="opus,vp8"'};
  var options = {
    audioBitsPerSecond: 128000,
    videoBitsPerSecond: 2500000, // 2.5Mbps
    mimeType: "video/mp4",
  };
  const mr = stream ? new MediaRecorder(stream) : undefined;
  DEBUG && log("mr=", mr);
  DEBUG && log("stream=", stream);
  if (!mr) return undefined;

  DEBUG && mr.addEventListener("dataavailable", (ev) => log(ev.type));
  DEBUG && mr.addEventListener("pause", (ev) => log(ev.type));
  DEBUG && mr.addEventListener("resume", (ev) => log(ev.type));
  DEBUG && mr.addEventListener("start", (ev) => log(ev.type));
  DEBUG && mr.addEventListener("stop", (ev) => log(ev.type));
  DEBUG && mr.addEventListener("error", (ev) => log(ev.type));

  recordedPath = `/recorded/rec-${new Date().toLocaleString().replace(/[/:]/g, ".")}.mp4`;
  const idbfile = new BlobIDB.BlobWriter(recordedPath, idbdb);

  const stopRecording = async () => {
    DEBUG && log("stopRecording");
    for (const track of [...stream.getAudioTracks(), ...stream.getVideoTracks()]) track.stop();
    mr.stop();
    await idbfile.close();
  };

  mr.ondataavailable = (evt) => {
    if (DEBUG) log(`blob length=${evt.data.size}`);
    idbfile.write(evt.data, 0);
  };

  return { mediaRecorder: mr, stop: stopRecording };
};

mainVideo.onloadedmetadata = function () {
  console.log("onloadedmetadata");
};

btnStart.addEventListener("click", async () => {
  const stream = mainVideo.captureStream(10); // 10fps
  const { mediaRecorder, stop } = await initMp4Recorder(stream);
  mediaRecorder.start(1000); // 1sec timeslice
  btnStop.onclick = stop;
});

btnDownload.addEventListener("click", async (evt) => {
  const blob = await idbdb.getBlob(recordedPath);

  const link = document.createElement("a");
  link.download = recordedPath;
  link.href = window.URL.createObjectURL(blob);
  link.click();
  window.URL.revokeObjectURL(link.href);
});
// idb-blob setup
//------------------------------------------------------------------------------
// test
//------------------------------------------------------------------------------
let idbdb;
window.onload = () => {
  //IDBBlob.dropDb(FILE_DB_); // first clear old db.
  idbdb = new BlobIDB();
};
