export default function DnDFileController(selector, onDropCallback) {
  const el_ = document.querySelector(selector);
  console.assert(el_, "no " + selector);

  this.dragenter = (e) => {
    e.stopPropagation();
    e.preventDefault();
    // el_.classList.add("dropping");
    el_.style.opacity = "0.8";
  };

  this.dragover = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };

  this.dragleave = (e) => {
    e.stopPropagation();
    e.preventDefault();
    // el_.classList.remove("dropping");
    el_.style.opacity = "0";
  };

  this.drop = (e) => {
    this.dragleave(e);
    onDropCallback(e.dataTransfer.files);
  };

  el_.addEventListener("dragenter", this.dragenter, false);
  el_.addEventListener("dragover", this.dragover, false);
  el_.addEventListener("dragleave", this.dragleave, false);
  el_.addEventListener("drop", this.drop, false);
}
