import fs from "fs";
const p = new URL("./bootstrap.js", import.meta.url);
let s = fs.readFileSync(p, "utf8");
s = s.replace(/\u2019/g, "'");
fs.writeFileSync(p, s);
