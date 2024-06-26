import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();

// if blacklist.json is stored securely outside of the public directory
const blacklistFilePath = path.join(__dirname, "../config/blacklist.json");
let blacklistedIps = new Set();

const loadBlacklist = () => {
  try {
    const data = fs.readFileSync(blacklistFilePath, "utf-8");
    const blacklist = JSON.parse(data);
    blacklistedIps = new Set(blacklist);
  } catch (error) {
    console.error(`Error loading blacklist from file: ${error.message}`);
  }
};

// Call loadBlacklist on application startup and refresh every so often
loadBlacklist();
setInterval(loadBlacklist, 60000); // Refresh interval in milliseconds

// Middleware to check against the blacklist, prevent abuse
const blacklistMiddleware = (req, res, next) => {
  const ip =
    req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  if (blacklistedIps.has(ip)) {
    return res.status(403).send("Access denied.");
  }
  next();
};

app.use(blacklistMiddleware);

app.use(
  express.static("public", {
    setHeaders: function (res, path) {
      if (path.endsWith(".css")) {
        res.set("Content-Type", "text/css");
      }
    },
  }),
);

// Configure multer Storage
const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

const uploadDir = "./uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use("/uploads", express.static("uploads"));

// POST endpoint to handle multiple file uploads
app.post("/upload", upload.array("files"), (req, res) => {
  const tosAgreed = req.body.tosAgreed === "true";
  if (!tosAgreed) {
    return res
      .status(400)
      .send("You must agree to the terms of service before uploading.");
  }
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).send("No files uploaded.");
  }
  const ip =
    req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  const userAgent = req.headers["user-agent"];
  const uploadedFiles = files.map((file) => ({
    filename: file.filename,
    path: file.path,
    url: `${req.protocol}://${req.get("host")}/uploads/${file.filename}`,
  }));
  const logMessage = `Uploaded files: ${files
    .map((file) => file.originalname)
    .join(", ")}, IP: ${ip}, User Agent: ${userAgent}`;

  // Log files, IP, and User Agent to the console and send to the webhook
  console.log(logMessage);
  sendLogToDiscord(logMessage);
  res.status(200).json({
    message: "Upload successful!",
    files: uploadedFiles,
  });
});

// Send log information to Discord webhook
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
const port = process.env.PORT || 3000;
const sendLogToDiscord = async (message) => {
  const payload = JSON.stringify({ content: message });
  try {
    const response = await fetch(discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    if (!response.ok) {
      console.error(`Failed to send log to Discord: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`Error sending log to Discord: ${error}`);
  }
};

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`Express server listening at http://localhost:${port}`);
});
