"use strict";

const ProductPage = (() => {
  const state = {
    user: null,
    product: null,
    products: [],
    imageIndex: 0,
    cart: []
  };

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = (value) => "Rs. " + (Number(value) || 0).toLocaleString("en-IN");

  const categorySpecs = {
    cups: {
      "Material": "Ceramic",
      "Capacity": "Approx. 325 ml",
      "Print options": "One side, two side, or wraparound",
      "Care": "Wash gently for longer print life",
      "Best for": "Birthdays, office gifts, brands, couples"
    },
    frames: {
      "Material": "Printed photo sheet with framed finish",
      "Sizes": "A4, 12x18, 16x20, and collage options",
      "Finish": "Matte, glossy, or premium glass look",
      "Preview": "Layout preview before printing",
      "Best for": "Anniversaries, weddings, family decor"
    },
    pillows: {
      "Material": "Soft cushion fabric",
      "Sizes": "12x12, 16x16, and 18x18 inches",
      "Print options": "One side or both sides",
      "Care": "Gentle hand wash recommended",
      "Best for": "Home decor, kids, couples, families"
    },
    combos: {
      "Included": "Custom mix of frame, cup, pillow, and message card",
      "Packaging": "Ready-to-gift bundle",
      "Preview": "All designs confirmed before printing",
      "Bulk support": "Available for events and teams",
      "Best for": "Birthdays, farewells, anniversaries"
    }
  };

  const commonFaqs = [
    ["How do I customize this product?", "Choose options, quantity, and add it to cart. During checkout, add names, dates, quotes, design instructions, and upload a preview photo."],
    ["Can I upload more than one photo?", "You can upload one preview image during checkout and send extra photos directly on WhatsApp after placing the order."],
    ["Will I get a design preview?", "Yes. A preview can be confirmed before final printing for personalized orders."],
    ["Do you support bulk orders?", "Yes. Bulk orders for offices, schools, events, and gifting can be discussed through WhatsApp."],
    ["What is the return policy?", "Damaged or mismatched products can be reported within 3 days of delivery."]
  ];

  const reviews = [
    { name: "Ranjana A.", rating: 5, title: "Loved it", body: "Fast delivery and great workmanship. The print looked clean." },
    { name: "Amita D.", rating: 5, title: "Never fails", body: "I love the quality and the preview support before printing." },
    { name: "Sunil C.", rating: 5, title: "Very nice service", body: "The custom gift came as expected and looked premium." },
    { name: "Sneha K.", rating: 5, title: "Superfast delivery", body: "Very nice quality, came as expected with quick delivery." }
  ];

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

  function returnToLogin() {
    const returnTo = window.location.pathname + window.location.search + window.location.hash;
    window.location.href = "/auth.html?returnTo=" + encodeURIComponent(returnTo || "/");
  }

  function requireLogin() {
    if (state.user) {
      return true;
    }
    toast("Please login before adding products to cart.", "error");
    window.setTimeout(returnToLogin, 650);
    return false;
  }

  async function loadAccountAndCart() {
    const account = await api("/api/auth/me");
    state.user = account.user || null;
    if (!state.user) {
      state.cart = [];
      updateCartCount();
      return;
    }
    const result = await api("/api/cart");
    state.cart = result.cart.items || [];
    updateCartCount();
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
    updateCartCount();
  }

  function updateCartCount() {
    const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    const node = qs("[data-cart-count]");
    if (node) {
      node.textContent = count;
    }
  }

  function productPrice(product, options = {}) {
    return (product.options || []).reduce((sum, group) => {
      const selected = options[group.name];
      const choice = (group.choices || []).find((item) => item.label === selected);
      return sum + (choice ? Number(choice.price) || 0 : 0);
    }, Number(product.basePrice) || 0);
  }

  function selectedOptions(root, product) {
    const options = {};
    (product.options || []).forEach((group) => {
      const checked = qs("input[name='" + cssEscape(group.name) + "']:checked", root);
      options[group.name] = checked ? checked.value : group.choices[0].label;
    });
    return options;
  }

  function cssEscape(value) {
    return String(value).replace(/'/g, "\\'");
  }

  function optionMarkup(product) {
    return (product.options || []).map((group) => `
      <div class="pdp-option-group">
        <strong>${group.name}</strong>
        <div class="pdp-options">
          ${(group.choices || []).map((choice, index) => `
            <label>
              <input type="radio" name="${group.name}" value="${choice.label}" ${index === 0 ? "checked" : ""} data-pdp-option />
              <span>${choice.label}</span>
              <small>${choice.price ? "+" + money(choice.price) : "Included"}</small>
            </label>
          `).join("")}
        </div>
      </div>
    `).join("");
  }

  function specsMarkup(product) {
    const specs = categorySpecs[product.category] || {};
    return Object.entries(specs).map(([label, value]) => `
      <tr>
        <th>${label}</th>
        <td>${value}</td>
      </tr>
    `).join("");
  }

  function faqMarkup() {
    return commonFaqs.map(([question, answer], index) => `
      <details ${index === 0 ? "open" : ""}>
        <summary>${question}</summary>
        <p>${answer}</p>
      </details>
    `).join("");
  }

  function reviewMarkup() {
    const bars = [
      ["5 Stars", 78],
      ["4 Stars", 15],
      ["3 Stars", 4],
      ["2 Stars", 0],
      ["1 Star", 3]
    ];
    return `
      <div class="rating-summary">
        <div>
          <strong>4.8</strong>
          <span>Average rating</span>
        </div>
        <div class="rating-bars">
          ${bars.map(([label, width]) => `
            <span>${label}</span>
            <div><i style="width: ${width}%"></i></div>
          `).join("")}
        </div>
      </div>
      <div class="review-grid">
        ${reviews.map((review) => `
          <article>
            <strong>${review.title}</strong>
            <p>${"Star ".repeat(review.rating).trim()}</p>
            <p>${review.body}</p>
            <span>${review.name}</span>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderProduct() {
    const root = qs("[data-product-root]");
    const loader = qs("[data-product-loader]");
    const product = state.product;
    if (!root || !product) {
      return;
    }
    document.title = product.name + " | Karimnagar Frames";
    const images = product.images && product.images.length ? product.images : [""];
    root.innerHTML = `
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span>/</span>
        <a href="/#products">${product.category}</a>
        <span>/</span>
        <strong>${product.name}</strong>
      </nav>

      <section class="pdp-hero">
        <div class="pdp-gallery">
          <div class="pdp-main-image">
            <img src="${images[0]}" alt="${product.name}" data-main-product-image />
          </div>
          <div class="pdp-thumbs">
            ${images.map((image, index) => `
              <button class="${index === 0 ? "is-active" : ""}" type="button" data-thumb="${index}">
                <img src="${image}" alt="${product.name} preview ${index + 1}" />
              </button>
            `).join("")}
          </div>
        </div>

        <aside class="pdp-config">
          <p class="eyebrow">${product.badge}</p>
          <h1>${product.name}</h1>
          <p>${product.description}</p>
          <div class="pdp-rating">
            <strong>${product.rating} / 5</strong>
            <span>Verified customer feedback</span>
          </div>
          <div class="pdp-price">
            <span>Starting at</span>
            <strong>${money(product.basePrice)}</strong>
            <small>Final total updates as you choose options.</small>
          </div>
          <div class="option-list">${optionMarkup(product)}</div>
          <label class="pdp-quantity">
            <strong>Quantity</strong>
            <input type="number" min="1" max="50" value="1" data-pdp-quantity />
          </label>
          <div class="drawer-total">
            <span>Estimated total</span>
            <strong data-pdp-total>${money(product.basePrice)}</strong>
          </div>
          <button class="btn" type="button" data-add-detail>Add to Cart</button>
          <a class="btn btn-outline" href="/?cart=open">Checkout Cart</a>
          <a class="btn btn-soft" href="https://wa.me/9032428063?text=${encodeURIComponent("I want to customize " + product.name)}" target="_blank" rel="noopener">Ask on WhatsApp</a>
        </aside>
      </section>

      <section class="pdp-callouts">
        <article>
          <strong>Preview before print</strong>
          <span>Confirm layout on WhatsApp before final production.</span>
        </article>
        <article>
          <strong>Bulk order support</strong>
          <span>Special pricing available for events, teams, and offices.</span>
        </article>
        <article>
          <strong>${product.turnaround}</strong>
          <span>Fast customization workflow for local gifting needs.</span>
        </article>
      </section>

      <section class="pdp-section">
        <div class="section-heading align-left">
          <p class="eyebrow">Product details</p>
          <h2>Everything you need to know</h2>
        </div>
        <div class="pdp-info-grid">
          <article class="pdp-info-card">
            <h3>Highlights</h3>
            <ul class="check-list">
              ${(product.features || []).map((feature) => `<li>${feature}</li>`).join("")}
            </ul>
          </article>
          <article class="pdp-info-card">
            <h3>Specifications</h3>
            <table class="spec-table">
              <tbody>${specsMarkup(product)}</tbody>
            </table>
          </article>
        </div>
      </section>

      <section class="pdp-section">
        <div class="section-heading align-left">
          <p class="eyebrow">Ratings and reviews</p>
          <h2>Real customer confidence</h2>
        </div>
        ${reviewMarkup()}
      </section>

      <section class="pdp-section">
        <div class="section-heading align-left">
          <p class="eyebrow">FAQ</p>
          <h2>Before you customize</h2>
        </div>
        <div class="faq-list">${faqMarkup()}</div>
      </section>
    `;
    root.hidden = false;
    if (loader) {
      loader.hidden = true;
    }
    bindProductEvents(root);
  }

  function bindProductEvents(root) {
    qsa("[data-thumb]", root).forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.thumb);
        const image = state.product.images[index];
        qs("[data-main-product-image]", root).src = image;
        qsa("[data-thumb]", root).forEach((item) => item.classList.toggle("is-active", item === button));
      });
    });

    const updateTotal = () => {
      const options = selectedOptions(root, state.product);
      const quantity = Number(qs("[data-pdp-quantity]", root).value) || 1;
      qs("[data-pdp-total]", root).textContent = money(productPrice(state.product, options) * quantity);
    };

    qsa("[data-pdp-option]", root).forEach((input) => input.addEventListener("change", updateTotal));
    qs("[data-pdp-quantity]", root).addEventListener("input", updateTotal);
    qs("[data-add-detail]", root).addEventListener("click", () => {
      if (!requireLogin()) {
        return;
      }
      const options = selectedOptions(root, state.product);
      const quantity = Math.max(1, Number(qs("[data-pdp-quantity]", root).value) || 1);
      const item = {
        productId: state.product.id,
        name: state.product.name,
        image: state.product.images[0],
        options,
        quantity,
        unitPrice: productPrice(state.product, options)
      };
      const key = item.productId + "::" + JSON.stringify(item.options || {});
      const existing = state.cart.find((entry) => entry.productId + "::" + JSON.stringify(entry.options || {}) === key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        state.cart.push(item);
      }
      saveCart()
        .then(() => toast(state.product.name + " added to cart."))
        .catch((error) => toast(error.message, "error"));
    });
    updateTotal();
  }

  function renderRelated() {
    const grid = qs("[data-related-grid]");
    if (!grid) {
      return;
    }
    const related = state.products.filter((product) => product.id !== state.product.id).slice(0, 3);
    grid.innerHTML = related.map((product) => `
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
          <a class="btn" href="/product.html?id=${product.id}">View Details</a>
        </div>
      </article>
    `).join("");
  }

  function setupNavigation() {
    const toggle = qs("[data-nav-toggle]");
    const menu = qs("[data-nav-menu]");
    if (toggle && menu) {
      toggle.addEventListener("click", () => menu.classList.toggle("is-open"));
    }
  }

  async function init() {
    setupNavigation();
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || "cup-photo-printing";
    try {
      const [accountResult, productResult, productsResult] = await Promise.all([
        loadAccountAndCart().catch(() => null),
        api("/api/products/" + encodeURIComponent(id)),
        api("/api/products")
      ]);
      void accountResult;
      state.product = productResult.product;
      state.products = productsResult.products;
      renderProduct();
      renderRelated();
    } catch (error) {
      const loader = qs("[data-product-loader]");
      if (loader) {
        loader.innerHTML = "<p>" + error.message + "</p><a class=\"btn\" href=\"/\">Back to store</a>";
      }
      toast(error.message, "error");
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", ProductPage.init);
