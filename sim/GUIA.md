# Guia passo a passo — o que cada comando prova

Use junto com o [simulador](index.html): painel **Guia** → **Preencher** / **Executar**.  
Contextos: **pi** (FreeBSD), **lan** (`172.16.0.10`), **wan** (`192.168.1.17`).  
IPs das evidências: Pi WAN `192.168.1.31`, gateway `192.168.1.254`.

---

## D0 · Pré-checagem

### 1. `ifconfig ue0 ; ifconfig ue1` — [pi]

**Por quê:** a Pi só é roteador se tiver duas interfaces.  
**Observe:** `ue0` = `192.168.1.31/24` (WAN); `ue1` = `172.16.0.1/16` (LAN).

### 2. `sysctl net.inet.ip.forwarding` — [pi]

**Por quê:** repasse (plano de dados). Sem `1`, a LAN fala só com a Pi.  
**Observe:** `net.inet.ip.forwarding: 1` (ligado por `gateway_enable="YES"`).

### 3. `service pf status ; service pflog status ; service dnsmasq status` — [pi]

**Por quê:** pf = firewall/NAT/DNAT; pflog = log; dnsmasq = DHCP.  
**Observe:** todos ativos / running.

### 4. Validar sintaxe — [pi]

```sh
pfctl -nf /etc/pf.conf && echo PF_OK
dnsmasq --test -C /usr/local/etc/dnsmasq.conf
sh -n /etc/rc.conf && echo RC_OK
```

**Por quê:** checa erro **antes** de aplicar.  
**Observe:** `PF_OK`, `syntax check OK`, `RC_OK`.

---

## D1 · Roteador

### 5. `netstat -rn -f inet` — [pi]

**Por quê:** tabela de rotas — default pela WAN; `172.16.0.0/16` em `ue1`.  
**Observe:** `default via 192.168.1.254` em `ue0`.

### 6. `pfctl -sn ; pfctl -sr` — [pi]

**Por quê:** `-sn` = NAT/DNAT; `-sr` = filtro. Tradução roda **antes** do filtro.  
**Observe:** `nat on ue0`, `rdr … 80 → 8080`, `block drop in on ue0 all`, ICMP `quick` na `ue1`.

---

## D2 · DHCP

### 7. `dhclient` — [lan]

**Por quê:** renova lease. Reserva por MAC mantém `.10`.  
**Observe:** de novo `172.16.0.10/16`.

### 8. `ip -4 addr ; ip route ; resolvectl dns` — [lan]

**Por quê:** prova opções DHCP (IP, router, DNS).  
**Observe:** default via `172.16.0.1`; DNS `164.41.101.4` e `.11`.

### 9. `cat /var/db/dnsmasq.leases` — [pi]

**Por quê:** estado das concessões (MAC, IP, nome).  
**Observe:** `0c:cc:47:ec:09:6b 172.16.0.10 host-avaliacao`.

### 10. Log DORA — [pi]

```sh
grep -E "DHCP(DISCOVER|OFFER|REQUEST|ACK)" /var/log/dnsmasq.log | tail
```

**Por quê:** DORA = Discover → Offer → Request → Ack. Renovação ≈ REQUEST/ACK.  
**Observe:** pares REQUEST/ACK para `.10`.

---

## D3 · Conectividade

### 11. `ping -c3 172.16.0.1` — [lan]

**Por quê:** gateway na LAN; a regra de bloqueio é só para destino **fora** da LAN.  
**Observe:** 0% loss.

### 12. `curl -sI http://example.com` — [lan]

**Por quê:** TCP + NAT até a Internet.  
**Observe:** `HTTP/1.1 200 OK`.

### 13. `traceroute -n 8.8.8.8` — [lan]

**Por quê:** sem `-I` (não usa ICMP echo). 1º salto = Pi.  
**Observe:** `1  172.16.0.1`.

---

## D4 · NAT

### 14. `tcpdump -ni ue1 tcp port 80` — [pi]

**Por quê:** no lado LAN a origem ainda é privada.  
**Observe:** captura ativa em `ue1`.

### 15. `curl -sI http://example.com` — [lan]

**Por quê:** gera a conexão que o `pf` traduz.  
**Observe:** HTTP 200.

### 16. `pfctl -ss | grep :80` — [pi]

**Por quê:** tabela de estados = tabela de tradução do Kurose.  
**Observe:** `192.168.1.31:porta (172.16.0.10:porta) -> destino:80`.

---

## D5 · Isolamento (NAT ≠ firewall)

### 17. Contador ANTES — [pi]

```sh
pfctl -vs rules | grep -A1 "block drop in on ue0 all"
```

**Por quê:** anota `Packets` da regra que barra a WAN.

### 18. `nc -lk 8080` — [lan]

**Por quê:** isca; se o isolamento falhar, a WAN alcança esta porta.

### 19. `sudo ip route add 172.16.0.0/16 via 192.168.1.31` — [wan]

**Por quê:** sem rota a WAN nem tenta; com rota o pacote chega na Pi e o **block** deve dropar.

### 20. `ping -c3 172.16.0.10 ; nc -vz -w3 172.16.0.10 8080` — [wan]

**Por quê:** prova o isolamento (`drop` → timeout).  
**Observe:** 100% loss; `nc` timed out.

### 21. Contador DEPOIS — [pi] (mesmo `pfctl -vs` do passo 17)

**Por quê:** `Packets` subiu → a regra engoliu o tráfego.  
**Diga:** “NAT não é firewall.”

### 22. `sudo ip route del 172.16.0.0/16` — [wan]

**Por quê:** limpa a rota forçada.

---

## D6 · DNAT (área Pedro)

### 23. `nc -lk 8080` — [lan]

**Por quê:** destino final do `rdr` (porta 8080).

### 24. `telnet 192.168.1.31 80` — [wan]

**Por quê:** DNAT troca o **destino** (80 da WAN → `.10:8080`). O `tag DNAT_TESTE` deixa passar só o redirecionado.  
**Observe:** texto nos dois sentidos.

### 25. `pfctl -ss | grep 8080` — [pi]

**Por quê:** estado do port forward.  
**Observe:** `172.16.0.10:8080 (192.168.1.31:80) <- … ESTABLISHED`.

---

## D7 · Bloqueio de ping (área Pedro)

### 26. `tcpdump -n -e -ttt -i pflog0` — [pi]

**Por quê:** regras com `log` copiam o pacote para `pflog0`.

### 27. `ping -c3 172.16.0.1` — [lan]

**Por quê:** destino dentro da LAN → **não** bloqueia.  
**Observe:** ok.

### 28. `ping -c3 8.8.8.8` — [lan]

**Por quê:** `block in quick log on ue1 … to ! rede_lan icmp-type echoreq`.  
**Observe:** 100% loss.

### 29. `curl -sI http://example.com` — [lan]

**Por quê:** só ICMP echo é barrado; TCP segue.  
**Observe:** HTTP 200.

### 30. Contador ICMP — [pi]

```sh
pfctl -vs rules | grep -A1 "icmp-type echoreq"
```

**Por quê:** `Packets` da regra `quick` aumentou.

---

## Extra · Serviços

### 31. `service dnsmasq stop ; sockstat -4l | grep :67` — [pi]

**Por quê:** porta 67 some. Evite `pfctl -d` com a LAN no NAT.

### 32. `service dnsmasq start ; sockstat -4l | grep :67` — [pi]

**Por quê:** volta `udp4 *:67`.

---

## Frases curtas para a banca

| Tema | Frase |
| --- | --- |
| Repasse | Encaminha pacote de uma IF para outra (`forwarding=1`). |
| NAT | Troca **origem** (LAN → IP da WAN). |
| DNAT | Troca **destino** (porta 80 da WAN → 8080 da LAN). |
| Isolamento | Quem barra a WAN é o `block`, não o NAT. |
| Ping | Só `echoreq` para **fora** da LAN; gateway e TCP ok. |
| `quick` | No filtro do `pf`, vale na hora (não espera a última regra). |
| `(ue0)` | Relê o IP se o DHCP da WAN mudar. |
