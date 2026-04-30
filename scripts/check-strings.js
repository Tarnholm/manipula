const fs = require("fs");
const buf = fs.readFileSync("C:\\RIS\\RIS\\data\\text\\export_units.txt");
const text = (buf[0] === 0xff && buf[1] === 0xfe) ? buf.slice(2).toString("utf16le") : buf.toString("utf8");
const m = text.match(/\{roman_rorarii\}([^\n\r]*)/);
console.log("Display:", m ? m[1].slice(0, 200) : "(not found)");
const m2 = text.match(/\{roman_rorarii_descr_short\}([^\n\r]*)/);
console.log("Short:", m2 ? m2[1].slice(0, 200) : "(not found)");
// Total keys
const keys = (text.match(/^\{[^}]+\}/gm) || []).length;
console.log("Total keys:", keys);
