// Fit&Fun — atrapa les bombolles amb p5.js + ml5.js (bodyPose / MoveNet)
const VW = 640, VH = 480;          // mida del vídeo de la webcam
const DURADA = 30000;              // 30 segons
const MAX_BOMBOLLES = 3;           // màxim de bombolles alhora
const RADI_INICIAL = 14;           // radi en néixer (px)
const CREIXEMENT = 30;             // px per segon
const CONF = 0.3;                  // confiança mínima d’un punt
const PUNTS_CARA = [0, 1, 2, 3, 4];
const ROSA = [255, 45, 149];
const COLOR_MA = [255, 220, 40];   // color que ressalta les mans
const radiMa = () => Math.max(30, height * 0.04);
const COLORS = [[90, 215, 255], [190, 140, 255], [255, 220, 90], [120, 240, 170]];

let video = null, bodyPose, poses = [], connexions = [];
let estat = "menu";                // menu | instruccions | colocacio | joc | final
let okFrames = 0, llest = false;
let bombolles = [], particules = [], puntuacio = 0, tIni = 0;
let audioCtx = null;

const $ = (id) => document.getElementById(id);

function preload() { bodyPose = ml5.bodyPose("MoveNet", { flipped: false }); }

function setup() {
  createCanvas(windowWidth, windowHeight).parent("contenidor");
  connexions = bodyPose.getSkeleton().filter(([a, b]) => !PUNTS_CARA.includes(a) && !PUNTS_CARA.includes(b));

  $("btnJugar").onclick = () => { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); iniciaCamera(); pantalla("colocacio"); };
  $("btnInstruccions").onclick = () => pantalla("instruccions");
  $("btnTornarInst").onclick = () => pantalla("menu");
  $("btnTornarCol").onclick = () => { aturaCamera(); pantalla("menu"); };
  $("btnComencar").onclick = començaJoc;
  $("btnFinalitzar").onclick = () => { aturaCamera(); pantalla("menu"); };
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

// ---------- Pantalles ----------
function pantalla(nom) {
  estat = nom;
  $("menu").classList.toggle("amagat", nom !== "menu");
  $("instruccions").classList.toggle("amagat", nom !== "instruccions");
  $("final").classList.toggle("amagat", nom !== "final");
  $("btnTornarCol").classList.toggle("amagat", nom !== "colocacio");
  if (nom !== "colocacio") $("btnComencar").classList.add("amagat");
  if (nom === "colocacio") { okFrames = 0; llest = false; }
}

// ---------- Càmera ----------
function iniciaCamera() {
  video = createCapture(VIDEO);
  video.size(VW, VH);
  video.hide();
  bodyPose.detectStart(video, (r) => { poses = r; });
}
function aturaCamera() {
  bodyPose.detectStop();
  if (video) {
    if (video.elt.srcObject) video.elt.srcObject.getTracks().forEach((t) => t.stop());
    video.remove(); video = null;
  }
  poses = [];
}

// Converteix un punt del vídeo a coordenades de pantalla (mirall + vídeo a pantalla completa)
const esc = () => Math.max(width / VW, height / VH);
function pt(kp) {
  const s = esc();
  return { x: width / 2 - (kp.x - VW / 2) * s, y: height / 2 + (kp.y - VH / 2) * s, c: kp.confidence };
}

// ---------- Bucle principal ----------
function draw() {
  background(20, 16, 28);
  if (!video || estat === "menu" || estat === "instruccions") return;

  const s = esc();
  push(); translate(width / 2, height / 2); scale(-s, s); imageMode(CENTER); image(video, 0, 0, VW, VH); pop();
  dibuixaEsquelet();

  if (estat === "colocacio") colocacio();
  else if (estat === "joc") joc();
  dibuixaMans();   // al final, perquè quedin per sobre de les bombolles
}

function dibuixaEsquelet() {
  const p = poses[0];
  if (!p) return;
  stroke(...ROSA); strokeWeight(7); strokeCap(ROUND);
  for (const [a, b] of connexions) {
    const A = pt(p.keypoints[a]), B = pt(p.keypoints[b]);
    if (A.c > CONF && B.c > CONF) line(A.x, A.y, B.x, B.y);
  }
  p.keypoints.forEach((kp, i) => {
    const q = pt(kp);
    if (PUNTS_CARA.includes(i) || q.c <= CONF) return;
    noStroke(); fill(255, 45, 149, 90); circle(q.x, q.y, 34);
    fill(...ROSA); stroke(255); strokeWeight(2); circle(q.x, q.y, 18);
  });
}

// Les mans (canells) ressaltades amb un cercle extra d’un altre color
function dibuixaMans() {
  const p = poses[0];
  if (!p) return;
  for (const i of [9, 10]) {
    const m = pt(p.keypoints[i]);
    if (m.c <= CONF) continue;
    const r = radiMa();
    fill(COLOR_MA[0], COLOR_MA[1], COLOR_MA[2], 70); stroke(...COLOR_MA); strokeWeight(6);
    circle(m.x, m.y, r * 2);
    noStroke(); fill(...COLOR_MA); circle(m.x, m.y, r * 0.5);
  }
}

// ---------- Col·locació ----------
// Toleràncies de la col·locació (la silueta dibuixada no canvia; només el marge real és més ample)
const COL = { conf: 0.2, marge: 0.02, ampMin: 0.06, ampMax: 0.6, centre: 0.22, frames: 10 };

function comprova() {
  const p = poses[0];
  if (!p) return { ok: false, msg: "No et veig. Seu davant la càmera." };
  const ls = pt(p.keypoints[5]), rs = pt(p.keypoints[6]);   // només cal veure les espatlles
  if (ls.c < COL.conf || rs.c < COL.conf) return { ok: false, msg: "Que et vegi bé les espatlles." };
  if ([ls, rs].some((q) => q.x < width * COL.marge || q.x > width * (1 - COL.marge) || q.y < height * COL.marge || q.y > height * (1 - COL.marge)))
    return { ok: false, msg: "Queda’t dins de la pantalla." };
  const amp = Math.abs(ls.x - rs.x) / width;
  if (amp > COL.ampMax) return { ok: false, msg: "Allunya’t una mica de la càmera." };
  if (amp < COL.ampMin) return { ok: false, msg: "Apropa’t una mica a la càmera." };
  if (Math.abs((ls.x + rs.x) / 2 - width / 2) > width * COL.centre) return { ok: false, msg: "Mou-te una mica cap al centre." };
  return { ok: true, msg: "Perfecte! Prem COMENÇAR!" };
}

function colocacio() {
  const r = comprova();
  okFrames = r.ok ? okFrames + 1 : 0;
  llest = okFrames > COL.frames;
  $("btnComencar").classList.toggle("amagat", !llest);

  // Imatge de referència (silueta)
  noFill(); stroke(llest ? color(80, 255, 140) : 255); strokeWeight(5);
  drawingContext.setLineDash([16, 12]);
  const tw = Math.min(width * 0.3, height * 0.6);
  circle(width / 2, height * 0.3, height * 0.17);
  rect(width / 2 - tw / 2, height * 0.42, tw, height * 0.6, tw * 0.45, tw * 0.45, 0, 0);
  drawingContext.setLineDash([]);

  pastilla("Col·loca’t dins la silueta, amb el cap i els braços ben visibles", width / 2, height * 0.08, height * 0.04);
  pastilla(r.msg, width / 2, height * 0.16, height * 0.045, llest ? [30, 150, 80] : [0, 0, 0]);
}

// ---------- Joc ----------
function començaJoc() {
  puntuacio = 0; bombolles = []; particules = [];
  tIni = millis();
  pantalla("joc");
}

function joc() {
  const restant = DURADA - (millis() - tIni);
  if (restant <= 0) return acaba();
  const dt = deltaTime / 1000;
  const maxR = constrain(Math.min(width, height) * 0.12, 60, 110);

  if (bombolles.length < MAX_BOMBOLLES) nova(maxR);   // reposició immediata: sempre hi ha 3 bombolles

  const p = poses[0];
  const mans = p ? [9, 10].map((i) => pt(p.keypoints[i])).filter((m) => m.c > CONF) : [];

  for (let i = bombolles.length - 1; i >= 0; i--) {
    const b = bombolles[i];
    b.r = Math.min(maxR, b.r + CREIXEMENT * dt);            // creix fins al màxim
    if (mans.some((m) => dist(m.x, m.y, b.x, b.y) < b.r + radiMa())) {
      petar(b); bombolles.splice(i, 1); puntuacio++;
    }
  }
  bombolles.forEach(dibuixaBombolla);
  dibuixaParticules(dt);

  // HUD: puntuació i compte enrere sempre visibles
  const seg = Math.ceil(restant / 1000);
  pastilla("Punts: " + puntuacio, width * 0.14, height * 0.07, height * 0.06);
  pastilla("⏱ " + seg + " s", width * 0.86, height * 0.07, height * 0.06, seg <= 5 ? [200, 30, 60] : [0, 0, 0]);
}

function nova(maxR) {
  for (let intents = 0; intents < 30; intents++) {
    const x = random(width * 0.12, width * 0.88), y = random(height * 0.22, height * 0.85);
    if (bombolles.every((b) => dist(x, y, b.x, b.y) > maxR * 2)) {
      bombolles.push({ x, y, r: RADI_INICIAL, col: random(COLORS) });
      return;
    }
  }
}

function dibuixaBombolla(b) {
  fill(b.col[0], b.col[1], b.col[2], 80); stroke(255, 235); strokeWeight(4); circle(b.x, b.y, b.r * 2);
  noStroke(); fill(255, 150); ellipse(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.4, b.r * 0.25);
}

function petar(b) {
  so(520, 0.12, "sine", 0.25); so(780, 0.12, "sine", 0.2, 0.06);
  for (let i = 0; i < 16; i++) {
    const a = random(TWO_PI), v = random(120, 320);
    particules.push({ x: b.x, y: b.y, vx: cos(a) * v, vy: sin(a) * v, vida: 1, col: b.col });
  }
}
function dibuixaParticules(dt) {
  noStroke();
  for (let i = particules.length - 1; i >= 0; i--) {
    const q = particules[i];
    q.x += q.vx * dt; q.y += q.vy * dt; q.vida -= dt * 1.8;
    if (q.vida <= 0) { particules.splice(i, 1); continue; }
    fill(q.col[0], q.col[1], q.col[2], 255 * q.vida); circle(q.x, q.y, 14 * q.vida + 4);
  }
}

// ---------- Final ----------
function acaba() {
  so(220, 0.7, "sawtooth", 0.25); so(220, 0.7, "sawtooth", 0.25, 0.9);   // botzina
  $("puntsFinals").textContent = puntuacio;
  pantalla("final");
}

// ---------- Utilitats ----------
function pastilla(txt, x, y, mida, fons = [0, 0, 0]) {
  textAlign(CENTER, CENTER); textStyle(BOLD); textSize(mida);
  const w = textWidth(txt) + mida * 1.2, h = mida * 1.6;
  noStroke(); fill(fons[0], fons[1], fons[2], 170); rect(x - w / 2, y - h / 2, w, h, h / 2);
  fill(255); text(txt, x, y + 2);
}

function so(freq, dur, tipus = "sine", vol = 0.2, retard = 0) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + retard;
  o.type = tipus; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur);
}
