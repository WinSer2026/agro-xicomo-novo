import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

// Ensure local data & backup directories exist
const DATA_DIR = path.join(process.cwd(), "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Local JSON storage for offline/dual sync mode
const DB_FILE = path.join(DATA_DIR, "db.json");
if (!fs.existsSync(DB_FILE)) {
  const initialDb = {
    products: [],
    sales: [],
    losses: [],
    transformations: [],
    employees: [],
    attendance: [],
    audit_logs: [],
    active_sessions: [],
    settings: [],
    credentials: [],
    payroll_payments: [],
    customers: [],
    paused_sales: [],
    deletions: []
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), "utf-8");
}

function readDb(): any {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return {
      products: [], sales: [], losses: [], transformations: [], employees: [],
      attendance: [], audit_logs: [], active_sessions: [], settings: [],
      credentials: [], payroll_payments: [], customers: [], paused_sales: [], deletions: []
    };
  }
}

function writeDb(data: any) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[Server DB] Write error:", err);
  }
}

// In-memory rate limiting map for brute-force & DDoS protection (Parte 6)
const rateLimitMap = new Map<string, { count: number; firstReq: number }>();
function rateLimiter(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, firstReq: now };

    if (now - entry.firstReq > windowMs) {
      entry.count = 1;
      entry.firstReq = now;
    } else {
      entry.count++;
    }

    rateLimitMap.set(ip, entry);

    if (entry.count > limit) {
      return res.status(429).json({
        error: "Muitos pedidos enviados. Por favor tente novamente mais tarde.",
        retryAfterMs: windowMs - (now - entry.firstReq)
      });
    }
    next();
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Security Headers Middleware (Parte 6 - 6.3.5)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    // Content-Security-Policy accommodating Firebase, Google Fonts, and Vite hot reload
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://*.googleapis.com https://*.firebaseio.com https://*.firebase.com https://*.google.com https://*.gstatic.com https://unpkg.com https://cdn.jsdelivr.net; connect-src 'self' ws: wss: https://*.googleapis.com https://*.firebaseio.com https://*.firebase.com https://*.google.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com;"
    );
    next();
  });

  // Body parser setup
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API Health Check & System Status (Parte 9)
  app.get("/api/health", (req: Request, res: Response) => {
    const backupFiles = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".json"));
    res.json({
      status: "ok",
      system: "AGRO - XICOMO & SERVIÇOS, LDA - ERP",
      version: "2.0.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      backupsAvailable: backupFiles.length,
      memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
  });

  // --- Persistent Backup Endpoints (Parte 9) ---
  app.post("/api/backup", rateLimiter(10, 60000), (req: Request, res: Response) => {
    try {
      const backupData = req.body;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `backup-agro-xicomo-${timestamp}.json`;
      const filePath = path.join(BACKUP_DIR, filename);

      fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), "utf-8");

      // Rotate backups: keep 15 most recent
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith(".json"))
        .sort((a, b) => b.localeCompare(a));

      while (files.length > 15) {
        const oldest = files.pop();
        if (oldest) fs.unlinkSync(path.join(BACKUP_DIR, oldest));
      }

      res.json({
        success: true,
        message: "Backup criado e persistido com sucesso no servidor.",
        filename,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error("[Backup Error]:", err);
      res.status(500).json({ success: false, error: "Falha ao gravar backup no servidor." });
    }
  });

  app.get("/api/backup", (req: Request, res: Response) => {
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith(".json"))
        .map(f => {
          const stats = fs.statSync(path.join(BACKUP_DIR, f));
          return {
            filename: f,
            sizeBytes: stats.size,
            createdAt: stats.mtime.toISOString()
          };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      res.json({ backups: files });
    } catch (err) {
      res.status(500).json({ error: "Erro ao listar backups do servidor." });
    }
  });

  app.get("/api/backup/download/:filename", (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(BACKUP_DIR, filename);
    if (fs.existsSync(filePath)) {
      res.download(filePath, filename);
    } else {
      res.status(404).json({ error: "Arquivo de backup não encontrado." });
    }
  });

  // --- Dual Sync & Offline Fallback Endpoints ---
  app.get("/api/sync", (req: Request, res: Response) => {
    const db = readDb();
    res.json(db);
  });

  app.post("/api/sync/save", (req: Request, res: Response) => {
    const { storeName, item } = req.body;
    if (!storeName || !item || !item.id) {
      return res.status(400).json({ error: "Parâmetros inválidos para sincronização." });
    }
    const db = readDb();
    if (!Array.isArray(db[storeName])) db[storeName] = [];
    const idx = db[storeName].findIndex((x: any) => x.id === item.id);
    if (idx >= 0) {
      db[storeName][idx] = item;
    } else {
      db[storeName].push(item);
    }
    writeDb(db);
    res.json({ success: true });
  });

  app.post("/api/sync/save-batch", (req: Request, res: Response) => {
    const { storeName, items } = req.body;
    if (!storeName || !Array.isArray(items)) {
      return res.status(400).json({ error: "Parâmetros inválidos para sincronização em lote." });
    }
    const db = readDb();
    if (!Array.isArray(db[storeName])) db[storeName] = [];
    for (const item of items) {
      if (!item || !item.id) continue;
      const idx = db[storeName].findIndex((x: any) => x.id === item.id);
      if (idx >= 0) {
        db[storeName][idx] = item;
      } else {
        db[storeName].push(item);
      }
    }
    writeDb(db);
    res.json({ success: true, count: items.length });
  });

  app.post("/api/sync/delete", (req: Request, res: Response) => {
    const { storeName, id } = req.body;
    if (!storeName || !id) {
      return res.status(400).json({ error: "Parâmetros inválidos para eliminação." });
    }
    const db = readDb();
    if (Array.isArray(db[storeName])) {
      db[storeName] = db[storeName].filter((x: any) => x.id !== id);
    }
    if (!Array.isArray(db.deletions)) db.deletions = [];
    db.deletions.push({ storeName, targetId: id, timestamp: new Date().toISOString() });
    writeDb(db);
    res.json({ success: true });
  });

  // Vite middleware for development vs static build
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        host: "0.0.0.0",
        allowedHosts: true
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Agro-Xicomo ERP Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
