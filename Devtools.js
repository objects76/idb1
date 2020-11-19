"use strict";

export default function devInit(...args) {
  // replace assert
  console.assert = (c, ...msgs) => {
    if (!c) {
      const output = msgs.length ? msgs.join(", ") : "Assertion failed";
      window.alert(output);
      throw new Error(output);
    }
  };

  console.log("console.assert is replaced");
}
