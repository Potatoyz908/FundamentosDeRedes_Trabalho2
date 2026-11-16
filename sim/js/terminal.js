import { setCtx } from "./state.js";
import { dispatch, getPrompt, getCtx } from "./commands.js";

const output = document.getElementById("output");
const form = document.getElementById("cmd-form");
const input = document.getElementById("cmd-input");
const promptEl = document.getElementById("prompt");
const buttons = document.querySelectorAll(".ctx-btns button");

const history = [];
let histIdx = -1;

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

function welcome() {
  append(
    "line-meta",
    `Simulador interativo do Trabalho 2 — Fundamentos de Redes
Contextos: pi (FreeBSD) · lan (172.16.0.10) · wan (192.168.1.17)
IPs das evidências: WAN Pi 192.168.1.31 · gateway 192.168.1.254

Digite demo para o roteiro completo, ou comece com:
  ifconfig ue0 ; ifconfig ue1`
  );
  syncUi();
}

function switchCtx(ctx) {
  setCtx(ctx);
  syncUi();
  append("line-meta", `contexto → ${ctx}`);
  input.focus();
}

buttons.forEach((b) => {
  b.addEventListener("click", () => switchCtx(b.dataset.ctx));
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const line = input.value;
  input.value = "";
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

welcome();
input.focus();
