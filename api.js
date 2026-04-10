const express = require("express");
const serverless = require("serverless-http");

const { createApiApp } = require("../../server/app");

const app = express();
app.use("/.netlify/functions/api", createApiApp());

module.exports.handler = serverless(app, {
  binary: ["application/pdf"],
});
