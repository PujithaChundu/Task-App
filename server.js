require("dotenv").config();

const path = require("path");

const express = require("express");
const { createApiApp } = require("./server/app");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

app.use(express.static(path.join(__dirname, "public")));
app.use("/api", createApiApp());

app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Task management app listening on http://${HOST}:${PORT}`);
});
