import { setCtx } from "./state.js";
import { dispatch } from "./commands.js";
import { STEPS } from "./guide.js";

const CTX = ["pi", "lan", "wan"];
const prompts = { pi: "[pi]#", lan: "[lan]$", wan: "[wan]$" };

const panes = Object.fromEntries(
  CTX.map((ctx) => [
    ctx,
    {
      root: document.querySelector(`.term-pane[data-ctx="${ctx}"]`),
      output: document.querySelector(`[data-output="${ctx}"]`),
      form: document.querySelector(`[data-form="${ctx}"]`),
      input: document.querySelector(`[data-input="${ctx}"]`),
      history: [],
      histIdx: -1,
    },
  ])
);

const elStage = document.getElementById("guide-stage");
const elProgress = document.getElementById("guide-progress");
const elTitle = document.getElementById("guide-title");
const elCtx = document.getElementById("guide-ctx");
const elCmd = document.getElementById("guide-cmd");
const elWhy = document.getElementById("guide-why");
const elKurose = document.getElementById("guide-kurose");
const elFlow = document.getElementById("guide-flow");
const elLook = document.getElementById("guide-look");
const btnPrev = document.getElementById("guide-prev");
const btnNext = document.getElementById("guide-next");
const btnFill = document.getElementById("guide-fill");
const btnRun = document.getElementById("guide-run");

let stepIdx = 0;

function append(ctx, cls, text) {
  if (text === undefined || text === null) return;
  if (text === "" && cls === "line-out") return;
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = text;
  panes[ctx].output.appendChild(div);
  panes[ctx].output.scrollTop = panes[ctx].output.scrollHeight;
}

function highlight(ctx) {
  CTX.forEach((c) => panes[c].root.classList.toggle("active-step", c === ctx));
}

function renderGuide() {
  const s = STEPS[stepIdx];
  elStage.textContent = s.stage;
  elProgress.textContent = `${stepIdx + 1} / ${STEPS.length}`;
  elTitle.textContent = s.title;
  elCtx.textContent = `rodar em: ${s.ctx}`;
  elCtx.dataset.ctx = s.ctx;
  elCmd.textContent = s.cmd;
  elWhy.textContent = s.why;
  elKurose.textContent = s.kurose;
  elFlow.textContent = s.flow;
  elLook.textContent = s.look;
  btnPrev.disabled = stepIdx === 0;
  btnNext.disabled = stepIdx === STEPS.length - 1;
  highlight(s.ctx);
}

function runLine(ctx, line) {
  setCtx(ctx);
  const p = panes[ctx];
  if (line.trim()) {
    p.history.push(line);
    p.histIdx = p.history.length;
  }

  append(ctx, "line-cmd", `${prompts[ctx]} ${line}`);
  const res = dispatch(line);

  // Meta commands that switch ctx via typing pi/lan/wan — keep output on the pane that typed
  if (res.kind === "clear") {
    p.output.innerHTML = "";
    return;
  }
  if (res.kind === "empty") return;

  if (res.kind === "ctx") {
    append(ctx, "line-meta", res.text || `contexto → ${res.ctx}`);
    // Also switch focus hint if user typed pi/lan/wan inside a pane
    if (res.ctx && panes[res.ctx]) {
      highlight(res.ctx);
      panes[res.ctx].input.focus();
    }
    return;
  }
  if (res.kind === "meta") {
    append(ctx, "line-meta", res.text);
    // reset: show note on all panes lightly
    if ((res.text || "").includes("reiniciado")) {
      CTX.filter((c) => c !== ctx).forEach((c) =>
        append(c, "line-meta", "(estado do lab reiniciado)")
      );
    }
    return;
  }
  if (res.text) append(ctx, res.kind === "err" ? "line-err" : "line-out", res.text);
}

function fillStep() {
  const s = STEPS[stepIdx];
  highlight(s.ctx);
  panes[s.ctx].input.value = s.cmd;
  panes[s.ctx].input.focus();
}

function runStep() {
  const s = STEPS[stepIdx];
  highlight(s.ctx);
  panes[s.ctx].input.value = "";
  runLine(s.ctx, s.cmd);
  panes[s.ctx].input.focus();
  if (stepIdx < STEPS.length - 1) {
    stepIdx += 1;
    renderGuide();
  }
}

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

CTX.forEach((ctx) => {
  const p = panes[ctx];
  p.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const line = p.input.value;
    p.input.value = "";
    runLine(ctx, line);
  });
  p.input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!p.history.length) return;
      p.histIdx = Math.max(0, p.histIdx - 1);
      p.input.value = p.history[p.histIdx];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      p.histIdx = Math.min(p.history.length, p.histIdx + 1);
      p.input.value = p.histIdx >= p.history.length ? "" : p.history[p.histIdx];
    }
  });
  p.root.addEventListener("click", () => {
    highlight(ctx);
    p.input.focus();
  });
});

// Welcome lines
append(
  "pi",
  "line-meta",
  "Pi FreeBSD (ue0 WAN / ue1 LAN)\nDigite aqui ou use o guia → Executar"
);
append(
  "lan",
  "line-meta",
  "Host LAN 172.16.0.10\nEx.: ping, curl, nc -lk 8080"
);
append(
  "wan",
  "line-meta",
  "Host WAN 192.168.1.17\nEx.: telnet 192.168.1.31 80, rota forçada"
);

renderGuide();
panes.pi.input.focus();
