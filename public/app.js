"use strict";

const StoreApp = (() => {
  const CART_KEY = "kf_cart_v2";
  const state = {
    products: [],
    filtered: [],
    category: "all",
    query: "",
    cart: [],
    upload: null,
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

  function loadCart() {
    try {
      state.cart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch (error) {
      state.cart = [];
    }
  }

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
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

  function cssEscape(value) {
    return String(value).replace(/'/g, "\\'");
  }

  function cartKey(item) {
    return item.productId + "::" + JSON.stringify(item.options || {});
  }

  function addToCart(product, options = {}, quantity = 1) {
    const unitPrice = productPrice(product, options);
    const next = {
      productId: product.id,
      name: product.name,
      image: product.images[0],
      options,
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
    saveCart();
    renderCart();
    toast(product.name + " added to cart.");
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
      button.addEventListener("click", () => addToCart(product, options, 1));
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
    qs("[data-modal-add]", content).addEventListener("click", () => {
      const options = selectedOptionsFrom(content, product);
      const quantity = Number(qs("[data-modal-quantity]", content).value) || 1;
      addToCart(product, options, quantity);
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
    if (!items || !empty || !total) {
      return;
    }
    items.innerHTML = "";
    state.cart.forEach((item, index) => {
      const line = document.createElement("article");
      line.className = "cart-line";
      const optionText = Object.entries(item.options || {}).map(([key, value]) => key + ": " + value).join(", ");
      line.innerHTML = `
        <div>
          <strong>${item.name}</strong>
          <small>${optionText || "Standard options"}</small>
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
      summary.innerHTML = state.cart.length ? state.cart.map((item) => `<p><strong>${item.name}</strong> x ${item.quantity} = ${money(lineTotal(item))}</p>`).join("") + `<strong>Total: ${money(cartTotal())}</strong>` : "<p>Your cart is empty.</p>";
    }

    qsa("[data-decrease]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = state.cart[Number(button.dataset.decrease)];
        item.quantity -= 1;
        if (item.quantity <= 0) {
          state.cart.splice(Number(button.dataset.decrease), 1);
        }
        saveCart();
        renderCart();
      });
    });
    qsa("[data-increase]").forEach((button) => {
      button.addEventListener("click", () => {
        state.cart[Number(button.dataset.increase)].quantity += 1;
        saveCart();
        renderCart();
      });
    });
    qsa("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        state.cart.splice(Number(button.dataset.remove), 1);
        saveCart();
        renderCart();
      });
    });
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
    const uploadInput = qs("[data-upload-input]");
    const uploadPreview = qs("[data-upload-preview]");
    const form = qs("[data-checkout-form]");

    if (checkoutButton && modal) {
      checkoutButton.addEventListener("click", () => {
        if (!state.cart.length) {
          toast("Please add at least one product first.", "error");
          return;
        }
        renderCart();
        modal.showModal();
      });
    }
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        state.cart = [];
        saveCart();
        renderCart();
        toast("Cart cleared.");
      });
    }
    if (uploadInput && uploadPreview) {
      uploadInput.addEventListener("change", () => {
        const file = uploadInput.files[0];
        state.upload = null;
        uploadPreview.hidden = true;
        uploadPreview.innerHTML = "";
        if (!file) {
          return;
        }
        if (file.size > 4 * 1024 * 1024) {
          toast("Image must be smaller than 4 MB.", "error");
          uploadInput.value = "";
          return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          state.upload = {
            name: file.name,
            dataUrl: reader.result
          };
          uploadPreview.hidden = false;
          uploadPreview.innerHTML = `<img src="${reader.result}" alt="Uploaded preview" />`;
        });
        reader.readAsDataURL(file);
      });
    }
    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
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
              options: item.options
            })),
            upload: state.upload,
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
          state.upload = null;
          saveCart();
          renderCart();
          form.reset();
          if (uploadPreview) {
            uploadPreview.hidden = true;
            uploadPreview.innerHTML = "";
          }
          modal.close();
          closeCart();
          toast("Order placed: " + result.order.id + ". Opening WhatsApp...");
          window.location.href = result.order.whatsappUrl;
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
    loadCart();
    setupNavigation();
    setupGallery();
    setupFilters();
    setupCheckout();
    setupContact();
    renderCart();

    try {
      const result = await api("/api/products");
      state.products = result.products;
      renderProducts();
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
