/** Estado compartilhado do lab simulado (evidências 14/11/2026). */

export const CFG = {
  ipWan: "192.168.1.31",
  gwWan: "192.168.1.254",
  ipLanGw: "172.16.0.1",
  ipLanHost: "172.16.10.111",
  ipWanHost: "192.168.1.17",
  macHost: "0c:cc:47:ec:09:6b",
  dns1: "164.41.101.4",
  dns2: "164.41.101.11",
  exampleIp: "104.20.23.154",
};

function initial() {
  return {
    ctx: "pi",
    dnsmasq: { up: true, pid: 2995 },
    pf: { up: true },
    pflog: { up: true, pid: 1654 },
    sshd: { up: true },
    blockUe0Packets: 878,
    blockUe0Evals: 32252,
    blockUe0Bytes: 240815,
    icmpPackets: 10,
    icmpEvals: 31040,
    natSession: null,
    dnatSession: null,
    lanNc8080: false,
    wanForcedRoute: false,
    capture: { ue0: false, ue1: false, pflog0: false },
    captureBuf: [],
    dhcpLog: [
      "Nov 14 15:53:11 dnsmasq-dhcp[2359]: 596981920 DHCPREQUEST(ue1) 172.16.10.111 0c:cc:47:ec:09:6b",
      "Nov 14 15:53:11 dnsmasq-dhcp[2359]: 596981920 DHCPACK(ue1) 172.16.10.111 0c:cc:47:ec:09:6b host-avaliacao",
      "Nov 14 16:24:25 dnsmasq-dhcp[2995]: 373266007 DHCPREQUEST(ue1) 172.16.10.111 0c:cc:47:ec:09:6b",
      "Nov 14 16:24:25 dnsmasq-dhcp[2995]: 373266007 DHCPACK(ue1) 172.16.10.111 0c:cc:47:ec:09:6b host-avaliacao",
      "Nov 14 16:24:30 dnsmasq-dhcp[2995]: 2069641094 DHCPREQUEST(ue1) 172.16.10.111 0c:cc:47:ec:09:6b",
      "Nov 14 16:24:30 dnsmasq-dhcp[2995]: 2069641094 DHCPACK(ue1) 172.16.10.111 0c:cc:47:ec:09:6b host-avaliacao",
      "Nov 14 16:24:35 dnsmasq-dhcp[2995]: 344580715 DHCPREQUEST(ue1) 172.16.10.111 0c:cc:47:ec:09:6b",
      "Nov 14 16:24:35 dnsmasq-dhcp[2995]: 344580715 DHCPACK(ue1) 172.16.10.111 0c:cc:47:ec:09:6b host-avaliacao",
    ],
  };
}

export let state = initial();

export function resetState() {
  state = initial();
  return state;
}

export function setCtx(ctx) {
  if (!["pi", "lan", "wan"].includes(ctx)) return false;
  state.ctx = ctx;
  return true;
}

export function pushCapture(line) {
  state.captureBuf.push(line);
  if (state.captureBuf.length > 40) state.captureBuf.shift();
}

export function drainCapture(iface) {
  if (!state.capture[iface]) return "";
  const lines = state.captureBuf.splice(0);
  return lines.join("\n");
}
