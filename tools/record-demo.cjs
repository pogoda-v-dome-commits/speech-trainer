// Записывает демо-ролик приложения 1080×1920 для рилс.
//   node tools/record-demo.cjs <выходной.mp4>
// Речь имитируется (в автоматическом браузере нет микрофона), интерфейс — настоящий.
const { chromium } = require("C:/Users/NEO/Desktop/Важное с рабочего стола/reel-domino/node_modules/playwright-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const URL = "https://pogoda-v-dome-commits.github.io/speech-trainer/";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const OUT = path.resolve(process.argv[2] || "app-demo.mp4");
const TOPIC = "Продайте мне эту ручку";
const SPEECH = [
  "ну вот это ручка",
  "она как бы очень удобная",
  "во первых она лежит в руке типа идеально",
  "потому что у неё мягкий корпус",
  "например я пишу ей уже полгода",
  "и короче она ни разу не подвела",
  "итак берите эту ручку не пожалеете",
];

// Подменяем распознавание речи: фразы «произносятся» по словам
const FAKE_SR = (speech) => {
  window.__speech = speech;
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() {
      if (this._t) return;
      const results = [];
      let p = 0, w = 0;
      const tick = () => {
        if (p >= speech.length) return;
        const words = speech[p].split(" ");
        w++;
        const done = w >= words.length;
        results[p] = Object.assign([{ transcript: words.slice(0, w).join(" ") }], { isFinal: done });
        this.onresult && this.onresult({ resultIndex: p, results });
        if (done) { p++; w = 0; this._t = setTimeout(tick, 650); } else this._t = setTimeout(tick, 230);
      };
      this._t = setTimeout(tick, 900);
    }
    stop() { clearTimeout(this._t); }
  };
};

// Кружок в месте касания, как при записи экрана телефона
const TAP_CSS = `
  .tap-dot{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
    background:rgba(120,120,120,.35);border:2px solid rgba(255,255,255,.8);pointer-events:none;z-index:9999;
    animation:tapf .55s ease-out forwards}
  @keyframes tapf{from{transform:scale(.6);opacity:1}to{transform:scale(1.3);opacity:0}}
  ::-webkit-scrollbar{display:none}`;
const TAP_JS = () => addEventListener("pointerdown", (e) => {
  const d = document.createElement("div");
  d.className = "tap-dot"; d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px";
  document.body.append(d); setTimeout(() => d.remove(), 600);
}, true);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Синтез звуковой дорожки: мягкий «тык» на касание, тихий щелчок на каждую клавишу (WAV 48 кГц моно)
function tapTrack(events, seconds) {
  const SR = 48000, n = Math.ceil(seconds * SR), buf = new Float32Array(n);
  for (const e of events) {
    const start = Math.round(e.t * SR);
    const len = Math.round((e.type === "tap" ? 0.08 : 0.03) * SR);
    let prev = 0;
    const pitch = e.type === "tap" ? 1400 : 3200 + Math.random() * 600;
    for (let i = 0; i < len && start + i < n; i++) {
      if (start + i < 0) continue;
      const t = i / SR;
      let v;
      if (e.type === "tap") {
        v = 0.45 * Math.sin(2 * Math.PI * pitch * t) * Math.exp(-t / 0.012) + 0.2 * (Math.random() * 2 - 1) * Math.exp(-t / 0.002);
      } else {
        const noise = Math.random() * 2 - 1, hp = noise - prev; prev = noise;
        v = (0.12 * hp + 0.08 * Math.sin(2 * Math.PI * pitch * t)) * Math.exp(-t / 0.004);
      }
      buf[start + i] += v;
    }
  }
  const out = Buffer.alloc(44 + n * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + n * 2, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  return out;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: false,
    colorScheme: "light", locale: "ru-RU", permissions: ["microphone"],
  });
  await ctx.addInitScript(FAKE_SR, SPEECH);
  await ctx.addInitScript(TAP_JS);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: TAP_CSS });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((t) => { window.pickTopic = () => t; }, TOPIC);

  // Запись кадров через CDP screencast
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-"));
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1080, maxHeight: 1920 });

  // Моменты касаний и нажатий клавиш — для звуковой дорожки
  const events = [];
  const tap = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    events.push({ t: Date.now() / 1000, type: "tap" });
    await page.mouse.down(); await wait(90); await page.mouse.up();
  };
  const typeText = async (text) => {
    for (const ch of text) {
      if (ch !== " ") events.push({ t: Date.now() / 1000, type: "key" });
      await page.keyboard.type(ch);
      await wait(45 + Math.random() * 40);
    }
  };
  const smoothScrollTo = (y, ms) => page.evaluate(([y, ms]) => new Promise((res) => {
    const y0 = scrollY, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      scrollTo(0, y0 + (y - y0) * e);
      k < 1 ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  }), [y, ms]);
  const yOf = (sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + scrollY - 70, sel);

  // 1. Главный экран → простой режим
  await wait(1800);
  await tap('.mode[data-mode="easy"]');
  // 2. Подготовка: тема, таймер, заметки
  await wait(2200);
  await tap("#notes");
  await typeText("Удобная, надёжная, пример — полгода пишу");
  await wait(900);
  await tap("#goSpeak");
  // 3. Речь появляется на экране
  const words = SPEECH.join(" ").split(" ").length;
  await wait(900 + words * 230 + SPEECH.length * 650 + 1200);
  await tap("#stopSpeak");
  // 4. Разбор: оценка, паразиты, структура, текст
  await wait(2600);
  await smoothScrollTo(await yOf("#resFillers") - 120, 1600); await wait(2200);
  await smoothScrollTo(await yOf("#resStruct") - 40, 1400); await wait(2200);
  await smoothScrollTo(await yOf("#resTips") - 40, 1400); await wait(2600);
  await smoothScrollTo(await yOf("#resText") - 60, 1600); await wait(2600);

  await cdp.send("Page.stopScreencast");
  await browser.close();

  // Склейка кадров с реальными паузами → ровные 30 к/с
  const list = frames.map((f, i) => {
    const dur = i + 1 < frames.length ? frames[i + 1].t - f.t : 1;
    return `file '${f.file.replace(/\\/g, "/")}'\nduration ${dur.toFixed(4)}`;
  }).join("\n") + `\nfile '${frames.at(-1).file.replace(/\\/g, "/")}'\n`;
  const listFile = path.join(dir, "list.txt");
  fs.writeFileSync(listFile, list);
  const duration = frames.at(-1).t - frames[0].t + 1;
  const wavFile = path.join(dir, "taps.wav");
  fs.writeFileSync(wavFile, tapTrack(events.map((e) => ({ ...e, t: e.t - frames[0].t + 0.07 })), duration));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-i", wavFile,
    "-vf", "scale=1080:1920:flags=lanczos,fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "slow",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", OUT]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`saved ${OUT} (${frames.length} frames)`);
})().catch((e) => { console.error(e); process.exit(1); });
