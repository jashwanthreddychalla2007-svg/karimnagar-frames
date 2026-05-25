"use strict";

const OwnerProductsApp = (() => {
  const state = {
    user: null,
    products: [],
    query: "",
    editingId: ""
  };

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = (value) => "Rs. " + (Number(value) || 0).toLocaleString("en-IN");

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error((data.error && data.error.message) || "Something went wrong.");
    }
    return data;
  }

  function toast(message, type = "success") {
    const stack = qs("[data-toast-stack]");
    if (!stack) {
      return;
    }
    const item = document.createElement("div");
    item.className = "toast " + type;
    item.textContent = message;
    stack.appendChild(item);
    window.setTimeout(() => item.remove(), 3400);
  }

  function splitText(value) {
    return Array.from(new Set(String(value || "")
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)));
  }

  function listText(value) {
    return (Array.isArray(value) ? value : []).join("\n");
  }

  function parseOptionsText(value) {
    return String(value || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const splitAt = line.indexOf(":");
        if (splitAt === -1) {
          return null;
        }
        const name = line.slice(0, splitAt).trim();
        const choices = line.slice(splitAt + 1).split(",").map((item) => {
          const [label, price] = item.split("=");
          return {
            label: String(label || "").trim(),
            price: Math.max(0, Number(price) || 0)
          };
        }).filter((choice) => choice.label);
        return name && choices.length ? { name, choices } : null;
      })
      .filter(Boolean);
  }

  function parseCustomFieldsText(value) {
    return String(value || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
        return {
          label: parts[0],
          required: parts.slice(1).some((part) => /^required$/i.test(part)),
          type: "text"
        };
      })
      .filter((field) => field.label);
  }

  function customFieldsText(product) {
    return (product.customFields || []).map((field) => {
      return field.label + (field.required ? " | required" : "");
    }).join("\n");
  }

  function optionsText(product) {
    return (product.options || []).map((group) => {
      const choices = (group.choices || []).map((choice) => choice.label + "=" + (Number(choice.price) || 0)).join(", ");
      return group.name + ": " + choices;
    }).join("\n");
  }

  function productImage(product) {
    return product && product.images && product.images[0] ? product.images[0] : "/assets/products/placeholders/product-placeholder.svg";
  }

  function isLive(product) {
    return product && product.available !== false && product.status !== "disabled" && product.stockStatus === "Available";
  }

  function renderStats() {
    const root = qs("[data-product-stats]");
    if (!root) {
      return;
    }
    const live = state.products.filter(isLive).length;
    const hidden = state.products.length - live;
    const average = state.products.length
      ? state.products.reduce((sum, product) => sum + (Number(product.basePrice) || 0), 0) / state.products.length
      : 0;
    const cards = [
      ["Total Products", state.products.length],
      ["Live Products", live],
      ["Hidden/Disabled", hidden],
      ["Average Price", money(Math.round(average))]
    ];
    root.innerHTML = cards.map(([label, value]) => `
      <article class="stat-card">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `).join("");
  }

  function renderProducts() {
    const root = qs("[data-owner-products]");
    if (!root) {
      return;
    }
    const query = state.query.trim().toLowerCase();
    const products = state.products.filter((product) => {
      if (!query) {
        return true;
      }
      return [product.name, product.category, product.summary, product.description, product.stockStatus, product.basePrice]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    if (!products.length) {
      root.innerHTML = "<p>No matching products.</p>";
      return;
    }
    root.innerHTML = products.map((product) => `
      <article class="owner-product-card ${state.editingId === product.id ? "is-selected" : ""}">
        <img src="${escapeHtml(productImage(product))}" alt="${escapeHtml(product.name)}" loading="lazy" />
        <div>
          <div class="owner-product-head">
            <strong>${escapeHtml(product.name)}</strong>
            <span class="${isLive(product) ? "stock-pill live" : "stock-pill muted"}">${escapeHtml(product.stockStatus || "Available")}</span>
          </div>
          <p>${escapeHtml(product.summary || product.description || "")}</p>
          <div class="owner-product-meta">
            <span>${escapeHtml(product.category)}</span>
            <span>${money(product.basePrice)}</span>
            <span>${(product.photoRequirements && product.photoRequirements.min) || 1}-${(product.photoRequirements && product.photoRequirements.max) || 1} photos</span>
          </div>
          <div class="owner-product-actions">
            <button class="btn btn-soft" type="button" data-edit-product="${escapeHtml(product.id)}">Edit</button>
            <a class="btn btn-outline" href="/product.html?id=${encodeURIComponent(product.id)}" target="_blank" rel="noopener">View</a>
            <button class="btn btn-outline danger-action" type="button" data-disable-product="${escapeHtml(product.id)}">Disable</button>
          </div>
        </div>
      </article>
    `).join("");

    qsa("[data-edit-product]").forEach((button) => {
      button.addEventListener("click", () => editProduct(button.dataset.editProduct));
    });
    qsa("[data-disable-product]").forEach((button) => {
      button.addEventListener("click", () => disableProduct(button.dataset.disableProduct));
    });
  }

  function setPreview(src) {
    const preview = qs("[data-product-image-preview]");
    if (preview) {
      preview.src = src || "/assets/products/placeholders/product-placeholder.svg";
    }
  }

  function resetForm() {
    const form = qs("[data-product-form]");
    if (!form) {
      return;
    }
    state.editingId = "";
    form.reset();
    form.elements.id.value = "";
    form.elements.category.value = "frames";
    form.elements.stockStatus.value = "Available";
    form.elements.photoMin.value = "1";
    form.elements.photoMax.value = "1";
    form.elements.badge.value = "Custom gift";
    form.elements.turnaround.value = "Preview before print";
    setPreview("");
    const mode = qs("[data-editor-mode]");
    const title = qs("[data-editor-title]");
    const disableButton = qs("[data-disable-current]");
    if (mode) {
      mode.textContent = "New product";
    }
    if (title) {
      title.textContent = "Add product";
    }
    if (disableButton) {
      disableButton.hidden = true;
    }
    renderProducts();
  }

  function editProduct(productId) {
    const product = state.products.find((item) => item.id === productId);
    const form = qs("[data-product-form]");
    if (!product || !form) {
      return;
    }
    state.editingId = product.id;
    form.elements.id.value = product.id;
    form.elements.name.value = product.name || "";
    form.elements.category.value = product.category || "frames";
    form.elements.basePrice.value = product.basePrice || 0;
    form.elements.stockStatus.value = product.stockStatus || (product.available === false ? "Disabled" : "Available");
    form.elements.summary.value = product.summary || "";
    form.elements.description.value = product.description || "";
    form.elements.imageUrl.value = productImage(product).startsWith("/uploads/") ? "" : productImage(product);
    form.elements.imageFile.value = "";
    form.elements.sizes.value = listText(product.sizes);
    form.elements.colors.value = listText(product.colors);
    form.elements.optionsText.value = optionsText(product);
    form.elements.customFieldsText.value = customFieldsText(product);
    form.elements.photoMin.value = (product.photoRequirements && product.photoRequirements.min) || 1;
    form.elements.photoMax.value = (product.photoRequirements && product.photoRequirements.max) || 1;
    form.elements.photoLabels.value = listText(product.photoRequirements && product.photoRequirements.labels);
    form.elements.features.value = listText(product.features);
    form.elements.tags.value = listText(product.tags);
    form.elements.badge.value = product.badge || "";
    form.elements.turnaround.value = product.turnaround || "";
    form.elements.featured.checked = Boolean(product.featured);
    setPreview(productImage(product));
    const mode = qs("[data-editor-mode]");
    const title = qs("[data-editor-title]");
    const disableButton = qs("[data-disable-current]");
    if (mode) {
      mode.textContent = "Editing " + product.id;
    }
    if (title) {
      title.textContent = "Edit product";
    }
    if (disableButton) {
      disableButton.hidden = false;
    }
    renderProducts();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve("");
        return;
      }
      if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
        reject(new Error("Use PNG, JPG, JPEG, or WEBP for product images."));
        return;
      }
      if (file.size > 4 * 1024 * 1024) {
        reject(new Error("Product image must be smaller than 4 MB."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read product image."));
      reader.readAsDataURL(file);
    });
  }

  async function payloadFromForm(form) {
    const photoMin = Math.max(1, Number(form.elements.photoMin.value) || 1);
    const photoMax = Math.max(photoMin, Number(form.elements.photoMax.value) || photoMin);
    if (Number(form.elements.basePrice.value) <= 0 || form.elements.basePrice.value === "") {
      throw new Error("Product price must be greater than zero.");
    }
    const file = form.elements.imageFile.files[0];
    const payload = {
      name: form.elements.name.value,
      category: form.elements.category.value,
      basePrice: Number(form.elements.basePrice.value),
      stockStatus: form.elements.stockStatus.value,
      available: form.elements.stockStatus.value === "Available",
      summary: form.elements.summary.value,
      description: form.elements.description.value,
      imageUrl: form.elements.imageUrl.value,
      sizes: splitText(form.elements.sizes.value),
      colors: splitText(form.elements.colors.value),
      options: parseOptionsText(form.elements.optionsText.value),
      customFields: parseCustomFieldsText(form.elements.customFieldsText.value),
      photoMin,
      photoMax,
      photoLabels: splitText(form.elements.photoLabels.value),
      features: splitText(form.elements.features.value),
      tags: splitText(form.elements.tags.value),
      badge: form.elements.badge.value,
      turnaround: form.elements.turnaround.value,
      featured: form.elements.featured.checked
    };
    if (file) {
      payload.imageDataUrl = await fileToDataUrl(file);
      payload.imageName = file.name;
    }
    return payload;
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = qs("[data-save-product]", form);
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Saving...";
      }
      const payload = await payloadFromForm(form);
      const editing = Boolean(state.editingId);
      const result = await api(editing ? "/api/admin/products/" + encodeURIComponent(state.editingId) : "/api/admin/products", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      const index = state.products.findIndex((product) => product.id === result.product.id);
      if (index >= 0) {
        state.products[index] = result.product;
      } else {
        state.products.unshift(result.product);
      }
      state.editingId = result.product.id;
      editProduct(result.product.id);
      renderStats();
      renderProducts();
      toast("Product saved. Public website updated.");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Save Product";
      }
    }
  }

  async function disableProduct(productId) {
    const product = state.products.find((item) => item.id === productId);
    if (!product) {
      return;
    }
    if (!window.confirm("Disable " + product.name + " on the public website?")) {
      return;
    }
    try {
      const result = await api("/api/admin/products/" + encodeURIComponent(productId), { method: "DELETE" });
      const index = state.products.findIndex((item) => item.id === productId);
      if (index >= 0) {
        state.products[index] = result.product;
      }
      if (state.editingId === productId) {
        editProduct(productId);
      }
      renderStats();
      renderProducts();
      toast("Product disabled.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function loadProducts() {
    const result = await api("/api/admin/products");
    state.products = result.products;
    renderStats();
    renderProducts();
  }

  function setupForm() {
    const form = qs("[data-product-form]");
    if (form) {
      form.addEventListener("submit", saveProduct);
      form.elements.imageFile.addEventListener("change", async () => {
        try {
          const file = form.elements.imageFile.files[0];
          if (file) {
            setPreview(await fileToDataUrl(file));
          } else {
            setPreview(form.elements.imageUrl.value);
          }
        } catch (error) {
          form.elements.imageFile.value = "";
          toast(error.message, "error");
        }
      });
      form.elements.imageUrl.addEventListener("input", () => {
        if (!form.elements.imageFile.files.length) {
          setPreview(form.elements.imageUrl.value);
        }
      });
    }
    const newButton = qs("[data-new-product]");
    const resetButton = qs("[data-reset-product]");
    const disableButton = qs("[data-disable-current]");
    if (newButton) {
      newButton.addEventListener("click", resetForm);
    }
    if (resetButton) {
      resetButton.addEventListener("click", resetForm);
    }
    if (disableButton) {
      disableButton.addEventListener("click", () => {
        if (state.editingId) {
          disableProduct(state.editingId);
        }
      });
    }
  }

  function setupSearch() {
    const search = qs("[data-product-search]");
    if (!search) {
      return;
    }
    search.addEventListener("input", () => {
      state.query = search.value;
      renderProducts();
    });
  }

  function setupTheme() {
    const saved = localStorage.getItem("kf_theme");
    if (saved) {
      document.body.dataset.theme = saved;
    }
    const button = qs("[data-theme-toggle]");
    if (!button) {
      return;
    }
    button.addEventListener("click", () => {
      const next = document.body.dataset.theme === "dark" ? "light" : "dark";
      document.body.dataset.theme = next;
      localStorage.setItem("kf_theme", next);
    });
  }

  function setupLogout() {
    const button = qs("[data-logout]");
    if (!button) {
      return;
    }
    button.addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST", body: "{}" });
      } finally {
        window.location.href = "/auth.html";
      }
    });
  }

  async function init() {
    setupTheme();
    setupLogout();
    setupForm();
    setupSearch();
    resetForm();
    try {
      const me = await api("/api/auth/me");
      if (!me.user) {
        window.location.href = "/auth.html?returnTo=" + encodeURIComponent("/owner-products.html");
        return;
      }
      if (me.user.role !== "admin") {
        window.location.replace("/customer-dashboard.html");
        return;
      }
      state.user = me.user;
      await loadProducts();
    } catch (error) {
      toast(error.message, "error");
      window.setTimeout(() => {
        window.location.href = "/auth.html?returnTo=" + encodeURIComponent("/owner-products.html");
      }, 800);
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", OwnerProductsApp.init);
