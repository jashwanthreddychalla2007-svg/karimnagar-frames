"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_DATA_FILE = path.join(ROOT, "data", "db.json");
const CATALOG_FILE = path.join(ROOT, "data", "catalog.json");
const DATA_FILE = process.env.DATA_FILE || process.env.DB_FILE || path.join(ROOT, "data", "db.json");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "uploads");
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PAYMENT_METHODS = ["Pay on Delivery", "UPI after Preview", "Pay at Store"];
const PAYMENT_STATUSES = ["Pending", "Awaiting Confirmation", "Paid", "Failed", "Refunded", "Cancelled"];
const ORDER_STATUSES = ["Pending", "Accepted", "Printing", "Shipped", "Delivered", "Cancelled"];
const PRODUCT_CATALOG_VERSION = "2026-05-25-owner-product-management";
const PRODUCT_CATEGORIES = ["frames", "cups", "pillows", "combos"];
const PRODUCT_STATUSES = ["Available", "Out of stock", "Hidden", "Disabled"];
const OTP_TTL_MS = 1000 * 60 * 10;
const OTP_MAX_ATTEMPTS = 5;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return prefix + "_" + crypto.randomBytes(9).toString("hex");
}

function orderId(db) {
  const next = 1001 + (db.orders || []).length;
  return (db.settings.orderPrefix || "KF") + "-" + next;
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; "),
    ...extra
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function error(res, status, message, details) {
  json(res, status, {
    ok: false,
    error: {
      message,
      details: details || null
    }
  });
}

async function ensureDataFile() {
  try {
    await fsp.access(DATA_FILE);
  } catch (error) {
    await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
    const seed = await fsp.readFile(DEFAULT_DATA_FILE, "utf8");
    await fsp.writeFile(DATA_FILE, seed);
  }
}

async function readDb() {
  await ensureDataFile();
  const text = await fsp.readFile(DATA_FILE, "utf8");
  const db = JSON.parse(text);
  return applyCatalog(db);
}

async function applyCatalog(db) {
  try {
    const text = await fsp.readFile(CATALOG_FILE, "utf8");
    const catalog = JSON.parse(text);
    db.meta = db.meta || {};
    if (catalog.settings && typeof catalog.settings === "object") {
      db.settings = { ...catalog.settings, ...(db.settings || {}) };
    }
    if (Array.isArray(catalog.products) && catalog.products.length) {
      const catalogHash = crypto.createHash("sha256").update(JSON.stringify(catalog.products)).digest("hex");
      const ownerManagedProducts = Boolean(db.meta.productsManagedAt);
      if (!Array.isArray(db.products) || !db.products.length || (!ownerManagedProducts && db.meta.productCatalogVersion !== PRODUCT_CATALOG_VERSION)) {
        db.products = catalog.products.map((product) => normalizeProductRecord(product));
        db.meta.productCatalogVersion = PRODUCT_CATALOG_VERSION;
        db.meta.productCatalogHash = catalogHash;
      } else {
        db.products = (db.products || []).map((product) => normalizeProductRecord(product));
      }
    }
  } catch (error) {
    return db;
  }
  return db;
}

async function writeDb(db) {
  db.meta = db.meta || {};
  db.meta.updatedAt = now();
  const tmp = DATA_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
  await fsp.rename(tmp, DATA_FILE);
}

function publicUser(user) {
  if (!user) {
    return null;
  }
  const { passwordHash, ...safe } = user;
  return safe;
}

function createSession(db, user) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions = db.sessions || [];
  db.sessions.push({
    token,
    userId: user.id,
    createdAt: now(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  });
  return token;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) {
    return cookies;
  }
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) {
      return;
    }
    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());
    cookies[key] = value;
  });
  return cookies;
}

function setSessionCookie(res, token) {
  const cookie = [
    "kf_session=" + encodeURIComponent(token),
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=" + Math.floor(SESSION_TTL_MS / 1000)
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "kf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) {
    return false;
  }
  const test = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
  const known = Buffer.from(hash, "hex");
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

function cleanSessions(db) {
  const time = Date.now();
  db.sessions = (db.sessions || []).filter((session) => new Date(session.expiresAt).getTime() > time);
  db.otpChallenges = (db.otpChallenges || []).filter((challenge) => new Date(challenge.expiresAt).getTime() > time);
}

function currentUser(req, db) {
  cleanSessions(db);
  const token = parseCookies(req.headers.cookie).kf_session;
  if (!token) {
    return null;
  }
  const session = (db.sessions || []).find((item) => item.token === token);
  if (!session) {
    return null;
  }
  return db.users.find((user) => user.id === session.userId) || null;
}

function requireUser(req, res, db) {
  const user = currentUser(req, db);
  if (!user) {
    error(res, 401, "Please log in to continue.");
    return null;
  }
  return user;
}

function requireAdmin(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) {
    return null;
  }
  if (user.role !== "admin") {
    error(res, 403, "Admin access is required.");
    return null;
  }
  return user;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (bodyError) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || "").trim());
  if (missing.length) {
    return "Missing required fields: " + missing.join(", ");
  }
  return null;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPhone(phone) {
  return /^[0-9+\s-]{8,15}$/.test(String(phone || ""));
}

function phoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
}

function smsPhone(phone) {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    return "+" + digits;
  }
  if (digits.length === 10) {
    return "+91" + digits;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return "+" + digits;
  }
  return "+" + digits;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function safeText(value, max = 160) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
}

function productSlug(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom-product";
}

function uniqueProductId(db, value, existingId = "") {
  const base = productSlug(value);
  let candidate = base;
  let suffix = 2;
  while ((db.products || []).some((product) => product.id === candidate && product.id !== existingId)) {
    candidate = base + "-" + suffix;
    suffix += 1;
  }
  return candidate;
}

function splitList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  return Array.from(new Set(source.map((item) => safeText(item, 120)).filter(Boolean)));
}

function normalizeChoice(choice) {
  if (typeof choice === "string") {
    return { label: safeText(choice, 80), price: 0 };
  }
  return {
    label: safeText(choice && choice.label, 80),
    price: Math.max(0, Number(choice && choice.price) || 0)
  };
}

function parseOptionsText(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf(":");
      if (index === -1) {
        return null;
      }
      const name = safeText(line.slice(0, index), 80);
      const choices = line.slice(index + 1).split(",").map((part) => {
        const [label, price] = part.split("=");
        return {
          label: safeText(label, 80),
          price: Math.max(0, Number(price) || 0)
        };
      }).filter((choice) => choice.label);
      return name && choices.length ? { name, choices } : null;
    })
    .filter(Boolean);
}

function normalizeOptionGroups(value) {
  const source = typeof value === "string" ? parseOptionsText(value) : value;
  if (!Array.isArray(source)) {
    return [];
  }
  return source.map((group) => {
    const choices = (group && Array.isArray(group.choices) ? group.choices : [])
      .map(normalizeChoice)
      .filter((choice) => choice.label);
    return {
      name: safeText(group && group.name, 80),
      choices
    };
  }).filter((group) => group.name && group.choices.length);
}

function hasOptionGroup(options, pattern) {
  return options.some((group) => pattern.test(group.name));
}

function optionsWithSizeAndColor(options, sizes, colors) {
  const next = [...options];
  if (sizes.length && !hasOptionGroup(next, /size/i)) {
    next.unshift({
      name: "Size",
      choices: sizes.map((label) => ({ label, price: 0 }))
    });
  }
  if (colors.length && !hasOptionGroup(next, /colo(u)?r/i)) {
    next.unshift({
      name: "Color",
      choices: colors.map((label) => ({ label, price: 0 }))
    });
  }
  return next;
}

function normalizePhotoRequirements(input, fallback = {}) {
  const source = input && typeof input === "object" ? input : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const min = Math.max(1, Number(source.min ?? source.required ?? base.min ?? base.required ?? 1) || 1);
  const max = Math.max(min, Number(source.max ?? base.max ?? min) || min);
  let labels = splitList(source.labels && source.labels.length ? source.labels : base.labels);
  while (labels.length < max) {
    labels.push("Photo " + (labels.length + 1));
  }
  return {
    min,
    max,
    labels: labels.slice(0, max),
    rules: Array.isArray(source.rules) ? source.rules : (Array.isArray(base.rules) ? base.rules : [])
  };
}

function parseCustomFieldsText(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
      return {
        label: safeText(parts[0], 80),
        required: parts.slice(1).some((part) => /^required$/i.test(part)),
        type: "text"
      };
    })
    .filter((field) => field.label);
}

function normalizeCustomFields(value) {
  const source = typeof value === "string" ? parseCustomFieldsText(value) : value;
  if (!Array.isArray(source)) {
    return [];
  }
  return source.map((field) => ({
    id: productSlug(field.id || field.label),
    label: safeText(field.label, 80),
    required: Boolean(field.required),
    type: ["text", "textarea"].includes(field.type) ? field.type : "text"
  })).filter((field) => field.label).slice(0, 12);
}

function normalizeProductImages(value) {
  const images = Array.isArray(value) ? value : [value];
  const unique = Array.from(new Set(images.map((image) => safeText(image, 320)).filter(Boolean)));
  return unique.length ? unique : ["/assets/products/placeholders/product-placeholder.svg"];
}

function normalizeProductRecord(product = {}, fallback = {}) {
  const merged = { ...fallback, ...product };
  const name = safeText(merged.name || "Custom Product", 120);
  const category = PRODUCT_CATEGORIES.includes(String(merged.category || "").toLowerCase())
    ? String(merged.category).toLowerCase()
    : "frames";
  const rawStatus = safeText(merged.stockStatus || merged.status || "", 40);
  let stockStatus = PRODUCT_STATUSES.includes(rawStatus) ? rawStatus : "";
  if (!stockStatus) {
    stockStatus = merged.available === false ? "Disabled" : "Available";
  }
  const available = !["Out of stock", "Hidden", "Disabled"].includes(stockStatus) && merged.available !== false;
  const sizes = splitList(merged.sizes);
  const colors = splitList(merged.colors);
  const options = optionsWithSizeAndColor(normalizeOptionGroups(merged.options), sizes, colors);
  return {
    id: safeText(merged.id || productSlug(name), 90),
    name,
    category,
    summary: safeText(merged.summary || merged.description || "Custom photo gift product.", 220),
    description: safeText(merged.description || merged.summary || "Custom photo gift product.", 1200),
    basePrice: Math.max(0, Number(merged.basePrice ?? merged.price) || 0),
    rating: Number(merged.rating) || 4.7,
    featured: Boolean(merged.featured),
    badge: safeText(merged.badge || (available ? "Custom gift" : "Unavailable"), 60),
    turnaround: safeText(merged.turnaround || "Preview before print", 80),
    images: normalizeProductImages(merged.images || merged.image || merged.imageUrl),
    sizes,
    colors,
    options,
    customFields: normalizeCustomFields(merged.customFields),
    photoRequirements: normalizePhotoRequirements(merged.photoRequirements, fallback.photoRequirements),
    available,
    stockStatus,
    status: available ? "active" : "disabled",
    tags: splitList(merged.tags),
    features: splitList(merged.features),
    createdAt: merged.createdAt || now(),
    updatedAt: merged.updatedAt || now()
  };
}

function isProductAvailable(product) {
  return product && product.available !== false && product.status !== "disabled" && !["Out of stock", "Hidden", "Disabled"].includes(product.stockStatus);
}

async function saveProductImage(input, name = "product-image") {
  if (!input) {
    return "";
  }
  const match = String(input).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) {
    throw new Error("Product image must be PNG, JPG, JPEG, or WEBP.");
  }
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) {
    throw new Error("Product image must be smaller than 4 MB.");
  }
  const dir = path.join(UPLOAD_DIR, "products");
  await fsp.mkdir(dir, { recursive: true });
  const filename = productSlug(name) + "-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "." + ext;
  await fsp.writeFile(path.join(dir, filename), bytes);
  return "/uploads/products/" + filename;
}

async function productFromAdminInput(db, input, existing = null) {
  const body = input && typeof input === "object" ? input : {};
  const name = safeText(body.name || (existing && existing.name), 120);
  if (!name) {
    throw new Error("Product name is required.");
  }
  if (body.basePrice === "" || body.basePrice === null || body.basePrice === undefined) {
    throw new Error("Product price is required.");
  }
  const basePrice = Number(body.basePrice);
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    throw new Error("Product price must be greater than zero.");
  }
  let images = Array.isArray(body.images) ? body.images : (existing && existing.images ? existing.images : []);
  const imageUrl = safeText(body.imageUrl || body.image, 320);
  if (imageUrl) {
    images = [imageUrl, ...images.filter((image) => image !== imageUrl)];
  }
  if (body.imageDataUrl) {
    const uploaded = await saveProductImage(body.imageDataUrl, body.imageName || name);
    images = [uploaded, ...images.filter((image) => image !== uploaded)];
  }
  const photoRequirements = normalizePhotoRequirements({
    min: body.photoMin ?? body.requiredPhotoCount,
    max: body.photoMax ?? body.maxPhotoCount,
    labels: body.photoLabels,
    rules: body.photoRules
  }, existing && existing.photoRequirements);
  const product = normalizeProductRecord({
    ...existing,
    ...body,
    id: existing ? existing.id : uniqueProductId(db, body.id || name),
    basePrice,
    images,
    options: body.optionsText ? parseOptionsText(body.optionsText) : body.options,
    customFields: body.customFieldsText ? parseCustomFieldsText(body.customFieldsText) : body.customFields,
    photoRequirements,
    updatedAt: now(),
    createdAt: existing && existing.createdAt
  }, existing || {});
  product.id = existing ? existing.id : uniqueProductId(db, product.id || name);
  return product;
}

async function sendOtpSms(phone, otp) {
  const provider = String(process.env.SMS_PROVIDER || "textbelt").toLowerCase();
  const message = "Your Karimnagar Frames OTP is " + otp + ". It expires in 10 minutes.";
  if (provider === "demo") {
    return { sent: false, provider: "demo", reason: "Demo OTP mode" };
  }
  if (provider === "textbelt") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch("https://textbelt.com/text", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          phone: smsPhone(phone),
          message,
          key: process.env.TEXTBELT_KEY || "textbelt"
        }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      return {
        sent: Boolean(result.success),
        provider: "textbelt",
        reason: result.error || result.quotaRemaining === 0 ? "Free SMS quota may be finished." : ""
      };
    } catch (smsError) {
      return { sent: false, provider: "textbelt", reason: "SMS service unavailable." };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { sent: false, provider, reason: "Unknown SMS provider." };
}

function productPrice(product, selectedOptions = {}) {
  let total = Number(product.basePrice) || 0;
  (product.options || []).forEach((group) => {
    const selected = selectedOptions[group.name];
    const choice = (group.choices || []).find((item) => item.label === selected);
    if (choice) {
      total += Number(choice.price) || 0;
    }
  });
  return total;
}

function defaultUploadLabels(max) {
  return Array.from({ length: Math.max(1, Number(max) || 1) }, (_, index) => "Photo " + (index + 1));
}

function productPhotoRequirement(product, selectedOptions = {}) {
  const config = product.photoRequirements && typeof product.photoRequirements === "object" ? product.photoRequirements : {};
  let requirement = {
    min: Number(config.min) || 1,
    max: Number(config.max) || Math.max(1, Number(config.min) || 1),
    labels: Array.isArray(config.labels) && config.labels.length ? config.labels : defaultUploadLabels(config.max || config.min || 1)
  };
  (config.rules || []).forEach((rule) => {
    const when = rule.when || {};
    if (when.option && selectedOptions[when.option] === when.value) {
      requirement = {
        min: Number(rule.min) || requirement.min,
        max: Number(rule.max) || requirement.max,
        labels: Array.isArray(rule.labels) && rule.labels.length ? rule.labels : requirement.labels
      };
    }
  });
  if (requirement.max < requirement.min) {
    requirement.max = requirement.min;
  }
  if (requirement.labels.length < requirement.max) {
    requirement.labels = requirement.labels.concat(defaultUploadLabels(requirement.max).slice(requirement.labels.length));
  }
  return requirement;
}

function cartKey(item) {
  return item.productId + "::" + JSON.stringify(item.options || {}) + "::" + JSON.stringify(item.customFields || {});
}

function normalizeItemCustomFields(product, input) {
  const values = input && typeof input === "object" ? input : {};
  const customFields = {};
  (product.customFields || []).forEach((field) => {
    const value = safeText(values[field.label] ?? values[field.id], field.type === "textarea" ? 500 : 160);
    if (field.required && !value) {
      throw new Error(product.name + " requires " + field.label + ".");
    }
    if (value) {
      customFields[field.label] = value;
    }
  });
  return customFields;
}

function normalizeCartItems(db, items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => {
    const product = db.products.find((entry) => entry.id === item.productId);
    if (!product) {
      throw new Error("Invalid product in cart.");
    }
    if (!isProductAvailable(product)) {
      throw new Error(product.name + " is not available right now.");
    }
    const quantity = Math.min(50, Math.max(1, Number(item.quantity) || 1));
    const selectedOptions = item.options && typeof item.options === "object" ? item.options : {};
    const customFields = normalizeItemCustomFields(product, item.customFields);
    const unitPrice = productPrice(product, selectedOptions);
    const normalized = {
      productId: product.id,
      name: product.name,
      image: product.images && product.images[0] ? product.images[0] : "",
      quantity,
      unitPrice,
      options: selectedOptions,
      customFields
    };
    normalized.cartKey = cartKey(normalized);
    return normalized;
  });
}

function userCart(db, userId) {
  db.carts = db.carts || [];
  let cart = db.carts.find((entry) => entry.userId === userId);
  if (!cart) {
    cart = { userId, items: [], updatedAt: now() };
    db.carts.push(cart);
  }
  return cart;
}

function paymentFromInput(input, total) {
  const payment = input && typeof input === "object" ? input : {};
  const method = PAYMENT_METHODS.includes(payment.method) ? payment.method : PAYMENT_METHODS[0];
  const status = method === "Pay on Delivery" ? "Pending" : "Awaiting Confirmation";
  return {
    method,
    status,
    reference: String(payment.reference || "").trim().slice(0, 120),
    amount: total,
    updatedAt: now()
  };
}

function paymentForOrder(order) {
  const payment = order.payment && typeof order.payment === "object" ? order.payment : {};
  const method = PAYMENT_METHODS.includes(payment.method) ? payment.method : PAYMENT_METHODS[0];
  const status = PAYMENT_STATUSES.includes(payment.status) ? payment.status : (method === "Pay on Delivery" ? "Pending" : "Awaiting Confirmation");
  return {
    method,
    status,
    reference: String(payment.reference || "").trim().slice(0, 120),
    amount: Number(payment.amount) || Number(order.total) || 0,
    updatedAt: payment.updatedAt || order.updatedAt || order.createdAt || now()
  };
}

async function saveUpload(upload) {
  if (!upload || !upload.dataUrl) {
    return null;
  }
  const match = String(upload.dataUrl).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) {
    throw new Error("Only PNG, JPG, JPEG, and WEBP image uploads are allowed.");
  }
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) {
    throw new Error("Upload image must be smaller than 4 MB.");
  }
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = "order-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "." + ext;
  await fsp.writeFile(path.join(UPLOAD_DIR, filename), bytes);
  return {
    filename,
    originalName: String(upload.name || filename).slice(0, 120),
    url: "/uploads/" + filename,
    size: bytes.length,
    type: "image/" + ext,
    label: String(upload.label || "Photo").trim().slice(0, 80),
    itemKey: String(upload.itemKey || "").slice(0, 260),
    productId: String(upload.productId || "").slice(0, 80)
  };
}

function normalizeRawUploads(rawUploads, items) {
  const uploads = Array.isArray(rawUploads) ? rawUploads : [];
  const firstItem = items[0];
  return uploads
    .filter((upload) => upload && upload.dataUrl)
    .map((upload, index) => ({
      ...upload,
      label: String(upload.label || (uploads.length === 1 ? "Customer photo" : "Photo " + (index + 1))).trim().slice(0, 80),
      itemKey: String(upload.itemKey || (firstItem && firstItem.cartKey) || "").slice(0, 260),
      productId: String(upload.productId || (firstItem && firstItem.productId) || "").slice(0, 80)
    }));
}

function validateOrderUploads(items, uploads, products) {
  for (const item of items) {
    const product = products.find((entry) => entry.id === item.productId);
    const requirement = productPhotoRequirement(product, item.options);
    const itemUploads = uploads.filter((upload) => upload.itemKey === item.cartKey || (!upload.itemKey && upload.productId === item.productId));
    if (itemUploads.length < requirement.min) {
      throw new Error(item.name + " requires at least " + requirement.min + " photo" + (requirement.min === 1 ? "." : "s."));
    }
    if (itemUploads.length > requirement.max) {
      throw new Error(item.name + " accepts a maximum of " + requirement.max + " photo" + (requirement.max === 1 ? "." : "s."));
    }
  }
}

async function saveUploads(uploads) {
  const saved = [];
  for (const upload of uploads) {
    const result = await saveUpload(upload);
    if (result) {
      saved.push(result);
    }
  }
  return saved;
}

function orderUploads(order) {
  if (Array.isArray(order.uploads) && order.uploads.length) {
    return order.uploads;
  }
  return order.upload ? [order.upload] : [];
}

function absoluteUploadUrl(upload, settings) {
  if (!upload || !upload.url) {
    return "";
  }
  if (/^https?:\/\//.test(upload.url)) {
    return upload.url;
  }
  const baseUrl = String(settings.publicUrl || "").replace(/\/$/, "");
  return baseUrl ? baseUrl + upload.url : upload.url;
}

function buildWhatsAppText(order, settings) {
  const lines = [];
  lines.push("Karimnagar Frames order " + order.id);
  lines.push("");
  lines.push("Customer: " + order.customer.name);
  lines.push("Phone: " + order.customer.phone);
  if (order.customer.email) {
    lines.push("Email: " + order.customer.email);
  }
  lines.push("");
  order.items.forEach((item) => {
    lines.push("- " + item.name + " x " + item.quantity + " = Rs. " + item.unitPrice * item.quantity);
  });
  lines.push("");
  lines.push("Total: Rs. " + order.total);
  const payment = paymentForOrder(order);
  lines.push("Payment: " + payment.method + " (" + payment.status + ")");
  if (payment.reference) {
    lines.push("Payment ref: " + payment.reference);
  }
  if (order.notes) {
    lines.push("Notes: " + order.notes);
  }
  orderUploads(order).forEach((upload, index) => {
    lines.push((upload.label || "Customer photo " + (index + 1)) + ": " + absoluteUploadUrl(upload, settings));
  });
  lines.push("");
  lines.push("Please confirm preview and delivery details.");
  const phone = String(settings.whatsappPhone || settings.primaryPhone || "").replace(/[^\d]/g, "");
  return "https://wa.me/" + phone + "?text=" + encodeURIComponent(lines.join("\n"));
}

function whatsAppCustomerPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) {
    return "91" + digits;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return "91" + digits.slice(1);
  }
  return digits;
}

function orderPhotoUrl(order, settings) {
  const upload = orderUploads(order)[0];
  if (!upload || !upload.url) {
    return "";
  }
  return absoluteUploadUrl(upload, settings);
}

function buildCustomerWhatsAppText(order, settings) {
  const lines = [];
  const payment = paymentForOrder(order);
  lines.push("Hello " + order.customer.name + ", Karimnagar Frames here.");
  lines.push("Order: " + order.id);
  lines.push("Status: " + order.status);
  lines.push("Payment: " + payment.method + " (" + payment.status + ")");
  lines.push("Total: Rs. " + order.total);
  lines.push("");
  lines.push("Items:");
  order.items.forEach((item) => {
    lines.push("- " + item.name + " x " + item.quantity);
  });
  const uploads = orderUploads(order);
  if (uploads.length) {
    lines.push("");
    uploads.forEach((upload, index) => {
      lines.push((upload.label || "Uploaded photo " + (index + 1)) + ": " + absoluteUploadUrl(upload, settings));
    });
  }
  lines.push("");
  lines.push("Please reply here for preview, payment, or delivery updates.");
  return "https://wa.me/" + whatsAppCustomerPhone(order.customer.phone) + "?text=" + encodeURIComponent(lines.join("\n"));
}

function orderForResponse(order, settings) {
  const uploads = orderUploads(order);
  return {
    ...order,
    upload: uploads[0] || null,
    uploads,
    payment: paymentForOrder(order),
    whatsappUrl: buildWhatsAppText(order, settings),
    customerWhatsappUrl: buildCustomerWhatsAppText(order, settings)
  };
}

async function handleApi(req, res, pathname, url) {
  const db = await readDb();
  cleanSessions(db);

  if (req.method === "GET" && pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      app: db.meta.name,
      version: db.meta.version,
      time: now()
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/settings") {
    json(res, 200, { ok: true, settings: db.settings });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/products") {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    json(res, 200, { ok: true, products: (db.products || []).map((product) => normalizeProductRecord(product)) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/products") {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    const body = await readBody(req);
    let product;
    try {
      product = await productFromAdminInput(db, body);
    } catch (productError) {
      error(res, 400, productError.message);
      return;
    }
    db.products = db.products || [];
    db.products.unshift(product);
    db.meta = db.meta || {};
    db.meta.productsManagedAt = now();
    await writeDb(db);
    json(res, 201, { ok: true, product });
    return;
  }

  const adminProductMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if ((req.method === "PUT" || req.method === "PATCH") && adminProductMatch) {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    const product = (db.products || []).find((entry) => entry.id === adminProductMatch[1]);
    if (!product) {
      error(res, 404, "Product not found.");
      return;
    }
    const body = await readBody(req);
    let updated;
    try {
      updated = await productFromAdminInput(db, body, product);
    } catch (productError) {
      error(res, 400, productError.message);
      return;
    }
    const index = db.products.findIndex((entry) => entry.id === product.id);
    db.products[index] = updated;
    db.meta = db.meta || {};
    db.meta.productsManagedAt = now();
    await writeDb(db);
    json(res, 200, { ok: true, product: updated });
    return;
  }

  if (req.method === "DELETE" && adminProductMatch) {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    const product = (db.products || []).find((entry) => entry.id === adminProductMatch[1]);
    if (!product) {
      error(res, 404, "Product not found.");
      return;
    }
    product.available = false;
    product.stockStatus = "Disabled";
    product.status = "disabled";
    product.deletedAt = now();
    product.updatedAt = now();
    db.meta = db.meta || {};
    db.meta.productsManagedAt = now();
    await writeDb(db);
    json(res, 200, { ok: true, product: normalizeProductRecord(product) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/products") {
    const q = String(url.searchParams.get("q") || "").toLowerCase();
    const category = String(url.searchParams.get("category") || "all");
    let products = (db.products || []).filter(isProductAvailable);
    if (category && category !== "all") {
      products = products.filter((product) => product.category === category);
    }
    if (q) {
      products = products.filter((product) => {
        return [product.name, product.summary, product.description, ...(product.tags || [])].join(" ").toLowerCase().includes(q);
      });
    }
    json(res, 200, { ok: true, products });
    return;
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (req.method === "GET" && productMatch) {
    const product = (db.products || []).find((item) => item.id === productMatch[1]);
    if (!product || !isProductAvailable(product)) {
      error(res, 404, "Product not found.");
      return;
    }
    json(res, 200, { ok: true, product });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(req);
    const identifier = String(body.identifier || body.phone || body.email || "").trim();
    const loginPhoneKey = phoneKey(identifier);
    const loginEmail = normalizeEmail(identifier);
    const loginUsername = identifier.toLowerCase();
    const user = (db.users || []).find((item) => {
      return phoneKey(item.phone) === loginPhoneKey || normalizeEmail(item.email) === loginEmail || String(item.username || "").toLowerCase() === loginUsername;
    });
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      error(res, 401, "Invalid ID, mobile number, or password.");
      return;
    }
    const token = createSession(db, user);
    await writeDb(db);
    setSessionCookie(res, token);
    json(res, 200, { ok: true, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/request-otp") {
    const body = await readBody(req);
    const missing = requireFields(body, ["name", "phone", "password"]);
    if (missing) {
      error(res, 400, missing);
      return;
    }
    const email = normalizeEmail(body.email);
    if (email && !validEmail(email)) {
      error(res, 400, "Please enter a valid email address.");
      return;
    }
    if (!validPhone(body.phone)) {
      error(res, 400, "Please enter a valid phone number.");
      return;
    }
    const mobileKey = phoneKey(body.phone);
    if (mobileKey.length < 10) {
      error(res, 400, "Please enter a valid mobile number.");
      return;
    }
    if (String(body.password).length < 8) {
      error(res, 400, "Password must be at least 8 characters.");
      return;
    }
    if ((db.users || []).some((user) => phoneKey(user.phone) === mobileKey)) {
      error(res, 409, "An account with this mobile number already exists.");
      return;
    }
    if (email && (db.users || []).some((user) => normalizeEmail(user.email) === email)) {
      error(res, 409, "An account with this email already exists.");
      return;
    }
    const otp = generateOtp();
    const challenge = {
      id: id("otp"),
      purpose: "register",
      name: String(body.name).trim().slice(0, 80),
      email,
      phone: String(body.phone).trim(),
      phoneKey: mobileKey,
      passwordHash: hashPassword(String(body.password)),
      otpHash: hashPassword(otp),
      attempts: 0,
      createdAt: now(),
      expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString()
    };
    db.otpChallenges = (db.otpChallenges || []).filter((item) => item.phoneKey !== mobileKey);
    db.otpChallenges.push(challenge);
    const sms = await sendOtpSms(challenge.phone, otp);
    await writeDb(db);
    const demoAllowed = !sms.sent || process.env.SHOW_DEMO_OTP === "true";
    json(res, 200, {
      ok: true,
      challengeId: challenge.id,
      otpSent: sms.sent,
      smsProvider: sms.provider,
      message: sms.sent ? "OTP sent to your mobile number." : "Free SMS was not available, so use the demo OTP shown here.",
      demoOtp: demoAllowed ? otp : undefined
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/verify-otp") {
    const body = await readBody(req);
    const challenge = (db.otpChallenges || []).find((item) => item.id === body.challengeId);
    if (!challenge) {
      error(res, 400, "OTP session expired. Please request a new OTP.");
      return;
    }
    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      db.otpChallenges = (db.otpChallenges || []).filter((item) => item.id !== challenge.id);
      await writeDb(db);
      error(res, 400, "OTP expired. Please request a new OTP.");
      return;
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      db.otpChallenges = (db.otpChallenges || []).filter((item) => item.id !== challenge.id);
      await writeDb(db);
      error(res, 429, "Too many OTP attempts. Please request a new OTP.");
      return;
    }
    if (!verifyPassword(String(body.otp || ""), challenge.otpHash)) {
      challenge.attempts += 1;
      await writeDb(db);
      error(res, 400, "Invalid OTP.");
      return;
    }
    if ((db.users || []).some((user) => phoneKey(user.phone) === challenge.phoneKey)) {
      db.otpChallenges = (db.otpChallenges || []).filter((item) => item.id !== challenge.id);
      await writeDb(db);
      error(res, 409, "An account with this mobile number already exists.");
      return;
    }
    const user = {
      id: id("usr"),
      name: challenge.name,
      email: challenge.email,
      phone: challenge.phone,
      phoneVerified: true,
      role: "customer",
      passwordHash: challenge.passwordHash,
      createdAt: now(),
      address: ""
    };
    db.users.push(user);
    db.otpChallenges = (db.otpChallenges || []).filter((item) => item.id !== challenge.id);
    const token = createSession(db, user);
    await writeDb(db);
    setSessionCookie(res, token);
    json(res, 201, { ok: true, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    error(res, 400, "Please create an account by verifying your mobile number with OTP.");
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(req.headers.cookie).kf_session;
    db.sessions = (db.sessions || []).filter((session) => session.token !== token);
    await writeDb(db);
    clearSessionCookie(res);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    await writeDb(db);
    json(res, 200, { ok: true, user: publicUser(currentUser(req, db)) });
    return;
  }

  if (req.method === "PATCH" && pathname === "/api/users/me") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const body = await readBody(req);
    if (body.name) {
      user.name = String(body.name).trim().slice(0, 80);
    }
    if (body.phone) {
      if (!validPhone(body.phone)) {
        error(res, 400, "Please enter a valid phone number.");
        return;
      }
      user.phone = String(body.phone).trim();
    }
    if (typeof body.address === "string") {
      user.address = body.address.trim().slice(0, 200);
    }
    await writeDb(db);
    json(res, 200, { ok: true, user: publicUser(user) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/cart") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const cart = userCart(db, user.id);
    const items = normalizeCartItems(db, cart.items || []);
    cart.items = items;
    cart.updatedAt = now();
    await writeDb(db);
    json(res, 200, { ok: true, cart: { items, updatedAt: cart.updatedAt } });
    return;
  }

  if (req.method === "PUT" && pathname === "/api/cart") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const body = await readBody(req);
    let items;
    try {
      items = normalizeCartItems(db, body.items || []);
    } catch (cartError) {
      error(res, 400, cartError.message);
      return;
    }
    const cart = userCart(db, user.id);
    cart.items = items;
    cart.updatedAt = now();
    await writeDb(db);
    json(res, 200, { ok: true, cart: { items, updatedAt: cart.updatedAt } });
    return;
  }

  if (req.method === "DELETE" && pathname === "/api/cart") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const cart = userCart(db, user.id);
    cart.items = [];
    cart.updatedAt = now();
    await writeDb(db);
    json(res, 200, { ok: true, cart: { items: [], updatedAt: cart.updatedAt } });
    return;
  }

  if (req.method === "GET" && pathname === "/api/orders") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const orders = (user.role === "admin" ? db.orders : db.orders.filter((order) => order.userId === user.id))
      .map((order) => orderForResponse(order, db.settings));
    json(res, 200, { ok: true, orders });
    return;
  }

  const orderDetailMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (req.method === "GET" && orderDetailMatch) {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const order = (db.orders || []).find((entry) => entry.id === orderDetailMatch[1]);
    if (!order || (user.role !== "admin" && order.userId !== user.id)) {
      error(res, 404, "Order not found.");
      return;
    }
    json(res, 200, { ok: true, order: orderForResponse(order, db.settings) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const body = await readBody(req);
    const inputCustomer = body.customer || {};
    const customer = {
      name: String(inputCustomer.name || user.name || "").trim(),
      phone: String(inputCustomer.phone || user.phone || "").trim(),
      email: normalizeEmail(inputCustomer.email || user.email),
      address: String(inputCustomer.address || user.address || "").trim()
    };
    const missing = requireFields(customer, ["name", "phone", "address"]);
    if (missing) {
      error(res, 400, missing);
      return;
    }
    if (!validPhone(customer.phone)) {
      error(res, 400, "Please enter a valid phone number.");
      return;
    }
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      error(res, 400, "Your cart is empty.");
      return;
    }
    let total = 0;
    let normalizedItems = [];
    try {
      normalizedItems = normalizeCartItems(db, items);
    } catch (cartError) {
      error(res, 400, cartError.message);
      return;
    }
    normalizedItems.forEach((item) => {
      total += item.unitPrice * item.quantity;
    });
    const rawUploads = normalizeRawUploads(Array.isArray(body.uploads) ? body.uploads : (body.upload ? [body.upload] : []), normalizedItems);
    try {
      validateOrderUploads(normalizedItems, rawUploads, db.products);
    } catch (validationError) {
      error(res, 400, validationError.message);
      return;
    }
    let uploads = [];
    try {
      uploads = await saveUploads(rawUploads);
    } catch (uploadError) {
      error(res, 400, uploadError.message);
      return;
    }
    if (customer.address) {
      user.address = customer.address.slice(0, 200);
    }
    if (customer.name) {
      user.name = customer.name.slice(0, 80);
    }
    if (customer.phone) {
      user.phone = customer.phone;
    }
    const order = {
      id: orderId(db),
      userId: user.id,
      customer: {
        name: String(customer.name).trim().slice(0, 80),
        email: customer.email,
        phone: String(customer.phone).trim(),
        address: String(customer.address || "").trim().slice(0, 200)
      },
      items: normalizedItems,
      notes: String(body.notes || "").trim().slice(0, 800),
      upload: uploads[0] || null,
      uploads,
      total,
      payment: paymentFromInput(body.payment, total),
      status: "Pending",
      createdAt: now(),
      updatedAt: now()
    };
    order.whatsappUrl = buildWhatsAppText(order, db.settings);
    order.customerWhatsappUrl = buildCustomerWhatsAppText(order, db.settings);
    db.orders.unshift(order);
    const cart = userCart(db, user.id);
    cart.items = [];
    cart.updatedAt = now();
    await writeDb(db);
    json(res, 201, { ok: true, order });
    return;
  }

  const orderStatusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (req.method === "PATCH" && orderStatusMatch) {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    const body = await readBody(req);
    if (!ORDER_STATUSES.includes(body.status)) {
      error(res, 400, "Invalid order status.");
      return;
    }
    const order = db.orders.find((entry) => entry.id === orderStatusMatch[1]);
    if (!order) {
      error(res, 404, "Order not found.");
      return;
    }
    order.status = body.status;
    order.updatedAt = now();
    order.customerWhatsappUrl = buildCustomerWhatsAppText(order, db.settings);
    await writeDb(db);
    json(res, 200, { ok: true, order: orderForResponse(order, db.settings) });
    return;
  }

  const orderPaymentMatch = pathname.match(/^\/api\/orders\/([^/]+)\/payment$/);
  if (req.method === "PATCH" && orderPaymentMatch) {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    const body = await readBody(req);
    if (!PAYMENT_STATUSES.includes(body.status)) {
      error(res, 400, "Invalid payment status.");
      return;
    }
    const order = db.orders.find((entry) => entry.id === orderPaymentMatch[1]);
    if (!order) {
      error(res, 404, "Order not found.");
      return;
    }
    order.payment = paymentForOrder(order);
    order.payment.status = body.status;
    if (typeof body.reference === "string") {
      order.payment.reference = body.reference.trim().slice(0, 120);
    }
    order.payment.updatedAt = now();
    order.updatedAt = now();
    order.whatsappUrl = buildWhatsAppText(order, db.settings);
    order.customerWhatsappUrl = buildCustomerWhatsAppText(order, db.settings);
    await writeDb(db);
    json(res, 200, { ok: true, order: orderForResponse(order, db.settings) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/contact") {
    const body = await readBody(req);
    const missing = requireFields(body, ["name", "phone", "message"]);
    if (missing) {
      error(res, 400, missing);
      return;
    }
    if (!validPhone(body.phone)) {
      error(res, 400, "Please enter a valid phone number.");
      return;
    }
    const entry = {
      id: id("msg"),
      name: String(body.name).trim().slice(0, 80),
      phone: String(body.phone).trim(),
      email: normalizeEmail(body.email),
      message: String(body.message).trim().slice(0, 1000),
      createdAt: now(),
      status: "Unread"
    };
    db.contacts.unshift(entry);
    await writeDb(db);
    json(res, 201, { ok: true, contact: entry });
    return;
  }

  if (req.method === "GET" && pathname === "/api/contact") {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    json(res, 200, { ok: true, contacts: db.contacts || [] });
    return;
  }

  if (req.method === "GET" && pathname === "/api/customers") {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const users = (db.users || []).filter((user) => user.role !== "admin");
    const customers = users.map((user) => {
      const userOrders = (db.orders || []).filter((order) => {
        return order.userId === user.id || phoneKey(order.customer && order.customer.phone) === phoneKey(user.phone);
      }).map((order) => ({ ...order, payment: paymentForOrder(order) }));
      const totalSpent = userOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
      const lastOrder = userOrders[0] || null;
      return {
        id: user.id,
        name: user.name,
        username: user.username || "",
        email: user.email || "",
        phone: user.phone || "",
        phoneVerified: Boolean(user.phoneVerified),
        address: user.address || "",
        createdAt: user.createdAt,
        orderCount: userOrders.length,
        totalSpent,
        lastOrderAt: lastOrder ? lastOrder.createdAt : null,
        orders: userOrders
      };
    }).filter((customer) => {
      if (!q) {
        return true;
      }
      return [customer.name, customer.email, customer.phone, customer.address, customer.id]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    json(res, 200, { ok: true, customers });
    return;
  }

  if (req.method === "GET" && pathname === "/api/dashboard/stats") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const orders = user.role === "admin" ? db.orders : db.orders.filter((order) => order.userId === user.id);
    const revenue = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const pending = orders.filter((order) => !["Delivered", "Cancelled"].includes(order.status)).length;
    json(res, 200, {
      ok: true,
      stats: {
        orders: orders.length,
        revenue,
        pending,
        products: db.products.length,
        contacts: user.role === "admin" ? (db.contacts || []).length : 0
      }
    });
    return;
  }

  error(res, 404, "API route not found.");
}

async function serveStatic(req, res, pathname) {
  if (["/karim.html", "/cup.html", "/re1.html", "/pillow.html"].includes(pathname)) {
    const target = pathname === "/karim.html" ? "/" : "/?product=" + encodeURIComponent(pathname.replace("/", "").replace(".html", ""));
    send(res, 302, "Redirecting", { Location: target });
    return;
  }

  let requestedPath = pathname === "/" ? "/index.html" : pathname;
  if (requestedPath === "/auth") {
    requestedPath = "/auth.html";
  }
  if (requestedPath === "/dashboard") {
    requestedPath = "/dashboard.html";
  }
  if (requestedPath === "/owner-dashboard") {
    requestedPath = "/owner-dashboard.html";
  }
  if (requestedPath === "/owner-products") {
    requestedPath = "/owner-products.html";
  }
  if (requestedPath === "/customer-dashboard") {
    requestedPath = "/customer-dashboard.html";
  }
  if (requestedPath === "/product") {
    requestedPath = "/product.html";
  }
  if (requestedPath === "/owner-dashboard.html" || requestedPath === "/owner-products.html") {
    const db = await readDb();
    const user = currentUser(req, db);
    if (!user) {
      send(res, 302, "Redirecting", { Location: "/auth.html?returnTo=" + encodeURIComponent(requestedPath) });
      return;
    }
    if (user.role !== "admin") {
      send(res, 302, "Redirecting", { Location: "/customer-dashboard.html" });
      return;
    }
  }
  if (requestedPath === "/customer-dashboard.html") {
    const db = await readDb();
    const user = currentUser(req, db);
    if (!user) {
      send(res, 302, "Redirecting", { Location: "/auth.html?returnTo=" + encodeURIComponent(requestedPath) });
      return;
    }
    if (user.role === "admin") {
      send(res, 302, "Redirecting", { Location: "/owner-dashboard.html" });
      return;
    }
  }
  if (requestedPath.startsWith("/uploads/")) {
    const uploadFile = path.resolve(UPLOAD_DIR, "." + requestedPath.replace("/uploads", ""));
    if (!uploadFile.startsWith(UPLOAD_DIR)) {
      error(res, 403, "Forbidden.");
      return;
    }
    await streamFile(res, uploadFile);
    return;
  }

  const file = path.resolve(PUBLIC_DIR, "." + requestedPath);
  if (!file.startsWith(PUBLIC_DIR)) {
    error(res, 403, "Forbidden.");
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    await streamFile(res, file);
    return;
  }
  await streamFile(res, path.join(PUBLIC_DIR, "404.html"), 404);
}

async function streamFile(res, file, status = 200) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      error(res, 404, "File not found.");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const stream = fs.createReadStream(file);
    res.writeHead(status, securityHeaders({
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": [".html", ".css", ".js"].includes(ext) ? "no-store" : "public, max-age=3600"
    }));
    stream.pipe(res);
    stream.on("error", () => error(res, 500, "Unable to read file."));
  } catch (fileError) {
    error(res, status === 404 ? 404 : 500, "File not found.");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname, url);
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (routeError) {
    if (!res.headersSent) {
      error(res, 500, "Unexpected server error.", routeError.message);
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  const hostLabel = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.log("Karimnagar Frames running at http://" + hostLabel + ":" + PORT);
});
