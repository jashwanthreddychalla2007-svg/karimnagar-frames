"use strict";

const StoreApp = (() => {
  const state = {
    user: null,
    products: [],
    filtered: [],
    category: "all",
    query: "",
    cart: [],
    uploads: {},
    galleryIndex: 0
  };

  const money = (value) => "Rs. " + (Number(value) || 0).toLocaleString("en-IN");
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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

  function setLoading(isLoading) {
    const loader = qs("[data-loader]");
    if (!loader) {
      return;
    }
    document.body.classList.toggle("is-loading", isLoading);
    loader.hidden = !isLoading;
  }

  function returnToLogin() {
    const returnTo = window.location.pathname + window.location.search + window.location.hash;
    window.location.href = "/auth.html?returnTo=" + encodeURIComponent(returnTo || "/");
  }

  function requireLogin(message = "Please login to continue ordering.") {
    if (state.user) {
      return true;
    }
    toast(message, "error");
    window.setTimeout(returnToLogin, 650);
    return false;
  }

  async function loadAccountAndCart() {
    const account = await api("/api/auth/me");
    state.user = account.user || null;
    if (!state.user) {
      state.cart = [];
      return;
    }
    const result = await api("/api/cart");
    state.cart = result.cart.items || [];
  }

  async function saveCart() {
    if (!state.user) {
      return;
    }
    const result = await api("/api/cart", {
      method: "PUT",
      body: JSON.stringify({ items: state.cart })
    });
    state.cart = result.cart.items || [];
  }

  function productPrice(product, options = {}) {
    return (product.options || []).reduce((sum, group) => {
      const selected = options[group.name];
      const choice = (group.choices || []).find((item) => item.label === selected);
      return sum + (choice ? Number(choice.price) || 0 : 0);
    }, Number(product.basePrice) || 0);
  }

  function lineTotal(item) {
    return item.unitPrice * item.quantity;
  }

  function cartTotal() {
    return state.cart.reduce((sum, item) => sum + lineTotal(item), 0);
  }

  function selectedOptionsFrom(root, product) {
    const selected = {};
    (product.options || []).forEach((group) => {
      const checked = qs("input[name='" + cssEscape(group.name) + "']:checked", root);
      selected[group.name] = checked ? checked.value : group.choices[0].label;
    });
    return selected;
  }

  function selectedCustomFieldsFrom(root, product) {
    const values = {};
    (product.customFields || []).forEach((field) => {
      const input = qs("[data-custom-field='" + cssEscape(field.id || field.label) + "']", root);
      const value = input ? input.value.trim() : "";
      if (field.required && !value) {
        throw new Error(field.label + " is required.");
      }
      if (value) {
        values[field.label] = value;
      }
    });
    return values;
  }

  function cssEscape(value) {
    return String(value).replace(/'/g, "\\'");
  }

  function cartKey(item) {
    return item.cartKey || (item.productId + "::" + JSON.stringify(item.options || {}) + "::" + JSON.stringify(item.customFields || {}));
  }

  function productById(productId) {
    return state.products.find((product) => product.id === productId);
  }

  function photoRequirement(product, options = {}) {
    const config = product && product.photoRequirements ? product.photoRequirements : {};
    let requirement = {
      min: Number(config.min) || 1,
      max: Number(config.max) || Math.max(1, Number(config.min) || 1),
      labels: Array.isArray(config.labels) && config.labels.length ? config.labels : ["Photo 1"]
    };
    (config.rules || []).forEach((rule) => {
      const when = rule.when || {};
      if (when.option && options[when.option] === when.value) {
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
    while (requirement.labels.length < requirement.max) {
      requirement.labels.push("Photo " + (requirement.labels.length + 1));
    }
    return requirement;
  }

  async function addToCart(product, options = {}, quantity = 1, customFields = {}) {
    if (!requireLogin("Please login before adding products to cart.")) {
      return;
    }
    const unitPrice = productPrice(product, options);
    const next = {
      productId: product.id,
      name: product.name,
      image: product.images[0],
      options,
      customFields,
      quantity: Math.max(1, Number(quantity) || 1),
      unitPrice
    };
    const key = cartKey(next);
    const existing = state.cart.find((item) => cartKey(item) === key);
    if (existing) {
      existing.quantity += next.quantity;
    } else {
      state.cart.push(next);
    }
    try {
      await saveCart();
      renderCart();
      toast(product.name + " added to cart.");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderProducts() {
    const grid = qs("[data-product-grid]");
    const empty = qs("[data-empty-state]");
    if (!grid) {
      return;
    }
    const query = state.query.toLowerCase();
    state.filtered = state.products.filter((product) => {
      const categoryMatch = state.category === "all" || product.category === state.category;
      const text = [product.name, product.summary, product.description, ...(product.tags || [])].join(" ").toLowerCase();
      return categoryMatch && (!query || text.includes(query));
    });

    grid.innerHTML = state.filtered.map((product) => `
      <article class="product-card">
        <img src="${product.images[0]}" alt="${product.name}" loading="lazy" />
        <div class="product-content">
          <span class="badge">${product.badge}</span>
          <h3>${product.name}</h3>
          <p>${product.summary}</p>
          <div class="product-meta">
            <strong>${money(product.basePrice)}</strong>
            <span>${product.rating} rating</span>
          </div>
          <div class="card-actions">
            <a class="btn" href="/product.html?id=${product.id}">View Details</a>
            <button class="btn btn-soft" type="button" data-product-detail="${product.id}">Customize</button>
            <button class="btn btn-outline" type="button" data-quick-add="${product.id}">Add</button>
          </div>
        </div>
      </article>
    `).join("");

    empty.hidden = state.filtered.length > 0;
    qsa("[data-product-detail]").forEach((button) => {
      button.addEventListener("click", () => openProduct(button.dataset.productDetail));
    });
    qsa("[data-quick-add]").forEach((button) => {
      const product = state.products.find((item) => item.id === button.dataset.quickAdd);
      const options = {};
      (product.options || []).forEach((group) => {
        options[group.name] = group.choices[0].label;
      });
      button.addEventListener("click", () => {
        if ((product.customFields || []).some((field) => field.required)) {
          openProduct(product.id);
          return;
        }
        addToCart(product, options, 1);
      });
    });
  }

  function optionMarkup(product) {
    return (product.options || []).map((group) => `
      <div class="option-group">
        <strong>${group.name}</strong>
        ${(group.choices || []).map((choice, index) => `
          <label>
            <input type="radio" name="${group.name}" value="${choice.label}" ${index === 0 ? "checked" : ""} data-option />
            <span>${choice.label}${choice.price ? " +" + money(choice.price) : " included"}</span>
          </label>
        `).join("")}
      </div>
    `).join("");
  }

  function customFieldsMarkup(product) {
    if (!product.customFields || !product.customFields.length) {
      return "";
    }
    return `
      <div class="custom-field-list">
        ${(product.customFields || []).map((field) => `
          <label>
            <strong>${field.label}${field.required ? " *" : ""}</strong>
            ${field.type === "textarea"
              ? `<textarea rows="3" data-custom-field="${field.id || field.label}" ${field.required ? "required" : ""}></textarea>`
              : `<input type="text" data-custom-field="${field.id || field.label}" ${field.required ? "required" : ""} />`}
          </label>
        `).join("")}
      </div>
    `;
  }

  function openProduct(productId) {
    const product = state.products.find((item) => item.id === productId);
    const modal = qs("[data-product-modal]");
    const content = qs("[data-product-modal-content]");
    if (!product || !modal || !content) {
      return;
    }
    content.innerHTML = `
      <div class="modal-product">
        <img src="${product.images[0]}" alt="${product.name}" />
        <div class="product-copy">
          <span class="badge">${product.badge}</span>
          <h2>${product.name}</h2>
          <p>${product.description}</p>
          <div class="chip-row">
            ${(product.tags || []).map((tag) => `<span class="detail-chip">${tag}</span>`).join("")}
          </div>
          <div class="option-list">${optionMarkup(product)}</div>
          ${customFieldsMarkup(product)}
          <label>
            <strong>Quantity</strong>
            <input type="number" min="1" max="50" value="1" data-modal-quantity />
          </label>
          <div class="drawer-total">
            <span>Estimated total</span>
            <strong data-modal-total>${money(product.basePrice)}</strong>
          </div>
          <button class="btn" type="button" data-modal-add>Add to Cart</button>
        </div>
      </div>
    `;

    const updateTotal = () => {
      const options = selectedOptionsFrom(content, product);
      const quantity = Number(qs("[data-modal-quantity]", content).value) || 1;
      qs("[data-modal-total]", content).textContent = money(productPrice(product, options) * quantity);
    };

    qsa("[data-option]", content).forEach((option) => option.addEventListener("change", updateTotal));
    qs("[data-modal-quantity]", content).addEventListener("input", updateTotal);
    qs("[data-modal-add]", content).addEventListener("click", async () => {
      let options;
      let customFields;
      try {
        options = selectedOptionsFrom(content, product);
        customFields = selectedCustomFieldsFrom(content, product);
      } catch (error) {
        toast(error.message, "error");
        return;
      }
      const quantity = Number(qs("[data-modal-quantity]", content).value) || 1;
      await addToCart(product, options, quantity, customFields);
      if (!state.user) {
        return;
      }
      modal.close();
      openCart();
    });
    updateTotal();
    modal.showModal();
  }

  function renderCart() {
    const items = qs("[data-cart-items]");
    const empty = qs("[data-cart-empty]");
    const total = qs("[data-cart-total]");
    const summary = qs("[data-checkout-summary]");
    qsa("[data-cart-count]").forEach((node) => {
      node.textContent = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    });
    const validUploadPrefixes = state.cart.map((item) => cartKey(item) + "::");
    Object.keys(state.uploads).forEach((key) => {
      if (!validUploadPrefixes.some((prefix) => key.startsWith(prefix))) {
        delete state.uploads[key];
      }
    });
    if (!items || !empty || !total) {
      return;
    }
    items.innerHTML = "";
    state.cart.forEach((item, index) => {
      const line = document.createElement("article");
      line.className = "cart-line";
      const optionText = Object.entries(item.options || {}).map(([key, value]) => key + ": " + value).join(", ");
      const customText = Object.entries(item.customFields || {}).map(([key, value]) => key + ": " + value).join(", ");
      line.innerHTML = `
        <div>
          <strong>${item.name}</strong>
          <small>${optionText || "Standard options"}</small>
          ${customText ? `<small>${customText}</small>` : ""}
          <small>${money(item.unitPrice)} each</small>
        </div>
        <div>
          <div class="quantity-row">
            <button type="button" data-decrease="${index}">-</button>
            <span>${item.quantity}</span>
            <button type="button" data-increase="${index}">+</button>
          </div>
          <button class="remove-btn" type="button" data-remove="${index}">Remove</button>
        </div>
      `;
      items.appendChild(line);
    });
    empty.hidden = state.cart.length > 0;
    total.textContent = money(cartTotal());
    if (summary) {
      summary.innerHTML = state.cart.length ? state.cart.map((item) => {
        const customText = Object.entries(item.customFields || {}).map(([key, value]) => key + ": " + value).join(", ");
        return `<p><strong>${item.name}</strong> x ${item.quantity} = ${money(lineTotal(item))}${customText ? `<br><small>${customText}</small>` : ""}</p>`;
      }).join("") + `<strong>Total: ${money(cartTotal())}</strong>` : "<p>Your cart is empty.</p>";
    }
    renderUploadSlots();

    qsa("[data-decrease]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = state.cart[Number(button.dataset.decrease)];
        item.quantity -= 1;
        if (item.quantity <= 0) {
          state.cart.splice(Number(button.dataset.decrease), 1);
        }
        await saveCart();
        renderCart();
      });
    });
    qsa("[data-increase]").forEach((button) => {
      button.addEventListener("click", async () => {
        state.cart[Number(button.dataset.increase)].quantity += 1;
        await saveCart();
        renderCart();
      });
    });
    qsa("[data-remove]").forEach((button) => {
      button.addEventListener("click", async () => {
        state.cart.splice(Number(button.dataset.remove), 1);
        await saveCart();
        renderCart();
      });
    });
  }

  function renderUploadSlots() {
    const root = qs("[data-upload-slots]");
    if (!root) {
      return;
    }
    if (!state.cart.length) {
      root.innerHTML = "<p>Add products to see required photo uploads.</p>";
      return;
    }
    root.innerHTML = state.cart.map((item) => {
      const product = productById(item.productId) || item;
      const requirement = photoRequirement(product, item.options);
      const key = cartKey(item);
      return `
        <article class="upload-group">
          <div>
            <strong>${item.name}</strong>
            <small>${requirement.min} required, up to ${requirement.max} photo${requirement.max === 1 ? "" : "s"}</small>
          </div>
          <div class="upload-grid">
            ${requirement.labels.slice(0, requirement.max).map((label, index) => {
              const slotKey = key + "::" + index;
              const saved = state.uploads[slotKey];
              const required = index < requirement.min;
              return `
                <label class="upload-box">
                  <span>${label}${required ? " *" : ""}</span>
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" data-upload-slot="${slotKey}" data-upload-label="${label}" data-upload-item="${key}" data-upload-product="${item.productId}" ${required ? "required" : ""} />
                  <small>PNG, JPG, JPEG, or WEBP under 4 MB</small>
                  <div class="upload-preview mini-preview" data-upload-preview="${slotKey}" ${saved ? "" : "hidden"}>
                    ${saved ? `<img src="${saved.dataUrl}" alt="${label} preview" />` : ""}
                  </div>
                </label>
              `;
            }).join("")}
          </div>
        </article>
      `;
    }).join("");
    qsa("[data-upload-slot]", root).forEach((input) => {
      input.addEventListener("change", () => handleUploadSlot(input));
    });
  }

  function handleUploadSlot(input) {
    const file = input.files[0];
    const preview = qs("[data-upload-preview='" + cssEscape(input.dataset.uploadSlot) + "']");
    delete state.uploads[input.dataset.uploadSlot];
    if (preview) {
      preview.hidden = true;
      preview.innerHTML = "";
    }
    if (!file) {
      return;
    }
    if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type)) {
      toast("Only PNG, JPG, JPEG, and WEBP images are allowed.", "error");
      input.value = "";
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast("Each image must be smaller than 4 MB.", "error");
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      state.uploads[input.dataset.uploadSlot] = {
        name: file.name,
        dataUrl: reader.result,
        label: input.dataset.uploadLabel,
        itemKey: input.dataset.uploadItem,
        productId: input.dataset.uploadProduct
      };
      if (preview) {
        preview.hidden = false;
        preview.innerHTML = `<img src="${reader.result}" alt="${input.dataset.uploadLabel} preview" />`;
      }
    });
    reader.readAsDataURL(file);
  }

  function collectUploads() {
    return Object.values(state.uploads).filter((upload) => upload && upload.dataUrl);
  }

  function openCart() {
    const drawer = qs("[data-cart-drawer]");
    if (drawer) {
      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
    }
  }

  function closeCart() {
    const drawer = qs("[data-cart-drawer]");
    if (drawer) {
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
    }
  }

  function setupNavigation() {
    const toggle = qs("[data-nav-toggle]");
    const menu = qs("[data-nav-menu]");
    if (toggle && menu) {
      toggle.addEventListener("click", () => menu.classList.toggle("is-open"));
    }
    qsa("[data-open-cart]").forEach((button) => button.addEventListener("click", openCart));
    qsa("[data-close-cart]").forEach((button) => button.addEventListener("click", closeCart));
    const closeProduct = qs("[data-close-product]");
    if (closeProduct) {
      closeProduct.addEventListener("click", () => qs("[data-product-modal]").close());
    }
    const closeCheckout = qs("[data-close-checkout]");
    if (closeCheckout) {
      closeCheckout.addEventListener("click", () => qs("[data-checkout-modal]").close());
    }
  }

  function setupGallery() {
    const frames = qsa(".gallery-frame");
    const dots = qsa("[data-gallery-dot]");
    if (!frames.length) {
      return;
    }
    const show = (index) => {
      state.galleryIndex = index;
      frames.forEach((frame, frameIndex) => frame.classList.toggle("is-active", frameIndex === index));
      dots.forEach((dot, dotIndex) => dot.classList.toggle("is-active", dotIndex === index));
    };
    dots.forEach((dot) => {
      dot.addEventListener("click", () => show(Number(dot.dataset.galleryDot)));
    });
    window.setInterval(() => show((state.galleryIndex + 1) % frames.length), 4500);
  }

  function setupFilters() {
    const search = qs("[data-search]");
    if (search) {
      search.addEventListener("input", () => {
        state.query = search.value.trim();
        renderProducts();
      });
    }
    qsa("[data-category]").forEach((button) => {
      button.addEventListener("click", () => {
        state.category = button.dataset.category;
        qsa("[data-category]").forEach((item) => item.classList.toggle("is-active", item === button));
        renderProducts();
      });
    });
  }

  function setupCheckout() {
    const modal = qs("[data-checkout-modal]");
    const checkoutButton = qs("[data-checkout]");
    const clearButton = qs("[data-clear-cart]");
    const form = qs("[data-checkout-form]");

    if (checkoutButton && modal) {
      checkoutButton.addEventListener("click", () => {
        if (!requireLogin("Please login before checkout.")) {
          return;
        }
        if (!state.cart.length) {
          toast("Please add at least one product first.", "error");
          return;
        }
        if (form && state.user) {
          form.elements.name.value = state.user.name || "";
          form.elements.phone.value = state.user.phone || "";
          form.elements.email.value = state.user.email || "";
          form.elements.address.value = state.user.address || "";
        }
        renderCart();
        modal.showModal();
      });
    }
    if (clearButton) {
      clearButton.addEventListener("click", async () => {
        state.cart = [];
        state.uploads = {};
        await saveCart();
        renderCart();
        toast("Cart cleared.");
      });
    }
    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!requireLogin("Please login before placing an order.")) {
          return;
        }
        if (!form.reportValidity()) {
          return;
        }
        try {
          const formData = new FormData(form);
          const payload = {
            customer: {
              name: formData.get("name"),
              phone: formData.get("phone"),
              email: formData.get("email"),
              address: formData.get("address")
            },
            notes: formData.get("notes"),
            items: state.cart.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              options: item.options,
              customFields: item.customFields,
              cartKey: cartKey(item)
            })),
            uploads: collectUploads(),
            payment: {
              method: formData.get("paymentMethod"),
              reference: formData.get("paymentReference")
            }
          };
          const result = await api("/api/orders", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          state.cart = [];
          state.uploads = {};
          await saveCart();
          renderCart();
          form.reset();
          modal.close();
          closeCart();
          toast("Order placed: " + result.order.id + ".");
          window.location.href = "/confirmation.html?order=" + encodeURIComponent(result.order.id);
        } catch (error) {
          toast(error.message, "error");
        }
      });
    }
  }

  function setupContact() {
    const form = qs("[data-contact-form]");
    if (!form) {
      return;
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const formData = new FormData(form);
        await api("/api/contact", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(formData.entries()))
        });
        form.reset();
        toast("Message sent. We will contact you soon.");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  function openCompatibilityProduct() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("product");
    const map = {
      "cup": "cup-photo-printing",
      "cup.html": "cup-photo-printing",
      "re1": "love-story-frame",
      "re1.html": "love-story-frame",
      "pillow": "pillow-printing",
      "pillow.html": "pillow-printing"
    };
    if (slug && map[slug]) {
      window.setTimeout(() => openProduct(map[slug]), 500);
    }
  }

  async function init() {
    setLoading(true);
    setupNavigation();
    setupGallery();
    setupFilters();
    setupCheckout();
    setupContact();

    try {
      const [accountResult, productResult] = await Promise.all([
        loadAccountAndCart().catch(() => null),
        api("/api/products")
      ]);
      void accountResult;
      const result = productResult;
      state.products = result.products;
      renderProducts();
      renderCart();
      openCompatibilityProduct();
      if (new URLSearchParams(window.location.search).get("cart") === "open") {
        openCart();
      }
    } catch (error) {
      toast(error.message, "error");
    } finally {
      const skeleton = qs("[data-skeleton]");
      if (skeleton) {
        skeleton.hidden = true;
        skeleton.style.display = "none";
      }
      window.setTimeout(() => setLoading(false), 250);
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", StoreApp.init);
