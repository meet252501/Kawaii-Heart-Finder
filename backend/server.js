require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
app.use(cors());
app.use(express.json());

// Security Middleware
// app.use(helmet()); <-- DISABLED TO FIX "ENTER BUTTON" BUG
app.use(cors());
app.use(express.json());
// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
});
app.use(limiter);

// --- SELF DESTRUCT SYSTEM ---
app.use((req, res, next) => {
  if (new Date() > EXPIRATION_DATE) {
    const DB_FILE = "./database.json";
    if (fs.existsSync(DB_FILE)) {
      try {
        fs.writeFileSync(
          DB_FILE,
          JSON.stringify({ users: [], status: "DELETED" }),
        );
      } catch (e) {
        console.error("Wipe failed:", e);
      }
    }
    return res
      .status(410)
      .send(
        "💔 This Valentine's service has self-destructed. Happy Valentine's Day!",
      );
  }
  next();
});

app.use("/uploads", express.static("uploads"));// --- INTELLIGENT ROUTING SYSTEM 🧠 ---
app.get("/", (req, res) => {
  const userAgent = req.headers["user-agent"] || "";
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

  if (isMobile) {
    console.log(`📱 Mobile User Detected! Serving Lite Version.`);
    res.sendFile(path.join(__dirname, "../mobile.html"));
  } else {
    console.log(`💻 Desktop User Detected. Serving Full Experience.`);
    res.sendFile(path.join(__dirname, "../index.html"));
  }
});

// --- STATIC FILES ---
// Serve frontend files (css, assets, etc.)
app.use(express.static(path.join(__dirname, "../")));

// --- STORAGE CONFIGURATION ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only images allowed!"), false);
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // Increased to 10MB
});

// Database Configuration
const DB_FILE = "./database.json";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "lovinglyhost";
const EXPIRATION_DATE = new Date(
  process.env.EXPIRATION_DATE || "2026-02-15T00:00:00",
);

// --- AI & SAFETY ---
const checkImageSafety = async (filePath) => {
  // Placeholder for Vision API Integration
  // In a production environment, this would call Gemini 1.5/2.0 Vision
  return true;
};

// --- CORE UTILS ---
const readDB = () => {
  if (!fs.existsSync(DB_FILE)) return { users: [], messages: [] };
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE));
    if (!data.users) data.users = [];
    if (!data.messages) data.messages = [];
    return data;
  } catch (e) {
    return { users: [], messages: [] };
  }
};

const writeDB = (data) => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Write failed:", e);
  }
};

const sanitizeInput = (str) => {
  if (typeof str !== "string") return str;
  return str.replace(/<[^>]*>/g, "").trim();
};
const calculateMatchScore = (u1, u2) => {
  // 0. Gender Preference Filter (Hard Block)
  const u1Pref = u1.interestedIn || "Everyone";
  const u2Pref = u2.interestedIn || "Everyone";
  const u1Gen = u1.gender || "Secret";
  const u2Gen = u2.gender || "Secret";

  // Check U1's preference
  if (u1Pref !== "Everyone" && u1Pref !== u2Gen) return 0;
  // Check U2's preference (Mutual Interest)
  if (u2Pref !== "Everyone" && u2Pref !== u1Gen) return 0;

  let score = 50; // Starting baseline

  // 1. Shared Interests (+15 each)
  if (u1.interests && u2.interests) {
    const common = u1.interests.filter((tag) => u2.interests.includes(tag));
    score += common.length * 15;
  }

  // 2. Age Proximity (+10 if within 3 years)
  const ageDiff = Math.abs(u1.age - u2.age);
  if (ageDiff <= 3) score += 10;

  // 3. Goal Alignment (+20 if same goal)
  if (u1.lookingFor === u2.lookingFor) score += 20;

  return Math.min(score, 99); // Cap at 99% for realism
};

// --- PRO ROUTES ---

// 1. User Login (Email Only)
app.post("/api/login", (req, res) => {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ success: false, error: "Email is required" });

  const db = readDB();
  const user = db.users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase(),
  );

  if (user) {
    res.json({ success: true, user });
  } else {
    res.status(404).json({ success: false, error: "User not found" });
  }
});

// 2. User Registration
app.post(
  "/api/register",
  upload.fields([{ name: "photo" }, { name: "socialQr" }]),
  async (req, res) => {
    try {
      const db = readDB();
      const safeAge = parseInt(req.body.age);
      const safeEmail = sanitizeInput(req.body.email).toLowerCase();
      const safeName = sanitizeInput(req.body.name);

      // Check if user already exists
      const existing = db.users.find((u) => u.email === safeEmail);
      if (existing) {
        return res.json({ success: true, user: existing, isReturning: true });
      }

      if (!safeName || !safeAge || safeAge < 18) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid data or under 18." });
      }

      const photoPath = req.files["photo"] ? req.files["photo"][0].path : null;
      const socialPath = req.files["socialQr"]
        ? req.files["socialQr"][0].path
        : null;

      if (!socialPath) {
        if (photoPath && fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
        return res.status(400).json({
          success: false,
          error: "Social QR is mandatory! Please upload yours. 📲",
        });
      }

      if (photoPath && !(await checkImageSafety(photoPath))) {
        if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
        if (socialPath && fs.existsSync(socialPath)) fs.unlinkSync(socialPath);
        return res.status(400).json({
          success: false,
          error: "AI blocked your photo! Please use a cleaner one. 🛡️",
        });
      }

      if (socialPath && !(await checkImageSafety(socialPath))) {
        if (photoPath && fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
        if (socialPath && fs.existsSync(socialPath)) fs.unlinkSync(socialPath);
        return res.status(400).json({
          success: false,
          error: "AI blocked your Social QR! Please use a valid QR code. 🛡️",
        });
      }

      const newUser = {
        id: Date.now(),
        name: safeName,
        email: safeEmail,
        age: safeAge,
        bio: sanitizeInput(req.body.bio) || "A mysterious cutie...",
        gender: sanitizeInput(req.body.gender) || "Secret",
        interestedIn: sanitizeInput(req.body.interestedIn) || "Everyone",
        lookingFor: sanitizeInput(req.body.lookingFor) || "Connection",
        interests: req.body.interests ? JSON.parse(req.body.interests) : [],
        img: req.files["photo"]
          ? `/uploads/${req.files["photo"][0].filename}`
          : null,
        socialQr: req.files["socialQr"]
          ? `/uploads/${req.files["socialQr"][0].filename}`
          : null,
        registeredAt: new Date().toISOString(),
      };

      db.users.push(newUser);
      writeDB(db);
      res.json({ success: true, user: newUser, isReturning: false });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
);

// 2. Pro Matching Algorithm (v2: Weighted)
app.get("/api/matches", (req, res) => {
  const db = readDB();
  const userId = req.query.userId;
  const user = db.users.find((u) => u.id == userId);

  if (!user) {
    return res.json({
      source: "none",
      matches: [],
    });
  }

  let scoredMatches = db.users
    .filter((m) => m.id !== user.id)
    .map((m) => {
      return {
        ...m,
        matchScore: calculateMatchScore(user, m),
      };
    });

  scoredMatches.sort((a, b) => b.matchScore - a.matchScore);
  res.json({ source: "real", matches: scoredMatches });
});

// 3. Chat Persistence API
app.get("/api/messages", (req, res) => {
  const db = readDB();
  const { from, to } = req.query;
  const chat = db.messages.filter(
    (m) => (m.from == from && m.to == to) || (m.from == to && m.to == from),
  );
  res.json(chat);
});

app.post("/api/messages", (req, res) => {
  const { from, to, text } = req.body;
  if (!from || !to || !text) return res.status(400).send("Missing fields");

  const db = readDB();
  const newMessage = {
    from,
    to,
    text: sanitizeInput(text),
    timestamp: new Date().toISOString(),
  };
  db.messages.push(newMessage);
  writeDB(db);
  res.json({ success: true, message: newMessage });
});

// 4. Admin Dashboard Endpoints
app.get("/api/admin/users", (req, res) => {
  if (req.query.key !== ADMIN_SECRET)
    return res.status(403).send("Unauthorized");
  const db = readDB();
  res.json(db.users);
});

app.delete("/api/admin/delete", (req, res) => {
  if (req.headers["x-admin-key"] !== ADMIN_SECRET)
    return res.status(403).send("Unauthorized");
  const db = readDB();
  const userId = req.query.id;
  db.users = db.users.filter((u) => u.id != userId);
  writeDB(db);
  res.json({ success: true });
});

app.get("/api/admin/stats", (req, res) => {
  if (req.query.key !== ADMIN_SECRET)
    return res.status(403).send("Unauthorized");
  const db = readDB();
  res.json({
    totalUsers: db.users.length,
    totalMessages: db.messages.length,
    activeMatches: Math.floor(db.users.length / 2),
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Kawaii PRO Server running at http://localhost:${PORT}`);
  console.log(`📂 Database: ${DB_FILE}`);
  console.log(`👑 Admin Key: ${ADMIN_SECRET}`);
});
