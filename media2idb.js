import IDBBlob, { IDBFile } from "./IDBBlob.js";

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
const btnResult = document.getElementById("btnResult");

//https://stackoverflow.com/questions/52720894/is-it-possible-to-use-the-mediarecorder-api-with-html5-video

let recordedPath;

const initMp4Recorder = async (stream) => {
  const DEBUG = true;
  const log = DEBUG ? console.log.bind(console, "[rec]") : console.log;

  // const options = {mimeType: 'video/webm; codecs="opus,vp8"'};
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
  const idbfile = await idbdb.open(recordedPath, true);

  const stopRecording = async () => {
    DEBUG && log("stopRecording");
    for (const track of [...stream.getAudioTracks(), ...stream.getVideoTracks()]) track.stop();
    mr.stop();
    await idbfile.close();
    const fullPath = idbfile._file.fullPath;
    // idbfile = undefined;
    {
      await idbdb.open(fullPath, false);
    }
  };

  mr.ondataavailable = (evt) => {
    if (DEBUG) log(`blob length=${evt.data.size}`);
    // write to ws-server:
    // if (websocket) websocket.send(evt.data);
    // else writer.write(evt.data);
    idbfile.write(evt.data);
  };

  // window unload handler
  window.addEventListener("beforeunload", (ev) => {
    log(ev.type);
    // writer.cancel();
    // ev.preventDefault();
    // ev.returnValue = "recording...";
  });
  return { mediaRecorder: mr, stop: stopRecording };
};

mainVideo.onloadedmetadata = function () {
  console.log("onloadedmetadata");
};

btnStart.addEventListener("click", async () => {
  const stream = mainVideo.captureStream(25);
  const { mediaRecorder, stop } = await initMp4Recorder(stream);
  mediaRecorder.start(1000); // 1sec timeslice
  btnStop.onclick = stop;
});

btnResult.addEventListener("click", (evt) => {
  idbdb.downloadStream(recordedPath);
});
// idb-blob setup
//------------------------------------------------------------------------------
// test
//------------------------------------------------------------------------------
let idbdb;
window.onload = () => {
  //IDBBlob.dropDb(FILE_DB_); // first clear old db.
  idbdb = new IDBBlob();
};
