import { ProductPreview3D, photoRequirement, productKind } from "/preview-3d.js?v=20260527-preview";

const PreviewPage = (() => {
  const state = {
    product: null,
    preview: null,
    photos: {}
  };

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
    if (!stack) return;
    const item = document.createElement("div");
    item.className = "toast " + type;
    item.textContent = message;
    stack.appendChild(item);
    window.setTimeout(() => item.remove(), 3600);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function cssEscape(value) {
    return String(value).replace(/'/g, "\\'");
  }

  function selectedOptions(root, product) {
    const options = {};
    (product.options || []).forEach((group) => {
      const select = qs("select[name='" + cssEscape(group.name) + "']", root);
      const checked = qs("input[name='" + cssEscape(group.name) + "']:checked", root);
      options[group.name] = select ? select.value : (checked ? checked.value : group.choices[0].label);
    });
    return options;
  }

  function optionMarkup(product) {
    return (product.options || []).map((group) => `
      <label class="preview-select-row">
        <strong>${escapeHtml(group.name)}</strong>
        <select name="${escapeHtml(group.name)}" data-preview-option-select>
          ${(group.choices || []).map((choice) => `
            <option value="${escapeHtml(choice.label)}">${escapeHtml(choice.label)}</option>
          `).join("")}
        </select>
      </label>
    `).join("");
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(new Error("Could not read this photo.")));
      reader.readAsDataURL(file);
    });
  }

  async function handlePreviewUpload(input) {
    const index = Number(input.dataset.previewPhoto);
    const file = input.files && input.files[0];
    const slot = input.closest(".preview-upload-slot");
    const preview = qs("[data-preview-photo-thumb]", slot);
    delete state.photos[index];
    if (!file) {
      if (preview) {
        preview.hidden = true;
        preview.innerHTML = "";
      }
      await state.preview.setPhoto(index, "");
      return;
    }
    if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type)) {
      input.value = "";
      toast("Only PNG, JPG, JPEG, and WEBP images are allowed.", "error");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      input.value = "";
      toast("Photo is too large. Please choose an image under 12 MB.", "error");
      return;
    }
    if (preview) {
      preview.hidden = false;
      preview.innerHTML = "<small>Loading preview...</small>";
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      state.photos[index] = dataUrl;
      await state.preview.setPhoto(index, dataUrl);
      if (preview) {
        preview.hidden = false;
        preview.innerHTML = `<img src="${dataUrl}" alt="Uploaded preview ${index + 1}" />`;
      }
    } catch (error) {
      input.value = "";
      if (preview) {
        preview.hidden = true;
        preview.innerHTML = "";
      }
      toast(error.message, "error");
    }
  }

  function renderPhotoControls(root) {
    const holder = qs("[data-preview-photo-slots]", root);
    if (!holder) return;
    const options = selectedOptions(root, state.product);
    const requirement = photoRequirement(state.product, options);
    holder.innerHTML = requirement.labels.slice(0, requirement.max).map((label, index) => `
      <label class="preview-upload-slot">
        <span>${escapeHtml(label)}${index < requirement.min ? " *" : ""}</span>
        <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" data-preview-photo="${index}" />
        <div class="upload-preview mini-preview" data-preview-photo-thumb ${state.photos[index] ? "" : "hidden"}>
          ${state.photos[index] ? `<img src="${state.photos[index]}" alt="${escapeHtml(label)} preview" />` : ""}
        </div>
      </label>
    `).join("");
    qsa("[data-preview-photo]", holder).forEach((input) => {
      input.addEventListener("change", () => handlePreviewUpload(input));
    });
  }

  function comboPreviewItems(product) {
    if (product.category !== "combos") return [];
    const id = String(product.id || "");
    if (id.includes("hamper")) {
      return [
        ["mug", "Mug"],
        ["frame", "Frame"],
        ["pillow", "Pillow"],
        ["coaster", "Coaster"],
        ["card", "Card"]
      ];
    }
    return [
      ["mug", "Cup"],
      ["frame", "Frame"],
      ["pillow", "Pillow"]
    ];
  }

  function comboPreviewMarkup(product) {
    const items = comboPreviewItems(product);
    if (!items.length) return "";
    return `
      <div class="combo-scene-grid">
        ${items.map(([kind, label]) => `
          <article class="combo-scene-card">
            <span>${escapeHtml(label)}</span>
            <div class="combo-scene-canvas" data-combo-canvas="${kind}" data-combo-label="${escapeHtml(label)}"></div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function comboProduct(kind, label) {
    return {
      ...state.product,
      id: kind === "mug" ? "cup-photo-printing" : kind === "pillow" ? "pillow-printing" : kind === "coaster" ? "photo-coaster-set" : "preview-" + kind,
      category: kind === "mug" || kind === "coaster" ? "cups" : kind === "pillow" ? "pillows" : "frames",
      name: label,
      photoRequirements: {
        min: 1,
        max: kind === "coaster" ? 4 : 1,
        labels: kind === "coaster" ? ["Coaster 1", "Coaster 2", "Coaster 3", "Coaster 4"] : [label + " Photo"]
      }
    };
  }

  function renderProduct(root) {
    const product = state.product;
    const images = product.images && product.images.length ? product.images : ["/assets/products/generated/cup-photo-printing-ai.jpg"];
    const comboItems = comboPreviewItems(product);
    const isCombo = comboItems.length > 0;
    document.title = "3D Preview - " + product.name + " | Karimnagar Frames";
    root.innerHTML = `
      <section class="preview-page-shell">
        <div class="preview-stage-card">
          <div class="preview-stage-head">
            <div>
              <h1>${escapeHtml(product.name)}</h1>
            </div>
            <span>${escapeHtml(productKind(product).replace("-", " "))}</span>
          </div>
          ${isCombo ? comboPreviewMarkup(product) : `<div class="three-preview-stage" data-preview-canvas aria-label="Interactive 3D product preview"></div>`}
          <div class="preview-toolbar">
            <button class="btn btn-outline" type="button" data-preview-spin>Pause Rotate</button>
            <button class="btn btn-soft" type="button" data-preview-reset>Reset View</button>
          </div>
        </div>

        <aside class="preview-config-card">
          <img src="${images[0]}" alt="${escapeHtml(product.name)}" class="preview-product-thumb" />
          <section class="upload-panel">
            <div>
              <h3>Upload photos</h3>
            </div>
            <div class="preview-upload-grid" data-preview-photo-slots></div>
          </section>
          <div class="option-list">${optionMarkup(product)}</div>
          <div class="preview-action-row">
            <a class="btn" href="/product.html?id=${encodeURIComponent(product.id)}">Back to Product</a>
            <a class="btn btn-soft" href="/">Store</a>
          </div>
        </aside>
      </section>
    `;
    const options = selectedOptions(root, product);
    if (isCombo) {
      state.comboPreviews = qsa("[data-combo-canvas]", root).map((node) => new ProductPreview3D(node, {
        product: comboProduct(node.dataset.comboCanvas, node.dataset.comboLabel),
        options
      }));
      state.preview = {
        autoRotate: true,
        setOptions(nextOptions) {
          state.comboPreviews.forEach((preview) => preview.setOptions(nextOptions));
        },
        async setPhoto(index, dataUrl) {
          const preview = state.comboPreviews[index] || state.comboPreviews[0];
          if (preview) {
            await preview.setPhoto(0, dataUrl);
          }
        },
        reset() {
          state.comboPreviews.forEach((preview) => {
            preview.rotationTarget = 0;
            preview.group.rotation.set(0, 0, 0);
            preview.autoRotate = true;
          });
        },
        setAutoRotate(enabled) {
          state.comboPreviews.forEach((preview) => {
            preview.autoRotate = enabled;
          });
        }
      };
    } else {
      state.comboPreviews = [];
      state.preview = new ProductPreview3D(qs("[data-preview-canvas]", root), { product, options });
    }
    bindPage(root);
    renderPhotoControls(root);
  }

  function setupNavigation() {
    const toggle = qs("[data-nav-toggle]");
    const menu = qs("[data-nav-menu]");
    if (toggle && menu) {
      toggle.addEventListener("click", () => menu.classList.toggle("is-open"));
    }
  }

  function bindPage(root) {
    const updateTotalAndPreview = () => {
      const options = selectedOptions(root, state.product);
      state.preview.setOptions(options);
      renderPhotoControls(root);
    };
    qsa("[data-preview-option], [data-preview-option-select]", root).forEach((input) => input.addEventListener("change", updateTotalAndPreview));
    qs("[data-preview-spin]", root).addEventListener("click", (event) => {
      state.preview.autoRotate = !state.preview.autoRotate;
      if (state.preview.setAutoRotate) state.preview.setAutoRotate(state.preview.autoRotate);
      event.currentTarget.textContent = state.preview.autoRotate ? "Pause Rotate" : "Auto Rotate";
    });
    qs("[data-preview-reset]", root).addEventListener("click", () => {
      if (state.preview.reset) {
        state.preview.reset();
      } else {
        state.preview.rotationTarget = 0;
        state.preview.group.rotation.set(0, 0, 0);
      }
      state.preview.autoRotate = true;
      if (state.preview.setAutoRotate) state.preview.setAutoRotate(true);
      qs("[data-preview-spin]", root).textContent = "Pause Rotate";
    });
  }

  async function init() {
    setupNavigation();
    const root = qs("[data-preview-root]");
    const loader = qs("[data-product-loader]");
    const id = new URLSearchParams(window.location.search).get("id") || "cup-photo-printing";
    try {
      const productResult = await api("/api/products/" + encodeURIComponent(id));
      state.product = productResult.product;
      renderProduct(root);
      root.hidden = false;
      if (loader) loader.hidden = true;
    } catch (error) {
      if (loader) {
        loader.innerHTML = "<p>" + escapeHtml(error.message) + "</p><a class=\"btn\" href=\"/\">Back to store</a>";
      }
      toast(error.message, "error");
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", PreviewPage.init);
