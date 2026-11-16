import { setCtx } from "./state.js";
import { dispatch, getPrompt, getCtx } from "./commands.js";
import { STEPS } from "./guide.js";

const output = document.getElementById("output");
const form = document.getElementById("cmd-form");
const input = document.getElementById("cmd-input");
const promptEl = document.getElementById("prompt");
const buttons = document.querySelectorAll(".ctx-btns button");

const elStage = document.getElementById("guide-stage");
const elProgress = document.getElementById("guide-progress");
const elTitle = document.getElementById("guide-title");
const elCtx = document.getElementById("guide-ctx");
const elCmd = document.getElementById("guide-cmd");
const elWhy = document.getElementById("guide-why");
const elLook = document.getElementById("guide-look");
const btnPrev = document.getElementById("guide-prev");
const btnNext = document.getElementById("guide-next");
const btnFill = document.getElementById("guide-fill");
const btnRun = document.getElementById("guide-run");

const history = [];
let histIdx = -1;
let stepIdx = 0;

function syncUi() {
  const ctx = getCtx();
  document.body.dataset.ctx = ctx;
  promptEl.textContent = getPrompt();
  buttons.forEach((b) => b.classList.toggle("active", b.dataset.ctx === ctx));
}

function append(cls, text) {
  if (text === undefined || text === null) return;
  if (text === "" && cls === "line-out") return;
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = text;
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}

function renderGuide() {
  const s = STEPS[stepIdx];
  elStage.textContent = s.stage;
  elProgress.textContent = `${stepIdx + 1} / ${STEPS.length}`;
  elTitle.textContent = s.title;
  elCtx.textContent = `contexto: ${s.ctx}`;
  elCtx.dataset.ctx = s.ctx;
  elCmd.textContent = s.cmd;
  elWhy.textContent = s.why;
  elLook.textContent = s.look;
  btnPrev.disabled = stepIdx === 0;
  btnNext.disabled = stepIdx === STEPS.length - 1;
}

function switchCtx(ctx, silent = false) {
  setCtx(ctx);
  syncUi();
  if (!silent) append("line-meta", `contexto → ${ctx}`);
  input.focus();
}

function runLine(line) {
  if (line.trim()) {
    history.push(line);
    histIdx = history.length;
  }

  append("line-cmd", `${getPrompt()} ${line}`);
  const res = dispatch(line);

  if (res.kind === "clear") {
    output.innerHTML = "";
    syncUi();
    return;
  }
  if (res.kind === "empty") return;
  if (res.kind === "ctx" || res.kind === "meta") {
    syncUi();
    if (res.text) append("line-meta", res.text);
    return;
  }
  if (res.text) append(res.kind === "err" ? "line-err" : "line-out", res.text);
  syncUi();
}

function fillStep() {
  const s = STEPS[stepIdx];
  if (getCtx() !== s.ctx) switchCtx(s.ctx, true);
  else syncUi();
  input.value = s.cmd;
  input.focus();
}

function runStep() {
  const s = STEPS[stepIdx];
  if (getCtx() !== s.ctx) {
    switchCtx(s.ctx, true);
    append("line-meta", `guia: trocou para ${s.ctx}`);
  }
  runLine(s.cmd);
  if (stepIdx < STEPS.length - 1) {
    stepIdx += 1;
    renderGuide();
  }
}

buttons.forEach((b) => {
  b.addEventListener("click", () => switchCtx(b.dataset.ctx));
});

btnPrev.addEventListener("click", () => {
  if (stepIdx > 0) {
    stepIdx -= 1;
    renderGuide();
  }
});

btnNext.addEventListener("click", () => {
  if (stepIdx < STEPS.length - 1) {
    stepIdx += 1;
    renderGuide();
  }
});

btnFill.addEventListener("click", fillStep);
btnRun.addEventListener("click", runStep);

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const line = input.value;
  input.value = "";
  runLine(line);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!history.length) return;
    histIdx = Math.max(0, histIdx - 1);
    input.value = history[histIdx];
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    histIdx = Math.min(history.length, histIdx + 1);
    input.value = histIdx >= history.length ? "" : history[histIdx];
  }
});

append(
  "line-meta",
  `Simulador interativo do Trabalho 2 — Fundamentos de Redes
Siga o guia à direita: leia “Por que rodar” → Executar → confira “O que observar”.
IPs: WAN Pi 192.168.1.31 · LAN host 172.16.0.10 · WAN host 192.168.1.17`
);

renderGuide();
syncUi();
input.focus();
