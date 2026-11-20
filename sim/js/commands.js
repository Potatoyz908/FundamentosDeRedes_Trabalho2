import { state, CFG, resetState, setCtx, pushCapture, drainCapture } from "./state.js";

function ok(text) {
  return { ok: true, text: text ?? "" };
}
function err(text) {
  return { ok: false, text };
}

const DEMO = `Roteiro D0–D7 — use o guia no topo ou digite em cada painel (pi/lan/wan ficam abertos juntos).

D0  [pi]  ifconfig ue0 ; ifconfig ue1 ; sysctl net.inet.ip.forwarding
D1  [pi]  netstat -rn -f inet ; pfctl -sn ; pfctl -sr
D2  [lan] dhclient ; ip -4 addr
      [pi]  cat /var/db/dnsmasq.leases
D3  [lan] ping -c3 172.16.0.1 ; curl -sI http://example.com ; traceroute -n 8.8.8.8
D4  [pi]  tcpdump -ni ue1 tcp port 80
      [lan] curl -sI http://example.com
      [pi]  pfctl -ss | grep :80
D5  [wan] rota forçada + ping/nc à LAN ; [pi] contador block ue0
D6  [lan] nc -lk 8080 ; [wan] telnet 192.168.1.31 80 ; [pi] pfctl -ss | grep 8080
D7  [lan] ping gateway ok / 8.8.8.8 falha ; [pi] pflog + contador icmp`;

const HELP = `Comandos meta (em qualquer painel):
  demo             roteiro D0–D7
  reset            reinicia o estado do lab
  clear            limpa este painel
  help             esta ajuda

Pi: ifconfig, sysctl, netstat, service, pfctl, tcpdump, sockstat, leases/log dnsmasq
LAN: ip, ping, curl, traceroute, nc -lk 8080, dhclient
WAN: ping, ip route add|del, nc / telnet, nc -vz

O guia no topo explica Kurose (Cap. 4 / 5.7 / 8.9) e executa no terminal certo.`;

function normalize(raw) {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^sudo\s+(-n\s+)?/, "");
}

function stripPipes(cmd) {
  // Support simple trailing pipes used in the lab
  const parts = cmd.split("|").map((p) => p.trim());
  return { base: parts[0], pipes: parts.slice(1) };
}

function applyPipes(text, pipes) {
  let out = text;
  for (const p of pipes) {
    if (p.startsWith("head")) {
      const n = parseInt((p.match(/-(\d+)/) || [])[1] || "10", 10);
      out = out.split("\n").slice(0, n).join("\n");
    } else if (p.startsWith("tail")) {
      const n = parseInt((p.match(/-(\d+)/) || [])[1] || "10", 10);
      const m = p.match(/tail\s+-(\d+)/) || p.match(/\|?\s*tail$/);
      const count = m && m[1] ? parseInt(m[1], 10) : n;
      out = out.split("\n").filter(Boolean).slice(-count).join("\n");
    } else if (p.startsWith("grep")) {
      const m = p.match(/grep\s+(?:-E\s+)?"?([^"]+)"?/) || p.match(/grep\s+(\S+)/);
      if (m) {
        let pat = m[1].replace(/^"|"$/g, "");
        // common lab patterns
        if (pat.includes("DHCP")) {
          out = out
            .split("\n")
            .filter((l) => /DHCP(DISCOVER|OFFER|REQUEST|ACK)/.test(l))
            .join("\n");
        } else if (pat.includes(":80")) {
          out = out.split("\n").filter((l) => l.includes(":80")).join("\n");
        } else if (pat.includes("8080")) {
          out = out.split("\n").filter((l) => l.includes("8080")).join("\n");
        } else if (pat.includes("block drop in on ue0")) {
          out = out.split("\n").filter((l) => l.includes("block drop in on ue0") || l.includes("Evaluations")).join("\n");
          // keep rule + next stats line handled by -A1 in original; our pfctl -vs already formats
        } else if (pat.includes("icmp-type echoreq")) {
          out = out
            .split("\n")
            .filter((l) => l.includes("icmp-type echoreq") || l.includes("Evaluations"))
            .join("\n");
        } else if (pat.includes(":67")) {
          out = out.split("\n").filter((l) => l.includes(":67")).join("\n");
        } else {
          const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          out = out.split("\n").filter((l) => re.test(l)).join("\n");
        }
      }
    } else if (p.startsWith("grep -c") || /^grep\s+-c/.test(p)) {
      const lines = out.split("\n").filter((l) => l.includes(":67"));
      out = String(lines.length);
    }
  }
  return out;
}

/* ---------- Pi handlers ---------- */

function ifconfig(args) {
  const which = args[0] || "";
  const ue0 = `ue0: flags=1008843<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST,LOWER_UP> metric 0 mtu 1500
        inet ${CFG.ipWan} netmask 0xffffff00 broadcast 192.168.1.255
        status: active`;
  const ue1 = `ue1: flags=1008843<UP,BROADCAST,RUNNING,SIMPLEX,MULTICAST,LOWER_UP> metric 0 mtu 1500
        inet ${CFG.ipLanGw} netmask 0xffff0000 broadcast 172.16.255.255
        status: active`;
  if (which === "ue0") return ok(ue0);
  if (which === "ue1") return ok(ue1);
  return ok(`${ue0}\n${ue1}`);
}

function serviceCmd(args) {
  const name = args[0];
  const action = args[1] || "status";
  const map = {
    dnsmasq: state.dnsmasq,
    pf: state.pf,
    pflog: state.pflog,
    sshd: state.sshd,
  };
  const svc = map[name];
  if (!svc) return err(`service: unknown service: ${name}`);

  if (action === "status") {
    if (name === "pf") {
      return ok(
        state.pf.up
          ? "Status: Enabled for 0 days 01:22:36           Debug: Urgent"
          : "pf is disabled"
      );
    }
    if (svc.up) return ok(`${name} is running as pid ${svc.pid || 1000}.`);
    return ok(`${name} is not running.`);
  }
  if (action === "stop") {
    if (name === "dnsmasq") {
      if (!state.dnsmasq.up) return ok("dnsmasq is not running.");
      const pid = state.dnsmasq.pid;
      state.dnsmasq.up = false;
      return ok(
        `Performing sanity check on dnsmasq configuration.\ndnsmasq: syntax check OK.\nStopping dnsmasq.\nWaiting for PIDS: ${pid}.`
      );
    }
    if (name === "pflog") {
      state.pflog.up = false;
      return ok("Stopping pflog.");
    }
    svc.up = false;
    return ok(`Stopping ${name}.`);
  }
  if (action === "start" || action === "onestart") {
    if (name === "dnsmasq") {
      state.dnsmasq.up = true;
      state.dnsmasq.pid = 3787;
      return ok("Starting dnsmasq.");
    }
    if (name === "pflog") {
      state.pflog.up = true;
      state.pflog.pid = 1654;
      return ok("Starting pflog.");
    }
    svc.up = true;
    return ok(`Starting ${name}.`);
  }
  return err(`service: unknown action: ${action}`);
}

function pfctl(args) {
  const joined = args.join(" ");
  if (!state.pf.up && !joined.includes("-e") && !joined.includes("-nf")) {
    return err("pfctl: /dev/pf: No such file or directory");
  }

  if (joined.includes("-nf")) return ok(""); // silent success like pfctl -nf
  if (joined.trim() === "-f /etc/pf.conf" || joined.startsWith("-f ")) {
    return ok("");
  }
  if (joined.includes("-sn") && !joined.includes("-sr")) {
    return ok(
      `nat on ue0 inet from 172.16.0.0/16 to any -> (ue0) round-robin\nrdr on ue0 inet proto tcp from any to (ue0) port = http tag DNAT_TESTE -> 172.16.10.111 port 8080`
    );
  }
  if (joined.includes("-sr") && !joined.includes("-sn")) {
    return ok(`scrub in all fragment reassemble
block drop in log quick on ue1 inet proto icmp from 172.16.0.0/16 to ! 172.16.0.0/16 icmp-type echoreq
pass in on ue1 all flags S/SA keep state
pass out on ue1 all flags S/SA keep state
block drop in on ue0 all
pass in on ue0 inet proto tcp from any to (ue0) port = ssh flags S/SA keep state
pass in on ue0 inet proto tcp all flags S/SA keep state tagged DNAT_TESTE
pass in on ue0 inet proto udp from any port = bootps to any port = bootpc keep state
pass in on ue0 inet proto icmp from any to (ue0) icmp-type echoreq keep state
pass out on ue0 all flags S/SA keep state`);
  }
  if (joined.includes("-sn") || (args.includes("-sn") && args.includes("-sr"))) {
    return ok(`nat on ue0 inet from 172.16.0.0/16 to any -> (ue0) round-robin
rdr on ue0 inet proto tcp from any to (ue0) port = http tag DNAT_TESTE -> 172.16.10.111 port 8080
scrub in all fragment reassemble
block drop in log quick on ue1 inet proto icmp from 172.16.0.0/16 to ! 172.16.0.0/16 icmp-type echoreq
pass in on ue1 all flags S/SA keep state
pass out on ue1 all flags S/SA keep state
block drop in on ue0 all
pass in on ue0 inet proto tcp from any to (ue0) port = ssh flags S/SA keep state
pass in on ue0 inet proto tcp all flags S/SA keep state tagged DNAT_TESTE
pass in on ue0 inet proto udp from any port = bootps to any port = bootpc keep state
pass in on ue0 inet proto icmp from any to (ue0) icmp-type echoreq keep state
pass out on ue0 all flags S/SA keep state`);
  }

  if (joined.includes("-ss")) {
    const lines = [];
    if (state.natSession) {
      const n = state.natSession;
      lines.push(`all tcp ${CFG.exampleIp}:80 <- ${CFG.ipLanHost}:${n.lanPort}       FIN_WAIT_2:FIN_WAIT_2`);
      lines.push(
        `all tcp ${CFG.ipWan}:${n.wanPort} (${CFG.ipLanHost}:${n.lanPort}) -> ${CFG.exampleIp}:80       FIN_WAIT_2:FIN_WAIT_2`
      );
    }
    if (state.dnatSession) {
      const d = state.dnatSession;
      lines.push(
        `all tcp ${CFG.ipLanHost}:8080 (${CFG.ipWan}:80) <- ${CFG.ipWanHost}:${d.srcPort}       ESTABLISHED:ESTABLISHED`
      );
      lines.push(
        `all tcp ${CFG.ipWanHost}:${d.srcPort} -> ${CFG.ipLanHost}:8080       ESTABLISHED:ESTABLISHED`
      );
    }
    if (!lines.length) return ok("");
    return ok(lines.join("\n"));
  }

  if (joined.includes("-vs") || joined.includes("-v") && joined.includes("rules")) {
    return ok(`No ALTQ support in kernel
ALTQ related functions disabled
block drop in log quick on ue1 inet proto icmp from 172.16.0.0/16 to ! 172.16.0.0/16 icmp-type echoreq
  [ Evaluations: ${state.icmpEvals}     Packets: ${state.icmpPackets}        Bytes: ${state.icmpPackets * 84}        States: 0     ]
pass in on ue1 all flags S/SA keep state
pass out on ue1 all flags S/SA keep state
block drop in on ue0 all
  [ Evaluations: ${state.blockUe0Evals}     Packets: ${state.blockUe0Packets}       Bytes: ${state.blockUe0Bytes}      States: 0     ]
pass in on ue0 inet proto tcp from any to (ue0) port = ssh flags S/SA keep state
pass in on ue0 inet proto tcp all flags S/SA keep state tagged DNAT_TESTE
pass in on ue0 inet proto udp from any port = bootps to any port = bootpc keep state
pass in on ue0 inet proto icmp from any to (ue0) icmp-type echoreq keep state
pass out on ue0 all flags S/SA keep state`);
  }

  if (joined.includes("-s info") || joined === "-s info") {
    return ok(`Status: Enabled for 0 days 01:22:36           Debug: Urgent
State Table                          Total             Rate
  current entries                      12               
  searches                         184422           36.2/s`);
  }

  return err("pfctl: use -sn, -sr, -ss, -vs rules, -nf, -f /etc/pf.conf (simulador)");
}

function tcpdump(args) {
  const joined = args.join(" ");
  let iface = "ue0";
  if (joined.includes("pflog0") || joined.includes("-i pflog0")) iface = "pflog0";
  else if (joined.includes("ue1")) iface = "ue1";
  else if (joined.includes("ue0")) iface = "ue0";

  if (iface === "pflog0" && !state.pflog.up) {
    return err("tcpdump: pflog0: No such device exists (start with: service pflog onestart)");
  }

  state.capture[iface === "pflog0" ? "pflog0" : iface] = true;
  const drained = drainCapture(iface === "pflog0" ? "pflog0" : iface);
  const tip =
    iface === "pflog0"
      ? `(captura pflog0 ativa — rode ping 8.8.8.8 na LAN; Ctrl+C simulado: digite 'tcpdump stop')`
      : `(captura ${iface} ativa — rode curl na LAN; digite 'tcpdump stop' para encerrar)`;
  if (drained) return ok(`${drained}\ntcpdump: ${tip}`);
  return ok(`tcpdump: listening on ${iface}, link-type NULL\n${tip}`);
}

function stopCapture() {
  state.capture.ue0 = false;
  state.capture.ue1 = false;
  state.capture.pflog0 = false;
  return ok("tcpdump: stopped.");
}

function sockstat(args) {
  const joined = args.join(" ");
  if (!state.dnsmasq.up) return ok("");
  const line = `nobody dnsmasq    ${state.dnsmasq.pid}  4 udp4  *:67                  *:*`;
  if (joined.includes("-4l") || joined.includes("-4")) return ok(line);
  return ok(line);
}

function triggerNatCapture() {
  const lanPort = 34040;
  const wanPort = 56076;
  state.natSession = { lanPort, wanPort };
  const lanLines = `16:23:47.733094 IP ${CFG.ipLanHost}.${lanPort} > ${CFG.exampleIp}.80: Flags [S], seq 1378516670, win 64240, options [mss 1460,sackOK,TS val 3617334572 ecr 0,nop,wscale 10], length 0
16:23:47.754395 IP ${CFG.exampleIp}.80 > ${CFG.ipLanHost}.${lanPort}: Flags [S.], seq 1640755493, ack 1378516671, win 65535, options [mss 1400,sackOK,TS val 2512155803 ecr 3617334572,nop,wscale 13], length 0
16:23:47.754837 IP ${CFG.ipLanHost}.${lanPort} > ${CFG.exampleIp}.80: Flags [.], ack 1, win 63, options [nop,nop,TS val 3617334594 ecr 2512155803], length 0
16:23:47.754868 IP ${CFG.ipLanHost}.${lanPort} > ${CFG.exampleIp}.80: Flags [P.], seq 1:76, ack 1, win 63, options [nop,nop,TS val 3617334594 ecr 2512155803], length 75: HTTP: GET / HTTP/1.1`;
  const wanLines = `16:23:47.733243 IP ${CFG.ipWan}.${wanPort} > ${CFG.exampleIp}.80: Flags [S], seq 1378516670, win 64240, options [mss 1460,sackOK,TS val 3617334572 ecr 0,nop,wscale 10], length 0
16:23:47.754334 IP ${CFG.exampleIp}.80 > ${CFG.ipWan}.${wanPort}: Flags [S.], seq 1640755493, ack 1378516671, win 65535, options [mss 1400,sackOK,TS val 2512155803 ecr 3617334572,nop,wscale 13], length 0
16:23:47.754897 IP ${CFG.ipWan}.${wanPort} > ${CFG.exampleIp}.80: Flags [.], ack 1, win 63, options [nop,nop,TS val 3617334594 ecr 2512155803], length 0
16:23:47.754904 IP ${CFG.ipWan}.${wanPort} > ${CFG.exampleIp}.80: Flags [P.], seq 1:76, ack 1, win 63, options [nop,nop,TS val 3617334594 ecr 2512155803], length 75: HTTP: GET / HTTP/1.1`;
  if (state.capture.ue1) {
    lanLines.split("\n").forEach(pushCapture);
  }
  if (state.capture.ue0) {
    wanLines.split("\n").forEach(pushCapture);
  }
  return { lanLines, wanLines };
}

function renewDhcp() {
  const id = Math.floor(Math.random() * 2e9);
  const ts = "Nov 14 16:30:00";
  state.dhcpLog.push(
    `${ts} dnsmasq-dhcp[${state.dnsmasq.pid}]: ${id} DHCPREQUEST(ue1) 172.16.10.111 ${CFG.macHost}`
  );
  state.dhcpLog.push(
    `${ts} dnsmasq-dhcp[${state.dnsmasq.pid}]: ${id} DHCPACK(ue1) 172.16.10.111 ${CFG.macHost} host-avaliacao`
  );
}

function handlePi(cmd) {
  if (cmd === "tcpdump stop" || cmd === "q") return stopCapture();

  // chained with ;
  if (cmd.includes(";") && !cmd.includes("grep -E")) {
    const parts = cmd.split(";").map((p) => p.trim()).filter(Boolean);
    const outs = [];
    for (const p of parts) {
      const r = handlePi(p);
      if (r.text) outs.push(r.text);
      if (!r.ok && !r.text) outs.push(r.text);
    }
    return ok(outs.filter(Boolean).join("\n"));
  }

  const { base, pipes } = stripPipes(cmd);
  const tokens = base.split(" ");
  const bin = tokens[0];
  const args = tokens.slice(1);

  let res;
  if (bin === "ifconfig") res = ifconfig(args);
  else if (bin === "sysctl") {
    if (args[0] === "net.inet.ip.forwarding") res = ok("net.inet.ip.forwarding: 1");
    else res = err(`sysctl: unknown oid '${args[0]}'`);
  } else if (bin === "netstat") {
    res = ok(`Routing tables

Internet:
Destination        Gateway            Flags         Netif Expire
default            ${CFG.gwWan}      UGS             ue0
127.0.0.1          link#1             UH              lo0
172.16.0.0/16      link#3             U               ue1
172.16.0.1         link#1             UHS             lo0
192.168.1.0/24     link#2             U               ue0
${CFG.ipWan}         link#1             UHS             lo0`);
  } else if (bin === "service") res = serviceCmd(args);
  else if (bin === "pfctl") res = pfctl(args);
  else if (bin === "tcpdump") res = tcpdump(args);
  else if (bin === "sockstat") res = sockstat(args);
  else if (bin === "cat" && args.join(" ").includes("dnsmasq.leases")) {
    res = ok(`0 ${CFG.macHost} ${CFG.ipLanHost} host-avaliacao 01:${CFG.macHost}`);
  } else if (bin === "grep") {
    if (cmd.includes("dnsmasq.log") || args.join(" ").includes("dnsmasq")) {
      res = ok(state.dhcpLog.join("\n"));
    } else {
      res = err("grep: use com /var/log/dnsmasq.log (ex. no demo D2)");
    }
  } else if (bin === "echo") {
    res = ok(args.join(" ").replace(/^["']|["']$/g, ""));
  } else if (bin === "dnsmasq") {
    res = ok("dnsmasq: syntax check OK.");
  } else if (bin === "sh" && args[0] === "-n") {
    res = ok("");
  } else if (bin === "freebsd-version") {
    res = ok("15.1-RELEASE");
  } else {
    return err(`comando não simulado na Pi: ${bin}\nDigite demo ou help.`);
  }

  if (pipes.length && res.ok) {
    const pipeStr = pipes.join(" ");
    // special: grep on pfctl -vs already returns full rules; pipe filters
    if (/block.*ue0|ue0 all/.test(pipeStr)) {
      res = ok(
        `block drop in on ue0 all\n  [ Evaluations: ${state.blockUe0Evals}     Packets: ${state.blockUe0Packets}       Bytes: ${state.blockUe0Bytes}      States: 0     ]`
      );
    } else if (/icmp-type|echoreq/.test(pipeStr)) {
      res = ok(
        `block drop in log quick on ue1 inet proto icmp from 172.16.0.0/16 to ! 172.16.0.0/16 icmp-type echoreq\n  [ Evaluations: ${state.icmpEvals}     Packets: ${state.icmpPackets}        Bytes: ${state.icmpPackets * 84}        States: 0     ]`
      );
    } else if (/grep\s+-c|:67/.test(pipeStr) && pipeStr.includes("-c")) {
      res = ok(state.dnsmasq.up ? "1" : "0");
    } else if (pipeStr.includes(":67")) {
      res = ok(state.dnsmasq.up ? `nobody dnsmasq    ${state.dnsmasq.pid}  4 udp4  *:67                  *:*` : "");
    } else {
      res = ok(applyPipes(res.text, pipes));
    }
  }

  // show capture buffer if tcpdump was listening
  if (state.capture.ue0 || state.capture.ue1 || state.capture.pflog0) {
    const iface = state.capture.pflog0 ? "pflog0" : state.capture.ue1 ? "ue1" : "ue0";
    const extra = drainCapture(iface);
    if (extra) res = ok((res.text ? res.text + "\n" : "") + extra);
  }

  return res;
}

/* ---------- LAN handlers ---------- */

function handleLan(cmd) {
  if (cmd.includes(";")) {
    const parts = cmd.split(";").map((p) => p.trim()).filter(Boolean);
    return ok(parts.map((p) => handleLan(p).text).filter(Boolean).join("\n"));
  }

  const { base, pipes } = stripPipes(cmd);
  const tokens = base.split(" ");
  const bin = tokens[0];

  if (bin === "ip") {
    const rest = tokens.slice(1).join(" ");
    if (rest.includes("addr")) {
      return ok(
        `2: enp44s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet ${CFG.ipLanHost}/16 brd 172.16.255.255 scope global noprefixroute enp44s0`
      );
    }
    if (rest.includes("route")) {
      return ok(
        `default via ${CFG.ipLanGw} dev enp44s0 proto dhcp src ${CFG.ipLanHost} metric 20100`
      );
    }
  }

  if (bin === "resolvectl" || (bin === "resolvectl" && tokens[1] === "dns")) {
    return ok(`Link 2 (enp44s0): ${CFG.dns1} ${CFG.dns2}`);
  }

  if (bin === "ipconfig") {
    return ok(
      `Ethernet adapter LAN:\n\n   IPv4 Address. . . . . . . . . . . : ${CFG.ipLanHost}\n   Subnet Mask . . . . . . . . . . . : 255.255.0.0\n   Default Gateway . . . . . . . . . : ${CFG.ipLanGw}\n   DNS Servers . . . . . . . . . . . : ${CFG.dns1}\n                                       ${CFG.dns2}`
    );
  }

  if (bin === "dhclient" || bin === "nmcli" || (bin === "ipconfig" && tokens[1] === "/renew")) {
    renewDhcp();
    return ok(`renovacao:\n${CFG.ipLanHost}/16\ndefault via ${CFG.ipLanGw}`);
  }

  if (bin === "ping") {
    const target = tokens.find((t) => /^\d+\.\d+\.\d+\.\d+$/.test(t)) || "";
    if (target === CFG.ipLanGw || target === "172.16.0.1") {
      return ok(`PING ${CFG.ipLanGw} (${CFG.ipLanGw}) 56(84) bytes of data.
64 bytes from ${CFG.ipLanGw}: icmp_seq=1 ttl=64 time=0.455 ms
64 bytes from ${CFG.ipLanGw}: icmp_seq=2 ttl=64 time=0.351 ms
64 bytes from ${CFG.ipLanGw}: icmp_seq=3 ttl=64 time=0.632 ms

--- ${CFG.ipLanGw} ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 2069ms
rtt min/avg/max/mdev = 0.351/0.479/0.632/0.116 ms`);
    }
    if (target === "8.8.8.8" || target.startsWith("8.8.")) {
      state.icmpPackets += 3;
      state.icmpEvals += 3;
      for (let i = 1; i <= 3; i++) {
        pushCapture(
          ` 00:00:0${i - 1}.000000 rule 0/0(match): block in on ue1: ${CFG.ipLanHost} > 8.8.8.8: ICMP echo request, id 58122, seq ${i}, length 64`
        );
      }
      return ok(`PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.

--- 8.8.8.8 ping statistics ---
3 packets transmitted, 0 received, 100% packet loss, time 2045ms`);
    }
    return err(`ping: destino não simulado: ${target}`);
  }

  if (bin === "curl") {
    triggerNatCapture();
    let out = "HTTP/1.1 200 OK";
    if (pipes.length) out = applyPipes(out + "\nServer: cloudflare\nContent-Type: text/html", pipes);
    const cap = [];
    if (state.capture.ue1) cap.push(drainCapture("ue1") || "(pacotes em ue1 — veja também tcpdump na Pi)");
    if (state.capture.ue0) cap.push(drainCapture("ue0"));
    const extra = cap.filter(Boolean).join("\n");
    return ok(extra ? `${out}\n\n[captura Pi]\n${extra}` : out);
  }

  if (bin === "traceroute" || bin === "tracert") {
    return ok(`traceroute to 8.8.8.8 (8.8.8.8), 3 hops max, 60 byte packets
 1  ${CFG.ipLanGw}  0.720 ms  0.686 ms  0.679 ms
 2  ${CFG.gwWan}  1.408 ms  1.520 ms  1.768 ms
 3  172.20.0.1  5.382 ms  5.256 ms  5.491 ms`);
  }

  if (bin === "nc" || bin === "ncat") {
    if (tokens.includes("-lk") || tokens.includes("-l")) {
      state.lanNc8080 = true;
      if (state.dnatSession) {
        return ok(`ola da WAN\n(servidor escutando em 8080 — digite texto; na WAN use telnet ${CFG.ipWan} 80)\nola da LAN`);
      }
      return ok(`(escutando em 8080 — na WAN: telnet ${CFG.ipWan} 80)\n(Ctrl+C simulado: nc stop)`);
    }
    if (tokens.includes("stop")) {
      state.lanNc8080 = false;
      state.dnatSession = null;
      return ok("nc: stopped.");
    }
  }

  if (bin === "nc" && tokens.includes("stop")) {
    state.lanNc8080 = false;
    return ok("nc: stopped.");
  }

  return err(`comando não simulado na LAN: ${bin}\nDigite demo ou help.`);
}

/* ---------- WAN handlers ---------- */

function handleWan(cmd) {
  const cleaned = normalize(cmd);
  if (cleaned.includes(";")) {
    const parts = cleaned.split(";").map((p) => p.trim()).filter(Boolean);
    return ok(parts.map((p) => handleWan(p).text).filter(Boolean).join("\n"));
  }

  const tokens = cleaned.split(" ");
  const bin = tokens[0];

  if (bin === "ip" && tokens[1] === "route") {
    if (tokens[2] === "add" && tokens.join(" ").includes("172.16.0.0/16")) {
      state.wanForcedRoute = true;
      return ok("");
    }
    if (tokens[2] === "del" && tokens.join(" ").includes("172.16.0.0/16")) {
      state.wanForcedRoute = false;
      return ok("");
    }
  }

  if (bin === "ping") {
    const target = tokens.find((t) => /^\d+\.\d+\.\d+\.\d+$/.test(t)) || "";
    if (target === CFG.ipLanHost || target === "172.16.10.111") {
      if (state.wanForcedRoute) {
        state.blockUe0Packets += 3;
        state.blockUe0Evals += 6;
        state.blockUe0Bytes += 432;
      }
      return ok(`PING ${CFG.ipLanHost} (${CFG.ipLanHost}) 56(84) bytes of data.

--- ${CFG.ipLanHost} ping statistics ---
3 packets transmitted, 0 received, 100% packet loss, time 2049ms`);
    }
    if (target === CFG.ipWan) {
      return ok(`PING ${CFG.ipWan} (${CFG.ipWan}) 56(84) bytes of data.
64 bytes from ${CFG.ipWan}: icmp_seq=1 ttl=64 time=0.8 ms

--- ${CFG.ipWan} ping statistics ---
3 packets transmitted, 3 received, 0% packet loss`);
    }
  }

  if (bin === "nc" || bin === "ncat" || bin === "telnet") {
    const joined = tokens.join(" ");
    // nc -vz host port
    if (tokens.includes("-vz") || tokens.includes("-z")) {
      const host = tokens.find((t) => /^\d+\.\d+\.\d+\.\d+$/.test(t));
      const port = tokens.filter((t) => /^\d+$/.test(t)).pop();
      if (host === CFG.ipLanHost && port === "8080") {
        if (state.wanForcedRoute) {
          state.blockUe0Packets += 2;
          state.blockUe0Evals += 2;
          state.blockUe0Bytes += 120;
        }
        return ok(
          `nc: connect to ${CFG.ipLanHost} port 8080 (tcp) timed out: Operation now in progress`
        );
      }
      if (host === CFG.ipWan && port === "22") {
        return ok(`Connection to ${CFG.ipWan} 22 port [tcp/ssh] succeeded!`);
      }
      if (host === CFG.ipWan && (port === "53" || port === "443" || port === "8080")) {
        return ok(`nc: connect to ${CFG.ipWan} port ${port} (tcp) timed out`);
      }
    }

    // telnet / nc to WAN:80 → DNAT
    if (
      joined.includes(`${CFG.ipWan} 80`) ||
      joined.includes(`${CFG.ipWan}:80`) ||
      (bin === "telnet" && tokens.includes(CFG.ipWan) && tokens.includes("80")) ||
      (bin === "nc" && tokens.includes(CFG.ipWan) && tokens.includes("80"))
    ) {
      if (!state.lanNc8080) {
        return err(
          `Trying ${CFG.ipWan}...\nConnected.\n(mas não há nc -lk 8080 na LAN — inicie antes)`
        );
      }
      const srcPort = 33054;
      state.dnatSession = { srcPort };
      return ok(`Trying ${CFG.ipWan}...
Connected to ${CFG.ipWan}.
Escape character is '^]'.
ola da WAN
ola da LAN
Connection closed.`);
    }
  }

  return err(`comando não simulado na WAN: ${bin}\nDigite demo ou help.`);
}

/* ---------- public API ---------- */

function runInCtx(line) {
  const n = normalize(line);
  if (state.ctx === "pi") return handlePi(n);
  if (state.ctx === "lan") return handleLan(n);
  return handleWan(n);
}

export function dispatch(raw) {
  const line = raw.trim();
  if (!line) return { kind: "empty" };

  const low = line.toLowerCase();

  if (low === "help") return { kind: "out", text: HELP };
  if (low === "demo") return { kind: "out", text: DEMO };
  if (low === "reset") {
    const ctx = state.ctx;
    resetState();
    setCtx(ctx);
    return { kind: "meta", text: "Estado do lab reiniciado.", ctx };
  }
  if (low === "clear") return { kind: "clear" };
  if (low === "pi" || low === "lan" || low === "wan") {
    setCtx(low);
    return { kind: "ctx", ctx: low, text: `contexto → ${low}` };
  }

  // Encadeamento simples com &&
  if (line.includes("&&")) {
    const parts = line.split("&&").map((p) => p.trim()).filter(Boolean);
    const outs = [];
    for (const p of parts) {
      const r = runInCtx(p);
      if (r.text) outs.push(r.text);
      else if (p.startsWith("echo ")) outs.push(p.slice(5).replace(/^["']|["']$/g, ""));
      if (!r.ok && !p.startsWith("echo ")) {
        return { kind: "err", text: outs.filter(Boolean).join("\n") || r.text, ctx: state.ctx };
      }
    }
    return { kind: "out", text: outs.filter(Boolean).join("\n"), ctx: state.ctx };
  }

  const result = runInCtx(line);

  return {
    kind: result.ok ? "out" : "err",
    text: result.text,
    ctx: state.ctx,
  };
}

export function getPrompt() {
  return state.ctx === "pi" ? "[pi]#" : `[${state.ctx}]$`;
}

export function getCtx() {
  return state.ctx;
}
