"use strict";

const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const net = require("net");

const root = path.resolve(__dirname, "..");
const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const ORDER_STATUS_CANCELLED = "Cancelled";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function optionKey(value) {
  return JSON.stringify(value || {});
}

function normalizeOptionValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bprinting?\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function optionValueMatches(selectedValue, ruleValue) {
  const selected = normalizeOptionValue(selectedValue);
  const expected = normalizeOptionValue(ruleValue);
  return Boolean(selected && expected && (selected === expected || selected.includes(expected) || expected.includes(selected)));
}

function defaultUploadLabels(max) {
  return Array.from({ length: Math.max(1, Number(max) || 1) }, (_, index) => "Photo " + (index + 1));
}

function photoRequirement(product, selectedOptions = {}) {
  const config = product && product.photoRequirements && typeof product.photoRequirements === "object" ? product.photoRequirements : {};
  let requirement = {
    min: Number(config.min) || 1,
    max: Number(config.max) || Math.max(1, Number(config.min) || 1),
    labels: Array.isArray(config.labels) && config.labels.length ? [...config.labels] : defaultUploadLabels(config.max || config.min || 1)
  };
  (config.rules || []).forEach((rule) => {
    const when = rule.when || {};
    if (when.option && optionValueMatches(selectedOptions[when.option], when.value)) {
      requirement = {
        min: Number(rule.min) || requirement.min,
        max: Number(rule.max) || requirement.max,
        labels: Array.isArray(rule.labels) && rule.labels.length ? [...rule.labels] : requirement.labels
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

function productPrice(product, options = {}) {
  return (product.options || []).reduce((sum, group) => {
    const selected = options[group.name];
    const choice = (group.choices || []).find((entry) => entry.label === selected);
    return sum + Number(choice && choice.price ? choice.price : 0);
  }, Number(product.basePrice || product.price || 0));
}

function defaultOptions(product) {
  const options = {};
  (product.options || []).forEach((group) => {
    if (group.choices && group.choices.length) {
      options[group.name] = group.choices[0].label;
    }
  });
  return options;
}

function optionSetsForProduct(product) {
  const base = defaultOptions(product);
  const seen = new Set([optionKey(base)]);
  const sets = [{ label: "default options", options: base }];
  (product.options || []).forEach((group) => {
    (group.choices || []).forEach((choice) => {
      const options = { ...base, [group.name]: choice.label };
      const key = optionKey(options);
      if (!seen.has(key)) {
        seen.add(key);
        sets.push({ label: group.name + " = " + choice.label, options });
      }
    });
  });
  return sets;
}

function customFieldsForProduct(product) {
  const values = {};
  (product.customFields || []).forEach((field, index) => {
    values[field.label || field.id || "Field " + (index + 1)] = "Audit value " + (index + 1);
  });
  return values;
}

function uploadsFor(item, product, count) {
  const requirement = photoRequirement(product, item.options);
  return Array.from({ length: count }, (_, index) => ({
    name: product.id + "-" + (index + 1) + ".png",
    label: requirement.labels[index] || "Photo " + (index + 1),
    itemKey: item.cartKey,
    productId: product.id,
    dataUrl: ONE_PIXEL_PNG
  }));
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

function validProduct(product) {
  return product && product.id && product.name && Number(product.basePrice || product.price || 0) > 0;
}

async function request(baseUrl, pathname, options = {}, expectedStatus) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const response = await fetch(baseUrl + pathname, {
    ...options,
    headers
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { raw: text };
  }
  if (expectedStatus && response.status !== expectedStatus) {
    throw new Error(pathname + " expected " + expectedStatus + " but got " + response.status + ": " + text);
  }
  if (!expectedStatus && (!response.ok || data.ok === false)) {
    throw new Error(pathname + " failed: " + text);
  }
  return { response, data, status: response.status, text };
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function startLocalServer() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kf-product-audit-"));
  const tempDb = path.join(temp, "db.json");
  const tempUploads = path.join(temp, "uploads");
  const port = await getFreePort();
  await fs.copyFile(path.join(root, "data", "db.json"), tempDb);
  await fs.mkdir(tempUploads, { recursive: true });
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_FILE: tempDb,
      UPLOAD_DIR: tempUploads,
      OTP_CHANNEL: "email",
      EMAIL_PROVIDER: "demo",
      SMS_PROVIDER: "demo",
      SHOW_DEMO_OTP: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const baseUrl = "http://127.0.0.1:" + port;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(baseUrl + "/api/health");
      if (health.ok) {
        return {
          baseUrl,
          async cleanup() {
            child.kill();
            await fs.rm(temp, { recursive: true, force: true });
          },
          output: () => output
        };
      }
    } catch (error) {
      await delay(200);
    }
  }
  child.kill();
  await fs.rm(temp, { recursive: true, force: true });
  throw new Error("Local audit server did not start in time. " + output);
}

async function createCustomer(baseUrl) {
  const suffix = String(Date.now()).slice(-9);
  const phone = "7" + suffix;
  const password = "Audit@" + suffix;
  const email = "audit+" + suffix + "@example.com";
  const name = "Audit Customer " + suffix;
  const otpRequest = await request(baseUrl, "/api/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({
      name,
      phone,
      email,
      password
    })
  });
  if (!otpRequest.data.challengeId || !otpRequest.data.demoOtp) {
    throw new Error("OTP did not return a demo code. Enable demo OTP or verify the email provider before live order audits.");
  }
  const verified = await request(baseUrl, "/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({
      challengeId: otpRequest.data.challengeId,
      otp: otpRequest.data.demoOtp
    })
  });
  const cookie = cookieFrom(verified.response);
  if (!cookie) {
    throw new Error("Customer registration did not create a session cookie.");
  }
  return {
    cookie,
    customer: {
      name,
      phone,
      email,
      address: "Audit House, Karimnagar"
    },
    password
  };
}

async function loginOwner(baseUrl) {
  const ownerId = process.env.LIVE_AUDIT_OWNER_ID || process.env.OWNER_ID || "karimnagarframes";
  const ownerPassword = process.env.LIVE_AUDIT_OWNER_PASSWORD || process.env.OWNER_PASSWORD;
  if (!ownerPassword) {
    return "";
  }
  const login = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      identifier: ownerId,
      password: ownerPassword
    })
  });
  return cookieFrom(login.response);
}

async function cancelOrders(baseUrl, ownerCookie, orderIds) {
  if (!ownerCookie) {
    return [];
  }
  const cancelled = [];
  for (const orderId of orderIds) {
    await request(baseUrl, "/api/orders/" + encodeURIComponent(orderId) + "/status", {
      method: "PATCH",
      headers: { Cookie: ownerCookie },
      body: JSON.stringify({ status: ORDER_STATUS_CANCELLED })
    });
    cancelled.push(orderId);
  }
  return cancelled;
}

async function assertMissingPhotosFail(baseUrl, customerCookie, customer, product, options, customFields) {
  const requirement = photoRequirement(product, options);
  if (requirement.min <= 0) {
    return;
  }
  const cartItem = {
    productId: product.id,
    quantity: 1,
    options,
    customFields
  };
  await request(baseUrl, "/api/cart", {
    method: "PUT",
    headers: { Cookie: customerCookie },
    body: JSON.stringify({ items: [cartItem] })
  });
  const cart = await request(baseUrl, "/api/cart", {
    headers: { Cookie: customerCookie }
  });
  const item = (cart.data.cart.items || [])[0];
  const badUploads = uploadsFor(item, product, Math.max(0, requirement.min - 1));
  const attempt = await request(baseUrl, "/api/orders", {
    method: "POST",
    headers: { Cookie: customerCookie },
    body: JSON.stringify({
      customer,
      items: [item],
      payment: { method: "Pay on Delivery" },
      notes: "AUTOMATED AUDIT - missing photo validation",
      uploads: badUploads
    })
  }, 400);
  if (!/requires|photo|upload/i.test(attempt.text)) {
    throw new Error(product.name + " missing-photo validation returned an unclear message: " + attempt.text);
  }
}

async function placeProductOrder(baseUrl, customerCookie, customer, product, optionSet) {
  const customFields = customFieldsForProduct(product);
  const cartItem = {
    productId: product.id,
    quantity: 1,
    options: optionSet.options,
    customFields
  };
  await request(baseUrl, "/api/cart", {
    method: "PUT",
    headers: { Cookie: customerCookie },
    body: JSON.stringify({ items: [cartItem] })
  });
  const cart = await request(baseUrl, "/api/cart", {
    headers: { Cookie: customerCookie }
  });
  const item = (cart.data.cart.items || [])[0];
  if (!item || item.productId !== product.id || !item.cartKey) {
    throw new Error(product.name + " did not persist correctly in the logged-in cart.");
  }
  const requirement = photoRequirement(product, optionSet.options);
  const uploads = uploadsFor(item, product, requirement.min);
  const order = await request(baseUrl, "/api/orders", {
    method: "POST",
    headers: { Cookie: customerCookie },
    body: JSON.stringify({
      customer,
      items: [item],
      payment: { method: "Pay on Delivery" },
      notes: "AUTOMATED AUDIT - cancel after verification",
      uploads
    })
  });
  const saved = order.data.order;
  if (!saved || !saved.id) {
    throw new Error(product.name + " order response did not include an order ID.");
  }
  if (saved.userId && saved.customer.phone !== customer.phone) {
    throw new Error(product.name + " order was not linked to the expected customer.");
  }
  if (!Array.isArray(saved.items) || saved.items.length !== 1 || saved.items[0].productId !== product.id) {
    throw new Error(product.name + " order saved the wrong product item.");
  }
  if (!Array.isArray(saved.uploads) || saved.uploads.length !== requirement.min) {
    throw new Error(product.name + " order saved " + ((saved.uploads || []).length) + " uploads instead of " + requirement.min + ".");
  }
  const expectedTotal = productPrice(product, optionSet.options);
  if (Number(saved.total) !== expectedTotal) {
    throw new Error(product.name + " total mismatch for " + optionSet.label + ": expected " + expectedTotal + " got " + saved.total + ".");
  }
  const afterCart = await request(baseUrl, "/api/cart", {
    headers: { Cookie: customerCookie }
  });
  if ((afterCart.data.cart.items || []).length) {
    throw new Error(product.name + " cart was not cleared after checkout.");
  }
  return saved;
}

async function audit(baseUrl, mode) {
  const startedAt = new Date().toISOString();
  const productsResponse = await request(baseUrl, "/api/products");
  const products = productsResponse.data.products || [];
  if (!products.length) {
    throw new Error("No public products were returned by /api/products.");
  }
  const invalidProducts = products.filter((product) => !validProduct(product));
  if (invalidProducts.length) {
    throw new Error("Invalid public product records: " + invalidProducts.map((product) => product.id || product.name || "unknown").join(", "));
  }
  const account = await createCustomer(baseUrl);
  const ownerCookie = await loginOwner(baseUrl);
  const orderIds = [];
  const productResults = [];

  try {
    for (const product of products) {
      const optionSets = optionSetsForProduct(product);
      await assertMissingPhotosFail(baseUrl, account.cookie, account.customer, product, optionSets[0].options, customFieldsForProduct(product));
      const orders = [];
      for (const optionSet of optionSets) {
        const saved = await placeProductOrder(baseUrl, account.cookie, account.customer, product, optionSet);
        orderIds.push(saved.id);
        orders.push({
          id: saved.id,
          optionSet: optionSet.label,
          total: saved.total,
          uploadCount: (saved.uploads || []).length
        });
      }
      productResults.push({
        id: product.id,
        name: product.name,
        optionSetsTested: optionSets.length,
        orders
      });
      console.log("OK " + product.name + " - " + optionSets.length + " order flow(s)");
    }

    const ownerOrders = ownerCookie ? await request(baseUrl, "/api/orders", { headers: { Cookie: ownerCookie } }) : null;
    if (ownerOrders) {
      const ownerOrderIds = new Set((ownerOrders.data.orders || []).map((order) => order.id));
      const missing = orderIds.filter((orderId) => !ownerOrderIds.has(orderId));
      if (missing.length) {
        throw new Error("Owner dashboard API did not show order(s): " + missing.join(", "));
      }
    }
    const cancelled = await cancelOrders(baseUrl, ownerCookie, orderIds);
    const report = {
      ok: true,
      mode,
      baseUrl,
      startedAt,
      finishedAt: new Date().toISOString(),
      customer: {
        name: account.customer.name,
        phone: account.customer.phone,
        email: account.customer.email
      },
      productsTested: productResults.length,
      optionOrderFlowsTested: productResults.reduce((sum, product) => sum + product.optionSetsTested, 0),
      ordersCreated: orderIds.length,
      ordersCancelled: cancelled.length,
      productResults
    };
    console.log(JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    const cancelled = await cancelOrders(baseUrl, ownerCookie, orderIds);
    if (cancelled.length) {
      error.message += " Cancelled " + cancelled.length + " test order(s) before stopping.";
    }
    throw error;
  }
}

async function writeReport(report) {
  const artifactsDir = path.join(root, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  const safeMode = String(report.mode || "audit").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const file = path.join(artifactsDir, "product-order-audit-" + safeMode + ".json");
  await fs.writeFile(file, JSON.stringify(report, null, 2));
  console.log("Report saved to " + file);
}

async function main() {
  let cleanup = async () => {};
  let baseUrl = process.env.AUDIT_BASE_URL || process.env.BASE_URL || "";
  let mode = baseUrl ? "live" : "local";
  let serverOutput = "";
  if (!baseUrl) {
    const local = await startLocalServer();
    baseUrl = local.baseUrl;
    cleanup = local.cleanup;
    serverOutput = local.output;
  }
  try {
    const report = await audit(baseUrl.replace(/\/$/, ""), mode);
    await writeReport(report);
  } catch (error) {
    if (serverOutput) {
      console.error(serverOutput());
    }
    throw error;
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
