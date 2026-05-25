"use strict";

const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const port = 8099;
const base = "http://127.0.0.1:" + port;

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/api/health");
      if (response.ok) {
        return;
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("Server did not start in time.");
}

async function request(pathname, options = {}) {
  const response = await fetch(base + pathname, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { raw: text };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(pathname + " failed: " + text);
  }
  return { response, data };
}

async function expectFailure(pathname, options = {}, expectedStatus = 401) {
  const response = await fetch(base + pathname, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  if (response.status !== expectedStatus) {
    const text = await response.text();
    throw new Error(pathname + " expected " + expectedStatus + " but got " + response.status + ": " + text);
  }
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kf-smoke-"));
  const tempDb = path.join(temp, "db.json");
  const tempUploads = path.join(temp, "uploads");
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
      SMS_PROVIDER: "demo"
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

  try {
    await waitForServer();
    await request("/api/products");
    const sitemap = await request("/sitemap.xml");
    if (!String(sitemap.data.raw || "").includes("product.html?id=cup-photo-printing")) {
      throw new Error("Dynamic sitemap did not include public product URLs.");
    }
    await request("/");
    await request("/product.html?id=cup-photo-printing");
    await request("/owner-dashboard.html");
    await request("/customer-dashboard.html");
    await request("/api/products/cup-photo-printing");
    await expectFailure("/api/cart", {}, 401);
    await expectFailure("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        customer: { name: "Guest", phone: "9876543210", address: "Karimnagar" },
        items: [{ productId: "cup-photo-printing", quantity: 1, options: {} }]
      })
    }, 401);
    const login = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        identifier: "karimnagarframes",
        password: "karimnagar@123"
      })
    });
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    await expectFailure("/api/admin/products", {}, 401);
    await request("/owner-products.html", {
      headers: { Cookie: cookie }
    });
    const adminProducts = await request("/api/admin/products", {
      headers: { Cookie: cookie }
    });
    if (!adminProducts.data.products.length) {
      throw new Error("Owner products API did not return catalog products.");
    }
    await expectFailure("/api/admin/products", {
      method: "POST",
      headers: { Cookie: cookie },
        body: JSON.stringify({
          name: "Broken Product",
          basePrice: 0,
          description: "Invalid price should fail."
        })
    }, 400);
    const newProduct = await request("/api/admin/products", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        name: "Smoke Test Table Frame",
        category: "frames",
        basePrice: 456,
        stockStatus: "Available",
        summary: "Temporary product created by the smoke test.",
        description: "Temporary product created by the smoke test.",
        sizes: ["A5", "A4"],
        colors: ["Black", "White"],
        options: [
          {
            name: "Finish",
            choices: [
              { label: "Matte", price: 0 },
              { label: "Glossy", price: 50 }
            ]
          }
        ],
        customFields: [
          { label: "Name on frame", required: true }
        ],
        photoMin: 2,
        photoMax: 3,
        photoLabels: ["Photo 1", "Photo 2", "Optional Photo 3"],
        tags: ["smoke"],
        features: ["Owner editable product"]
      })
    });
    if (!newProduct.data.product.id || newProduct.data.product.photoRequirements.min !== 2 || newProduct.data.product.customFields.length !== 1) {
      throw new Error("Owner product creation did not save photo/customization requirements.");
    }
    const publicProductsAfterCreate = await request("/api/products");
    if (!publicProductsAfterCreate.data.products.some((product) => product.id === newProduct.data.product.id)) {
      throw new Error("Owner-created product did not appear on the public product API.");
    }
    const updatedProduct = await request("/api/admin/products/" + newProduct.data.product.id, {
      method: "PUT",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        ...newProduct.data.product,
        name: "Smoke Test Updated Frame",
        basePrice: 567,
        stockStatus: "Available",
        photoMin: 1,
        photoMax: 2,
        photoLabels: ["Main Photo", "Optional Photo"]
      })
    });
    if (updatedProduct.data.product.basePrice !== 567 || updatedProduct.data.product.photoRequirements.max !== 2) {
      throw new Error("Owner product update did not persist price/photo settings.");
    }
    await request("/api/admin/products/" + newProduct.data.product.id, {
      method: "DELETE",
      headers: { Cookie: cookie }
    });
    await expectFailure("/api/products/" + newProduct.data.product.id, {}, 404);
    const customersBeforeOtp = await request("/api/customers", {
      headers: { Cookie: cookie }
    });
    if (customersBeforeOtp.data.customers.some((customer) => customer.phone === "9876543210")) {
      throw new Error("Demo sample customer was not removed from owner customers.");
    }
    const otpRequest = await request("/api/auth/request-otp", {
      method: "POST",
      body: JSON.stringify({
        name: "OTP Customer",
        phone: "9123456780",
        email: "otp@example.com",
        password: "Customer@12345"
      })
    });
    if (!otpRequest.data.challengeId || !otpRequest.data.demoOtp) {
      throw new Error("OTP request did not return a demo OTP in test mode.");
    }
    if (otpRequest.data.otpChannel !== "email") {
      throw new Error("OTP registration did not use email delivery in test mode.");
    }
    const otpVerify = await request("/api/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({
        challengeId: otpRequest.data.challengeId,
        otp: otpRequest.data.demoOtp
      })
    });
    if (!otpVerify.data.user.emailVerified || otpVerify.data.user.phone !== "9123456780") {
      throw new Error("OTP registration did not create an email verified customer account.");
    }
    let customerCookie = otpVerify.response.headers.get("set-cookie").split(";")[0];
    await request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: customerCookie },
      body: "{}"
    });
    const resetRequest = await request("/api/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify({
        phone: "9123456780",
        password: "Customer@Reset123"
      })
    });
    if (!resetRequest.data.challengeId || !resetRequest.data.demoOtp) {
      throw new Error("Password reset did not return a demo OTP in test mode.");
    }
    if (resetRequest.data.otpChannel !== "email") {
      throw new Error("Password reset did not use email delivery in test mode.");
    }
    const resetVerify = await request("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        challengeId: resetRequest.data.challengeId,
        otp: resetRequest.data.demoOtp,
        password: "Customer@Reset123"
      })
    });
    if (!resetVerify.data.user || resetVerify.data.user.phone !== "9123456780") {
      throw new Error("Password reset did not return the customer account.");
    }
    const resetCookie = resetVerify.response.headers.get("set-cookie").split(";")[0];
    await request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: resetCookie },
      body: "{}"
    });
    const relogin = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        identifier: "9123456780",
        password: "Customer@Reset123"
      })
    });
    customerCookie = relogin.response.headers.get("set-cookie").split(";")[0];
    const pillowOptions = {
      "Pillow size": "12x12 inches",
      "Print side": "Both sides"
    };
    await request("/api/cart", {
      method: "PUT",
      headers: { Cookie: customerCookie },
      body: JSON.stringify({
        items: [
          {
            productId: "pillow-printing",
            quantity: 1,
            options: pillowOptions
          }
        ]
      })
    });
    const customerCart = await request("/api/cart", {
      headers: { Cookie: customerCookie }
    });
    if (!customerCart.data.cart.items.some((item) => item.productId === "pillow-printing")) {
      throw new Error("Logged-in cart API did not persist the pillow item.");
    }
    const pillowKey = customerCart.data.cart.items.find((item) => item.productId === "pillow-printing").cartKey;
    const customerOrder = await request("/api/orders", {
      method: "POST",
      headers: { Cookie: customerCookie },
      body: JSON.stringify({
        customer: {
          name: "OTP Customer",
          phone: "9123456780",
          email: "otp@example.com",
          address: "Karimnagar"
        },
        items: customerCart.data.cart.items,
        payment: {
          method: "Pay on Delivery"
        },
        uploads: [
          {
            name: "front.png",
            label: "Front Side Photo",
            itemKey: pillowKey,
            productId: "pillow-printing",
            dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
          },
          {
            name: "back.png",
            label: "Back Side Photo",
            itemKey: pillowKey,
            productId: "pillow-printing",
            dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
          }
        ]
      })
    });
    if (!customerOrder.data.order.uploads || customerOrder.data.order.uploads.length !== 2) {
      throw new Error("Multi-photo customer order did not save both uploaded photos.");
    }
    const emptyCustomerCart = await request("/api/cart", {
      headers: { Cookie: customerCookie }
    });
    if (emptyCustomerCart.data.cart.items.length) {
      throw new Error("Customer cart was not cleared after checkout.");
    }
    await request("/api/dashboard/stats", {
      headers: { Cookie: cookie }
    });
    await request("/api/contact", {
      method: "POST",
      body: JSON.stringify({
        name: "Smoke Test",
        phone: "9876543210",
        email: "smoke@example.com",
        message: "Testing contact form."
      })
    });
    const checkout = await request("/api/orders", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        customer: {
          name: "Smoke Test",
          phone: "9876543210",
          email: "smoke@example.com",
          address: "Karimnagar"
        },
        notes: "Automated smoke test order.",
        items: [
          {
            productId: "cup-photo-printing",
            quantity: 1,
            options: {
              "Cup style": "White Glossy",
              "Print layout": "One side print"
            }
          }
        ],
        payment: {
          method: "UPI after Preview",
          reference: "SMOKE-UPI-1"
        },
        upload: {
          name: "smoke.png",
          dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        }
      })
    });
    if (checkout.data.order.payment.status !== "Awaiting Confirmation") {
      throw new Error("Checkout payment status was not saved correctly.");
    }
    await request("/api/orders/" + checkout.data.order.id + "/payment", {
      method: "PATCH",
      headers: { Cookie: cookie },
      body: JSON.stringify({ status: "Paid" })
    });
    const ownerOrders = await request("/api/orders", {
      headers: { Cookie: cookie }
    });
    if (!ownerOrders.data.orders.some((order) => order.customer.phone === "9876543210")) {
      throw new Error("Owner dashboard order API did not include the new checkout order.");
    }
    if (!ownerOrders.data.orders.some((order) => String(order.whatsappUrl || "").includes("9032428063"))) {
      throw new Error("WhatsApp order URL does not use the owner phone number.");
    }
    if (!ownerOrders.data.orders.some((order) => String(order.whatsappUrl || "").includes("Customer%20photo"))) {
      throw new Error("Customer uploaded photo link is missing from the owner WhatsApp message.");
    }
    if (!ownerOrders.data.orders.some((order) => String(order.customerWhatsappUrl || "").includes("919876543210"))) {
      throw new Error("Owner WhatsApp chat URL does not target the customer mobile number.");
    }
    if (!ownerOrders.data.orders.some((order) => order.id === checkout.data.order.id && order.payment.status === "Paid")) {
      throw new Error("Owner dashboard order API did not include the updated payment status.");
    }
    const customers = await request("/api/customers", {
      headers: { Cookie: cookie }
    });
    if (!customers.data.customers.some((customer) => customer.phone === "9123456780")) {
      throw new Error("Owner customers API did not include the OTP-created account.");
    }
    if (!customers.data.customers.some((customer) => customer.orderCount >= 1 || customer.phone === "9123456780")) {
      throw new Error("Owner customers API did not include customer order summaries.");
    }
    console.log("Smoke tests passed.");
  } finally {
    child.kill();
    await fs.rm(temp, { recursive: true, force: true });
  }

  if (child.exitCode && child.exitCode !== 0) {
    throw new Error(output);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
