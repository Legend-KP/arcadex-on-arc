import fs from "fs";

const s = fs.readFileSync(".open-next/middleware/handler.mjs", "utf8");
const i = s.indexOf("admin.arcx");
console.log("admin.arcx context:\n", s.slice(Math.max(0, i - 500), i + 700));
const markers = ["startsWith(\"admin.\")", "startsWith('admin.')", "trenchverse.com", "isAdminHost", "ADMIN_HOST"];
for (const m of markers) {
  const j = s.indexOf(m);
  console.log("\nmarker", m, "idx", j);
  if (j >= 0) console.log(s.slice(j - 150, j + 250));
}
