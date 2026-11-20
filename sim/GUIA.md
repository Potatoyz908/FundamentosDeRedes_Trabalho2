# Guia passo a passo — lab + Kurose (6ª ed.)

No [simulador](index.html):

- **Três terminais** (pi / lan / wan) ocupam a maior parte da tela.
- **Guia à esquerda** com quatro blocos por passo:
  1. **No lab — por que este comando**
  2. **Kurose — conceito e funcionamento**
  3. **Fluxo neste passo**
  4. **O que observar / narrar**

Use **Executar** para rodar no painel destacado.

IPs das evidências: Pi WAN `192.168.1.31`, LAN `172.16.10.111`, WAN host `192.168.1.17`.

O texto completo de cada passo vive em [`js/guide.js`](js/guide.js) (fonte do painel). Resumo por etapa:

---

## D0 · Pré-checagem

| Passo | Comando | Kurose (eixo) |
| --- | --- | --- |
| Interfaces | `ifconfig ue0 ; ue1` | Cap. 4 — roteador em cada enlace; RFC 1918 |
| Forwarding | `sysctl …forwarding` | Cap. 4.1.1 — repasse vs roteamento |
| Serviços | `service pf/pflog/dnsmasq` | Cap. 8.9 firewall + Cap. 4.4 DHCP |
| Validar | `pfctl -nf` / `dnsmasq --test` | Política de borda antes de aplicar |

## D1 · Roteador

| Passo | Comando | Kurose |
| --- | --- | --- |
| Rotas | `netstat -rn` | Tabela de repasse + default |
| pf | `pfctl -sn/-sr` | NAT 4.4 + filtro 8.9 + rdr (travessia) |

## D2 · DHCP

DORA (Discover→Offer→Request→Ack), UDP 67/68, lease, opções router/DNS — Cap. 4.4 e 5.7.1.  
Reserva MAC→`.10` no leases e no log.

## D3 · Conectividade

Ping = ICMP echo (4.4.3). Curl = HTTP+TCP+NAT. Traceroute = TTL + Time Exceeded (sem `-I`).

## D4 · NAT

Figura 4.22: origem privada → IP WAN + tabela `(WAN,porta)↔(LAN,porta)` vista em `pfctl -ss`.

## D5 · Isolamento

Cap. 8.9: NAT ≠ firewall. Rota forçada + `block in on ue0` + drop (timeout). Contador Packets sobe.

## D6 · DNAT (Pedro)

Troca de **destino** (80→8080); tag/tagged; estado ESTABLISHED — abertura/travessia Cap. 4.4.

## D7 · Ping (Pedro)

Echo request tipo 8; filtro por tipo ICMP + `to ! rede_lan`; TCP segue; pflog registra.

## Extra

stop/start dnsmasq e porta UDP 67 — sem demônio não há DORA.

---

## Frases curtas (banca)

| Tema | Frase |
| --- | --- |
| Repasse | IF→IF com `forwarding=1` (Cap. 4.1.1). |
| NAT | Troca **origem** + tabela (Cap. 4.4). |
| DNAT | Troca **destino** / porta publicada. |
| Isolamento | `block` na WAN (Cap. 8.9); NAT não basta. |
| Ping | Só `echoreq` para fora; gateway e TCP ok. |
| DHCP | DORA + lease (Cap. 4.4 / 5.7.1). |
