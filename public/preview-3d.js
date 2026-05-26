import * as THREE from "/vendor-three.module.min.js";

const PHOTO_COLORS = ["#ff5f57", "#0f9b8e", "#4057c8", "#ffd166", "#20a36b", "#9b5de5"];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function productKind(product = {}) {
  const id = String(product.id || "").toLowerCase();
  const category = String(product.category || "").toLowerCase();
  if (id.includes("coaster")) return "coaster";
  if (id.includes("combo") || id.includes("hamper") || category === "combos") return "combo";
  if (id.includes("pillow") || category === "pillows") return "pillow";
  if (id.includes("mug") || id.includes("cup") || category === "cups") return "mug";
  if (id.includes("mini")) return "mini-frame";
  return "frame";
}

function photoRequirement(product = {}, options = {}) {
  const config = product.photoRequirements || {};
  let requirement = {
    min: Number(config.min) || 1,
    max: Number(config.max) || Math.max(1, Number(config.min) || 1),
    labels: Array.isArray(config.labels) && config.labels.length ? [...config.labels] : ["Photo 1"]
  };
  (config.rules || []).forEach((rule) => {
    const when = rule.when || {};
    if (!when.option) return;
    const selected = String(options[when.option] || "").toLowerCase();
    const expected = String(when.value || "").toLowerCase();
    if (selected && expected && (selected.includes(expected) || expected.includes(selected))) {
      requirement = {
        min: Number(rule.min) || requirement.min,
        max: Number(rule.max) || requirement.max,
        labels: Array.isArray(rule.labels) && rule.labels.length ? [...rule.labels] : requirement.labels
      };
    }
  });
  if (requirement.max < requirement.min) requirement.max = requirement.min;
  while (requirement.labels.length < requirement.max) {
    requirement.labels.push("Photo " + (requirement.labels.length + 1));
  }
  return requirement;
}

function makeTextTexture(label, colorIndex = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  const color = PHOTO_COLORS[colorIndex % PHOTO_COLORS.length];
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#fff4dd");
  gradient.addColorStop(0.48, "#ffffff");
  gradient.addColorStop(1, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(23, 32, 42, 0.16)";
  ctx.lineWidth = 18;
  ctx.strokeRect(42, 42, canvas.width - 84, canvas.height - 84);
  ctx.fillStyle = "#17202a";
  ctx.font = "800 76px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = String(label || "Upload Photo").split(/\s+/);
  const lines = [];
  while (words.length) {
    lines.push(words.splice(0, 2).join(" "));
  }
  const start = canvas.height / 2 - ((lines.length - 1) * 48);
  lines.forEach((line, index) => ctx.fillText(line, canvas.width / 2, start + index * 96));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeImageTexture(dataUrl) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(dataUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      resolve(texture);
    }, undefined, reject);
  });
}

function imageMaterial(texture, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: options.roughness ?? 0.38,
    metalness: options.metalness ?? 0.02,
    map: texture,
    side: options.side || THREE.DoubleSide
  });
}

function mat(color, roughness = 0.45, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addRoundedFrame(group, width, height, depth, borderColor = 0x17202a) {
  const border = mat(borderColor, 0.35, 0.04);
  const barDepth = depth;
  const thick = 0.15;
  const top = new THREE.Mesh(new THREE.BoxGeometry(width + thick * 2, thick, barDepth), border);
  const bottom = top.clone();
  const left = new THREE.Mesh(new THREE.BoxGeometry(thick, height, barDepth), border);
  const right = left.clone();
  top.position.set(0, height / 2 + thick / 2, 0);
  bottom.position.set(0, -height / 2 - thick / 2, 0);
  left.position.set(-width / 2 - thick / 2, 0, 0);
  right.position.set(width / 2 + thick / 2, 0, 0);
  group.add(top, bottom, left, right);
}

function createCushionGeometry(width = 2.5, height = 1.75, depth = 0.42) {
  const geometry = new THREE.BoxGeometry(width, height, depth, 56, 42, 8);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const edge = Math.max(Math.abs(x) / (width / 2), Math.abs(y) / (height / 2));
    const nx = Math.abs(x) / (width / 2);
    const ny = Math.abs(y) / (height / 2);
    const sidePinch = Math.pow(clamp(edge, 0, 1), 2) * 0.2;
    const centerBulge = Math.pow(1 - clamp(edge, 0, 1), 1.35) * 0.2;
    const cornerTuck = Math.max(nx + ny - 1.3, 0) * 0.2;
    position.setX(i, x * (1 - sidePinch * 0.1 - cornerTuck * 0.035));
    position.setY(i, y * (1 - sidePinch * 0.09 - cornerTuck * 0.045));
    position.setZ(i, z + Math.sign(z || 1) * (centerBulge - cornerTuck));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createPillowPrintGeometry(width = 2.36, height = 1.68, z = 0.31) {
  const geometry = new THREE.PlaneGeometry(width, height, 56, 42);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const nx = Math.abs(x) / (width / 2);
    const ny = Math.abs(y) / (height / 2);
    const edge = clamp(Math.max(nx, ny), 0, 1);
    const corner = clamp(nx + ny - 1.24, 0, 1);
    const softEdge = Math.pow(edge, 2.2);
    position.setX(i, x * (1 - corner * 0.06));
    position.setY(i, y * (1 - corner * 0.075));
    position.setZ(i, z + (1 - softEdge) * 0.13 - corner * 0.045);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createPillowSeam(width, height, z, material) {
  const group = new THREE.Group();
  const seamMat = material || new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.88 });
  const points = [
    [0, height / 2, width / 2, height / 2],
    [0, -height / 2, width / 2, -height / 2],
    [-width / 2, 0, -width / 2, height / 2],
    [width / 2, 0, width / 2, height / 2]
  ];
  points.forEach(([x1, y1, x2, y2]) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const seam = new THREE.Mesh(new THREE.BoxGeometry(length, 0.018, 0.018), seamMat);
    seam.position.set((x1 + x2) / 2, (y1 + y2) / 2, z);
    seam.rotation.z = Math.atan2(dy, dx);
    group.add(seam);
  });
  return group;
}

function createCurvedPrintGeometry(radius, height, arc, centerAngle = 0, cols = 72, rows = 10) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let y = 0; y <= rows; y += 1) {
    const v = y / rows;
    const py = height / 2 - v * height;
    for (let x = 0; x <= cols; x += 1) {
      const u = x / cols;
      const theta = centerAngle - arc / 2 + u * arc;
      positions.push(Math.sin(theta) * radius, py, Math.cos(theta) * radius);
      uvs.push(u, 1 - v);
    }
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const a = y * (cols + 1) + x;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createMugHandle(material) {
  const handle = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.82, 0.56, 0),
    new THREE.Vector3(1.2, 0.56, 0),
    new THREE.Vector3(1.46, 0.26, 0),
    new THREE.Vector3(1.46, -0.26, 0),
    new THREE.Vector3(1.2, -0.56, 0),
    new THREE.Vector3(0.82, -0.56, 0)
  ]);
  handle.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 0.07, 20, false), material));
  [
    [0.86, 0.56, 0],
    [0.86, -0.56, 0]
  ].forEach(([x, y, z]) => {
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.13, 32), material);
    socket.rotation.z = Math.PI / 2;
    socket.position.set(x, y, z);
    handle.add(socket);
  });
  return handle;
}

export class ProductPreview3D {
  constructor(container, config = {}) {
    this.container = container;
    this.product = config.product || {};
    this.options = config.options || {};
    this.photos = [];
    this.textures = [];
    this.dragging = false;
    this.rotationTarget = 0;
    this.rotateSpeed = 0.005;
    this.autoRotate = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xfffdf8);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 0.72, 5.8);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.setSize(1, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.innerHTML = "";
    this.container.appendChild(this.renderer.domElement);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.addLights();
    this.addFloor();
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.rebuild();
    this.animate();
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xf2e5cf, 1.45));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3.5, 5.2, 4.6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffd166, 0.9);
    fill.position.set(-3, 1.6, 3);
    this.scene.add(fill);
  }

  addFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.9, 72),
      new THREE.MeshStandardMaterial({ color: 0xfff4dd, roughness: 0.92 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.42;
    this.scene.add(floor);
  }

  addTurntable(y = -1.04, radius = 1.85) {
    const base = new THREE.Group();
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.92, 0.16, 96),
      new THREE.MeshStandardMaterial({ color: 0xf5ead6, roughness: 0.55, metalness: 0.02 })
    );
    platform.position.y = y;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.035, 14, 96),
      new THREE.MeshStandardMaterial({ color: 0xd9c7a7, roughness: 0.42, metalness: 0.02 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y + 0.085;
    base.add(platform, rim);
    this.group.add(base);
  }

  bindEvents() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.autoRotate = false;
      this.lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastX;
      this.lastX = event.clientX;
      this.rotationTarget += dx * 0.01;
    });
    const stop = () => {
      this.dragging = false;
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(280, Math.round(rect.width));
    const height = Math.max(320, Math.round(rect.height));
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async setPhoto(index, dataUrl) {
    this.photos[index] = dataUrl || "";
    if (dataUrl) {
      this.textures[index] = await makeImageTexture(dataUrl);
    } else {
      this.textures[index] = null;
    }
    this.rebuild();
  }

  setOptions(options = {}) {
    this.options = options;
    this.rebuild();
  }

  setProduct(product = {}) {
    this.product = product;
    this.rebuild();
  }

  getTexture(index, label) {
    return this.textures[index] || makeTextTexture(label || "Photo " + (index + 1), index);
  }

  clearGroup() {
    while (this.group.children.length) {
      const child = this.group.children.pop();
      child.traverse((item) => {
        if (item.geometry) item.geometry.dispose();
        if (item.material && !Array.isArray(item.material)) item.material.dispose();
      });
    }
  }

  rebuild() {
    this.clearGroup();
    this.rotationTarget = 0;
    this.rotateSpeed = 0.005;
    const kind = productKind(this.product);
    const requirement = photoRequirement(this.product, this.options);
    if (kind === "mug") this.buildMug(requirement);
    else if (kind === "pillow") this.buildPillow(requirement);
    else if (kind === "coaster") this.buildCoasters(requirement);
    else if (kind === "combo") this.buildCombo(requirement);
    else this.buildFrame(requirement, kind === "mini-frame");
  }

  buildMug(requirement) {
    this.rotateSpeed = 0.007;
    this.camera.position.set(0, 0.42, 6.05);
    this.camera.lookAt(0, -0.03, 0);
    const style = String(this.options["Cup style"] || this.product.name || "").toLowerCase();
    const layout = String(this.options["Print layout"] || "").toLowerCase();
    const isMagic = String(this.product.id || "").includes("magic") || style.includes("magic");
    const bodyColor = isMagic ? 0x111318 : 0xffffff;
    const insideColor = style.includes("color inside") ? 0xff5f57 : 0xffffff;
    const ceramic = mat(bodyColor, 0.3, 0.015);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 1.78, 128, 1, true), ceramic);
    mug.position.y = 0.05;
    this.group.add(mug);

    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.73, 0.73, 0.05, 128), mat(insideColor, 0.18, 0.01));
    inner.position.y = 0.96;
    this.group.add(inner);

    const topRim = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.045, 20, 128), ceramic);
    topRim.rotation.x = Math.PI / 2;
    topRim.position.y = 0.955;
    this.group.add(topRim);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.82, 0.1, 128), ceramic);
    base.position.y = -0.9;
    this.group.add(base);

    const foot = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.022, 14, 128), ceramic);
    foot.rotation.x = Math.PI / 2;
    foot.position.y = -0.955;
    this.group.add(foot);

    this.group.add(createMugHandle(ceramic));

    const printHeight = 1.48;
    const printRadius = 0.845;
    const hasWrap = layout.includes("wrap");
    const hasTwoSide = layout.includes("two") || requirement.min > 1 || requirement.max > 1;
    const frontArc = hasWrap ? Math.PI * 1.62 : Math.PI * 0.72;
    const front = new THREE.Mesh(createCurvedPrintGeometry(printRadius, printHeight, frontArc, -0.48), imageMaterial(this.getTexture(0, requirement.labels[0]), { roughness: 0.34 }));
    front.position.y = 0.015;
    this.group.add(front);

    if (!hasWrap && hasTwoSide) {
      const backArc = Math.PI * 0.58;
      const back = new THREE.Mesh(createCurvedPrintGeometry(printRadius + 0.002, printHeight, backArc, Math.PI - 0.48), imageMaterial(this.getTexture(1, requirement.labels[1] || "Back Side Photo"), { roughness: 0.34 }));
      back.position.y = 0.015;
      this.group.add(back);
    }

    this.group.rotation.y = 0.42;
  }

  buildFrame(requirement, mini = false) {
    this.camera.position.set(0, 0.72, 5.8);
    this.camera.lookAt(0, -0.15, 0);
    this.addTurntable(-1.16, mini ? 1.45 : 1.85);
    const frameGroup = new THREE.Group();
    frameGroup.rotation.y = mini ? -0.2 : -0.12;
    frameGroup.rotation.x = 0.02;
    frameGroup.position.y = 0.02;
    this.group.add(frameGroup);

    const width = mini ? 2.1 : 3.0;
    const height = mini ? 1.55 : 2.05;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(width + 0.42, height + 0.42, 0.12), mat(0xf7efe2, 0.68));
    backing.position.z = -0.05;
    frameGroup.add(backing);
    addRoundedFrame(frameGroup, width, height, 0.24, mini ? 0x4057c8 : 0x17202a);

    const count = Math.min(requirement.max, Math.max(requirement.min, this.textures.filter(Boolean).length || 1));
    const cols = count <= 1 ? 1 : count <= 2 ? 2 : 3;
    const rows = Math.ceil(count / cols);
    const gap = 0.055;
    const cellW = (width - gap * (cols - 1)) / cols;
    const cellH = (height - gap * (rows - 1)) / rows;
    for (let i = 0; i < count; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(cellW, cellH),
        imageMaterial(this.getTexture(i, requirement.labels[i]), { roughness: 0.32 })
      );
      plane.position.set(-width / 2 + cellW / 2 + col * (cellW + gap), height / 2 - cellH / 2 - row * (cellH + gap), 0.08);
      frameGroup.add(plane);
    }

    if (mini) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.12), mat(0x17202a, 0.38));
      stand.position.set(0.45, -1.25, -0.5);
      stand.rotation.x = -0.56;
      frameGroup.add(stand);
    } else {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.12, 0.34), mat(0x17202a, 0.38));
      foot.position.set(0, -1.19, -0.08);
      frameGroup.add(foot);
    }
  }

  buildPillow(requirement) {
    this.rotateSpeed = 0.0028;
    this.rotationTarget = -0.06;
    this.camera.position.set(0, 0.3, 5.55);
    this.camera.lookAt(0, -0.02, 0);
    this.addTurntable(-1.12, 1.62);

    const pillowGroup = new THREE.Group();
    pillowGroup.position.y = -0.08;
    this.group.add(pillowGroup);

    const fabric = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide
    });
    const frontPrint = imageMaterial(this.getTexture(0, requirement.labels[0]), { roughness: 0.86, metalness: 0, side: THREE.FrontSide });
    const backPrint = requirement.max > 1
      ? imageMaterial(this.getTexture(1, requirement.labels[1]), { roughness: 0.86, metalness: 0, side: THREE.FrontSide })
      : fabric;
    const pillow = new THREE.Mesh(
      createCushionGeometry(2.58, 1.84, 0.46),
      [fabric, fabric, fabric, fabric, frontPrint, backPrint]
    );
    pillowGroup.add(pillow);

    this.group.rotation.y = -0.06;
  }

  buildCoasters(requirement) {
    this.camera.position.set(0, 0.55, 5.8);
    this.camera.lookAt(0, -0.05, 0);
    this.addTurntable(-0.92, 1.65);
    const round = String(this.options["Coaster shape"] || "").toLowerCase().includes("round");
    const geometry = round ? new THREE.CylinderGeometry(0.48, 0.48, 0.06, 56) : new THREE.BoxGeometry(0.9, 0.9, 0.06);
    const positions = [
      [-0.58, 0.58, 0],
      [0.58, 0.58, 0],
      [-0.58, -0.42, 0],
      [0.58, -0.42, 0]
    ];
    positions.forEach((pos, index) => {
      const body = new THREE.Mesh(geometry.clone(), mat(0xf6ead7, 0.58));
      body.position.set(pos[0], pos[1], pos[2]);
      body.rotation.y = -0.18;
      this.group.add(body);
      const top = new THREE.Mesh(
        round ? new THREE.CircleGeometry(0.43, 56) : new THREE.PlaneGeometry(0.78, 0.78),
        imageMaterial(this.getTexture(index, requirement.labels[index]), { roughness: 0.4 })
      );
      top.rotation.y = -0.18;
      top.position.set(pos[0] - 0.006, pos[1], pos[2] + 0.035);
      this.group.add(top);
    });
    this.group.rotation.x = 0;
  }

  buildCombo(requirement) {
    this.camera.position.set(0, 0.72, 5.95);
    this.camera.lookAt(0, -0.05, 0);
    this.addTurntable(-1.08, 2.08);

    const cupGroup = new THREE.Group();
    cupGroup.position.set(-1.3, -0.36, 0.18);
    cupGroup.scale.setScalar(0.62);
    this.group.add(cupGroup);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 1.55, 96, 1, true), mat(0xffffff, 0.3));
    cupGroup.add(cup);
    const cupRim = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.04, 16, 96), mat(0xffffff, 0.3));
    cupRim.rotation.x = Math.PI / 2;
    cupRim.position.y = 0.78;
    cupGroup.add(cupRim);
    cupGroup.add(createMugHandle(mat(0xffffff, 0.3)));
    const cupPrint = new THREE.Mesh(createCurvedPrintGeometry(0.846, 1.12, Math.PI * 0.72, -0.35), imageMaterial(this.getTexture(0, requirement.labels[0]), { roughness: 0.32 }));
    cupGroup.add(cupPrint);

    const frame = new THREE.Group();
    frame.position.set(0, -0.02, -0.1);
    frame.rotation.y = -0.1;
    this.group.add(frame);
    addRoundedFrame(frame, 1.35, 1.0, 0.16, 0x17202a);
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.0), imageMaterial(this.getTexture(1, requirement.labels[1]), { roughness: 0.34 }));
    photo.position.z = 0.08;
    frame.add(photo);

    const pillow = new THREE.Mesh(createCushionGeometry(1.3, 0.92, 0.26), mat(0xffffff, 0.88));
    pillow.position.set(1.3, -0.42, 0.2);
    pillow.rotation.y = -0.28;
    this.group.add(pillow);
    const pillowPhoto = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.58), imageMaterial(this.getTexture(2, requirement.labels[2]), { roughness: 0.62 }));
    pillowPhoto.position.set(1.3, -0.42, 0.42);
    pillowPhoto.rotation.y = -0.28;
    this.group.add(pillowPhoto);

    const card = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.58, 0.045), mat(0xfff4dd, 0.58));
    card.position.set(0.82, -0.73, 0.96);
    card.rotation.set(-0.72, -0.2, 0.08);
    this.group.add(card);
    const cardPhoto = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.44), imageMaterial(this.getTexture(3, requirement.labels[3] || "Card Photo"), { roughness: 0.44 }));
    cardPhoto.position.set(0.82, -0.58, 1.12);
    cardPhoto.rotation.set(-0.72, -0.2, 0.08);
    this.group.add(cardPhoto);
  }

  animate() {
    this.frame = requestAnimationFrame(() => this.animate());
    if (this.autoRotate) this.rotationTarget += this.rotateSpeed;
    this.group.rotation.y += (this.rotationTarget - this.group.rotation.y) * 0.08;
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.clearGroup();
    this.renderer.dispose();
    this.container.innerHTML = "";
  }
}

export { photoRequirement, productKind };
