const KOKORO = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const JSZIP = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
const SILENT = (() => { const n = 4000, b = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0))); w(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, "data"); b.setUint32(40, n * 2, true); return URL.createObjectURL(new Blob([b], { type: "audio/wav" })); })();

const $ = id => document.getElementById(id);
const audio = new Audio();
audio.preservesPitch = true;
let tts = null, queue = Promise.resolve(), sections = [], chunkLists = [], si = 0, ci = 0;
let token = 0, running = false, fileKey = "", fileName = "";
const cache = new Map(), peaks = new Map();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

const say = (msg) => { $("status").textContent = msg; };
const ui = () => { const p = running && !audio.paused; $("play").textContent = p ? "⏸" : "▶"; $("play").setAttribute("aria-label", p ? "Pause" : "Play"); };

// ---------- parsing ----------
async function parse(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "pdf") return parsePdf(file);
  if (ext === "epub") return parseEpub(file);
  const raw = await file.text();
  const text = ext === "html" || ext === "htm" ? new DOMParser().parseFromString(raw, "text/html").body.textContent : raw;
  return [{ title: file.name, text }];
}
async function parsePdf(file) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    say(`Reading page ${i} of ${pdf.numPages}…`);
    const tc = await (await pdf.getPage(i)).getTextContent();
    out.push({ title: `Page ${i}`, text: tc.items.map(x => x.str + " ").join("") });
  }
  return out;
}
async function parseEpub(file) {
  const JSZip = (await import(JSZIP)).default;
  const zip = await JSZip.loadAsync(file);
  const read = p => zip.file(decodeURIComponent(p)).async("string");
  const xml = s => new DOMParser().parseFromString(s, "application/xml");
  const opfPath = xml(await read("META-INF/container.xml")).querySelector("rootfile").getAttribute("full-path");
  const opf = xml(await read(opfPath));
  const base = opfPath.replace(/[^/]*$/, "");
  const manifest = {};
  opf.querySelectorAll("manifest > item").forEach(i => { manifest[i.getAttribute("id")] = i.getAttribute("href"); });
  const out = [];
  for (const ref of opf.querySelectorAll("spine > itemref")) {
    const href = manifest[ref.getAttribute("idref")];
    const f = href && zip.file(decodeURIComponent(base + href.split("#")[0]));
    if (!f) continue;
    const doc = new DOMParser().parseFromString(await f.async("string"), "text/html");
    doc.querySelectorAll("script,style").forEach(e => e.remove());
    doc.querySelectorAll("p,div,li,h1,h2,h3,h4,br").forEach(e => e.append("\n"));
    const text = doc.body.textContent;
    if (text.trim().length > 40) out.push({ title: doc.querySelector("h1,h2,h3")?.textContent.trim() || `Section ${out.length + 1}`, text });
  }
  return out;
}

// ---------- chunking ----------
function toChunks(text) {
  const sents = text.replace(/-\n/g, "").replace(/[ \t]+/g, " ")
    .split(/\n+|(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
  const out = []; let cur = "";
  for (const s of sents) {
    if (cur && cur.length + s.length > 280) { out.push(cur); cur = s; } else cur = cur ? cur + " " + s : s;
  }
  if (cur) out.push(cur);
  return out;
}
const chunksOf = i => (chunkLists[i] ??= toChunks(sections[i].text));
function after(a, b) {
  if (b + 1 < chunksOf(a).length) return [a, b + 1];
  for (let n = a + 1; n < sections.length; n++) if (chunksOf(n).length) return [n, 0];
  return null;
}

// ---------- speech ----------
async function loadTTS() {
  if (tts) return tts;
  const { KokoroTTS } = await import(KOKORO);
  say("Downloading the voice model. This happens once, so use Wi-Fi.");
  $("bar").hidden = false;
  tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8", device: "wasm",
    progress_callback: p => { if (p.status === "progress") $("bar").value = p.progress; }
  });
  $("bar").hidden = true;
  return tts;
}
function synth(s, c) {
  const k = `${s}:${c}:${$("voice").value}`;
  if (!cache.has(k)) {
    const text = chunksOf(s)[c], voice = $("voice").value;
    const p = queue.then(async () => { const a = await tts.generate(text, { voice }); let pk = 0; for (const v of a.audio) pk = Math.max(pk, Math.abs(v)); peaks.set(k, pk); return URL.createObjectURL(a.toBlob()); });
    queue = p.catch(() => {});
    cache.set(k, p);
  }
  return cache.get(k);
}
function prune(keep) {
  for (const [k, p] of cache) if (!keep.includes(k)) { cache.delete(k); p.then(URL.revokeObjectURL).catch(() => {}); }
}

async function run() {
  const my = ++token;
  running = true; ui();
  try { await loadTTS(); } catch (e) { say("Could not load the voice model: " + e.message); running = false; ui(); return; }
  say("Preparing the first sentences. The first one can take 10 to 30 seconds on a phone.");
  while (my === token) {
    const keys = [`${si}:${ci}:${$("voice").value}`];
    let nx = after(si, ci);
    for (let n = 0; n < 2 && nx; n++) { keys.push(`${nx[0]}:${nx[1]}:${$("voice").value}`); synth(...nx); nx = after(...nx); }
    prune(keys);
    render();
    let url;
    try { url = await synth(si, ci); } catch (e) { say("Speech failed: " + e.message); break; }
    if (my !== token) return;
    audio.src = url; audio.playbackRate = +$("speed").value;
    say((peaks.get(`${si}:${ci}:${$("voice").value}`) ?? 1) < 0.01 ? "The voice produced silence. Try another voice or the GPU setting in the README." : "Reading aloud…");
    try { await audio.play(); } catch { say("Tap play to continue."); running = false; ui(); return; }
    await new Promise(res => { audio.onended = res; audio.onerror = () => { say("The audio could not be played on this device."); res(); }; });
    if (my !== token) return;
    const n = after(si, ci);
    if (!n) { say("Finished."); break; }
    [si, ci] = n; save();
  }
  if (my === token) { running = false; ui(); }
}

function jump(s, c, resume) {
  token++; audio.pause(); audio.onended = null;
  si = s; ci = c; save(); render();
  running = false; ui();
  if (resume) run();
}
function toggle() {
  if (!sections.length) return say("Open a file first.");
  if (running) { audio.paused ? audio.play() : audio.pause(); ui(); return; }
  audio.src = SILENT; audio.play().catch(() => {});   // unlocks audio on iOS
  run();
}

// ---------- ui ----------
function render() {
  const list = chunksOf(si), box = $("text");
  box.replaceChildren();
  for (let n = Math.max(0, ci - 2); n < Math.min(list.length, ci + 4); n++) {
    const p = document.createElement("p");
    p.textContent = list[n];
    p.className = n === ci ? "cur" : "ctx";
    box.append(p);
  }
  $("section").value = si;
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: sections[si].title, artist: fileName });
}
const save = () => { try { localStorage.setItem(fileKey, JSON.stringify({ si, ci })); } catch {} };

$("file").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  token++; audio.pause(); running = false; ui(); cache.clear();
  fileName = f.name; fileKey = `ra:${f.name}:${f.size}`; $("fileLabel").textContent = f.name;
  try {
    sections = (await parse(f)).filter(s => s.text.trim()); chunkLists = [];
  } catch (err) { return say("Could not read this file: " + err.message); }
  if (!sections.length) return say("No readable text found. Scanned PDFs need OCR first.");
  const sel = $("section"); sel.replaceChildren(); sel.disabled = false;
  sections.forEach((s, i) => sel.add(new Option(s.title, i)));
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(fileKey)) || {}; } catch {}
  si = Math.min(saved.si || 0, sections.length - 1); ci = Math.min(saved.ci || 0, Math.max(0, chunksOf(si).length - 1));
  render(); say("Ready. Press play.");
});
$("play").onclick = toggle;
$("prev").onclick = () => sections.length && jump(...(ci > 0 ? [si, ci - 1] : [si, 0]), running);
$("next").onclick = () => { const n = sections.length && after(si, ci); if (n) jump(...n, running); };
$("section").onchange = e => jump(+e.target.value, 0, running);
$("speed").oninput = e => { audio.playbackRate = +e.target.value; $("speedVal").textContent = (+e.target.value).toFixed(2).replace(/0$/, "") + "×"; };
audio.onplay = audio.onpause = ui;
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", toggle);
  navigator.mediaSession.setActionHandler("pause", toggle);
  navigator.mediaSession.setActionHandler("nexttrack", () => $("next").click());
  navigator.mediaSession.setActionHandler("previoustrack", () => $("prev").click());
}
