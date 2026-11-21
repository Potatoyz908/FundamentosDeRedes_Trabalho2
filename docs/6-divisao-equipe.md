# Divisão da apresentação entre os 4 integrantes

Cada pessoa é **dona** de uma parte: sabe explicar a configuração, executar os comandos de cor e responder as perguntas dela. Se o professor pedir algo de qualquer parte, quem for o dono assume o teclado. A divisão abaixo é uma sugestão e pode ser trocada entre vocês; o importante é que cada área tenha um dono e um reserva.

| Área                          | Dono    | Reserva | Demonstrações                                    |
| ----------------------------- | ------- | ------- | ------------------------------------------------ |
| 1. Roteador e rede base       | Euller  | Pedro   | Montagem, D1, serviços (stop/start), laboratório |
| 2. DHCP e leases              | Davi    | Giovani | D2                                               |
| 3. NAT, firewall e isolamento | Giovani | Davi    | D3 conectividade, D4 NAT, D5 isolamento          |
| 4. DNAT e bloqueio de ping    | Pedro   | Euller  | D6 DNAT, D7 ping                                 |

No dia, quem estiver na Pi (dois terminais SSH) e quem estiver no host de testes se alternam conforme a demonstração. Os comandos completos estão em [3-validacao.md](3-validacao.md).

## O que os 4 precisam saber

- A topologia: Pi com `ue0` (WAN, rede de acesso) e `ue1` (LAN 172.16.0.1/16, adaptador USB); host de testes em 172.16.10.111.
- Os três arquivos e onde ficam na Pi: `rc.conf` (`/etc/rc.conf`), `pf.conf` (`/etc/pf.conf`), `dnsmasq.conf` (`/usr/local/etc/dnsmasq.conf`).
- Validar antes de aplicar: `pfctl -nf`, `dnsmasq --test -C`, `sh -n`. Arquivo com erro é anulado.
- Regra de ouro do `pf`: NAT/`rdr` primeiro; no filtro vale a **última** regra que casa, salvo `quick`.
- Como entrar na Pi: `ssh freebsd@IP`, depois `su -`. Desligar com `shutdown -p now`.

---

## 1. Roteador e rede base (Euller; reserva Pedro)

**Arquivo:** `configs/rc.conf`.

**Precisa saber explicar**

- Por que `gateway_enable="YES"`: liga o repasse (`net.inet.ip.forwarding=1`); sem ele a Pi não encaminha entre `ue0` e `ue1`.
- `ifconfig_ue0="DHCP"` (WAN) e `ifconfig_ue1="inet 172.16.0.1 netmask 255.255.0.0"` (LAN); por que 172.16.0.0/16 (bloco privado RFC 1918, /16 como o enunciado pede).
- Como os serviços sobem no boot (`pf_enable`, `pflog_enable`, `dnsmasq_enable`, `sshd_enable`).
- Por que se reinicia em vez de ligar o `pf` na mão (a sessão SSH pode congelar).
- No laboratório: pedir o X ao professor; IP fixo com as linhas comentadas (`ifconfig_ue0` e `defaultrouter`).
- O que fazer se `ue0` e `ue1` estiverem invertidas (trocar as macros nos três arquivos).

**Comandos de cor**

```sh
ifconfig ue0 ; ifconfig ue1
sysctl net.inet.ip.forwarding
netstat -rn -f inet
service pf status ; service pflog status ; service dnsmasq status ; service sshd status
```

**Se o professor pedir**

- "Mostre que é um roteador": os comandos acima (duas interfaces, forwarding 1, rota default pela WAN).
- "Pare e inicie o serviço": `service dnsmasq stop`, `sockstat -4l | grep :67` (nada), `service dnsmasq start` (volta `udp4 *:67`).
- "Mude o IP da WAN para fixo": editar `rc.conf` (linhas alternativas), validar com `sh -n`, reiniciar.
- "Mude o IP deste computador": IP estático à mão na LAN (fora da faixa 172.16.1.x, gateway 172.16.0.1) e mostrar o NAT com o IP novo em `pfctl -ss`.
- "Corte a WAN / a LAN": `ifconfig ue0 down` e `ifconfig ue0 up ; service dhclient restart ue0`. A LAN com `ue1` derruba o SSH que entra pela LAN: usar o console ou `nohup sh -c 'ifconfig ue1 down; sleep 12; ifconfig ue1 up' &`.
- "Reinicie e prove que sobe sozinho": `shutdown -r now`, depois os `service ... status` e `pfctl -sn`.

**Perguntas prováveis**

- _Diferença entre repasse e roteamento?_ Repasse move cada pacote de uma interface para outra (plano de dados); roteamento decide as rotas (plano de controle).
- _Como a Pi sabe a rota para a internet?_ A rota default aponta para o gateway da rede de acesso, obtida por DHCP na `ue0`.
- _O que acontece com `forwarding=0`?_ O host da LAN alcança só a Pi, não a rede externa.

---

## 2. DHCP e leases (Davi; reserva Giovani)

**Arquivo:** `configs/dnsmasq.conf`.

**Precisa saber explicar**

- O DORA (Discover, Offer, Request, Ack), UDP 68 para 67, começa por broadcast (veja `docs/img/dhcp-dora.svg`).
- `port=0`: desliga o DNS do dnsmasq; só DHCP. O DNS é entregue ao cliente por opção (164.41.101.4 e .11).
- `interface=ue1` e `bind-interfaces`: só atende a LAN. `dhcp-authoritative`: único servidor da rede.
- `dhcp-range=172.16.1.1,172.16.1.254,255.255.0.0,12h`: faixa dinâmica, lease de 12 h.
- `dhcp-host=MAC,host-avaliacao,172.16.10.111,infinite`: a reserva por MAC; por isso o host recebe sempre o mesmo IP.
- Onde ver as leases: `/var/db/dnsmasq.leases` (formato `validade MAC IP nome`) e `/var/log/dnsmasq.log`.
- Trocar o host de testes: ler o MAC no log, editar `dhcp-host=`, `service dnsmasq restart`. Vários MACs na mesma linha servem, com só um host ligado por vez.

**Comandos de cor**

```sh
cat /var/db/dnsmasq.leases
grep -E "DHCP(DISCOVER|OFFER|REQUEST|ACK)" /var/log/dnsmasq.log | tail
dnsmasq --test -C /usr/local/etc/dnsmasq.conf
```

No host: renovar o DHCP e mostrar `ip -4 addr`, `ip route show default`, `resolvectl dns` (ou `ipconfig /renew` e `ipconfig /all` no Windows).

**Se o professor pedir**

- "Use outra máquina como host": plugar, `grep DHCP /var/log/dnsmasq.log | tail`, copiar o MAC, ajustar a linha e reiniciar o serviço; renovar no host e mostrar `172.16.10.111`.
- "Mostre as leases": os dois comandos acima.
- "Mude o DNS para 192.168.X.1": editar `dhcp-option=option:dns-server`, validar, reiniciar o serviço, renovar no host.
- "Mude o IP deste host para 172.16.0.20": trocar o IP em `dhcp-host`, apagar a lease antiga do `/var/db/dnsmasq.leases` com o serviço parado, e avisar o dono do DNAT que a macro `host_alvo` do `pf.conf` também muda. No host, derrubar e subir a interface (a lease é `infinite`).
- "Mude a faixa do DHCP": editar `dhcp-range`, `dnsmasq --test`, `service dnsmasq restart`, renovar no host.

**Perguntas prováveis**

- _Por que o primeiro pacote é broadcast?_ O cliente ainda não tem IP nem conhece o servidor.
- _O que é a lease?_ O tempo em que o cliente pode usar o IP; renova antes de acabar (REQUEST/ACK).
- _Os DNS entregues funcionam em casa?_ Não: 164.41.101.x só respondem dentro da UnB; o DHCP os entrega do mesmo jeito.

---

## 3. NAT, firewall e isolamento (Giovani; reserva Davi)

**Arquivo:** `configs/pf.conf` (macros, `nat`, `block in on ue0 all` e exceções).

**Precisa saber explicar**

- `nat on ue0 inet from 172.16.0.0/16 to any -> (ue0)`: troca a origem privada pelo IP da WAN; os parênteses fazem o `pf` reler o IP da interface se o DHCP mudar.
- A tabela de estados: guarda a tradução e desfaz na resposta (`pfctl -ss`).
- `block in on ue0 all` e as exceções (SSH, ping ao roteador, DHCP, tráfego marcado pelo DNAT): por que a WAN não entra na LAN.
- **NAT não é firewall:** quem isola é o `block`. Sem ele, um host da WAN com rota para 172.16.0.0/16 via Pi alcançaria a LAN.
- `set block-policy drop`: descarta sem responder (por isso o teste dá timeout, não "recusado").
- Ordem: tradução antes do filtro; no filtro vale a última regra que casa, exceto `quick`.

**Comandos de cor**

```sh
pfctl -sn ; pfctl -sr
tcpdump -ni ue1 tcp port 80       # LAN: origem 172.16.10.111
tcpdump -ni ue0 tcp port 80       # WAN: origem = IP da WAN
pfctl -ss | grep :80
pfctl -vs rules | grep -A1 "block drop in on ue0 all"   # contador
```

No host: `ping 172.16.0.1`, `curl -sI http://unb.br`, `traceroute -n 192.168.2.241`.

**Se o professor pedir**

- "Mostre o NAT": `tcpdump` nas duas interfaces + `curl` no host + `pfctl -ss` (mesma conexão, origem diferente).
- "Prove o isolamento": da WAN, `sudo ip route add 172.16.0.0/16 via IP_WAN_DA_PI`, ping e `nc -vz -w3 172.16.10.111 8080` falham e o contador sobe; depois `sudo ip route del 172.16.0.0/16`.
- "Recarregue as regras": `pfctl -nf /etc/pf.conf && pfctl -f /etc/pf.conf`.
- "Bloqueie o IP de X": `(cat /etc/pf.conf; echo 'block drop log quick on ue1 inet from 172.16.10.111 to ! 172.16.0.0/16') | pfctl -f -` e `pfctl -k 172.16.10.111`; provar no `pflog0`; desfazer com `pfctl -f /etc/pf.conf`. Para um IP de destino: `from 172.16.0.0/16 to IP` e `pfctl -F states`.
- "Corte a conexão": `pfctl -F nat ; pfctl -F states` (sem NAT os clientes perdem a internet); restaurar com `pfctl -f /etc/pf.conf`.
- "Por que a conexão continuou depois do bloqueio?": estado aberto; derrubar com `pfctl -k` ou `pfctl -F states`.

**Perguntas prováveis**

- _Por que `scrub in all`?_ Reassembla pacotes fragmentados na entrada antes de filtrar/traduzir.
- _Por que a WAN responde ao SSH e ao ping da Pi?_ São exceções explícitas, só para o IP da Pi; o resto cai no `block`.
- _O que é `keep state`?_ A regra guarda estado; as respostas passam sem regra própria.

---

## 4. DNAT e bloqueio de ping (Pedro; reserva Euller)

**Arquivo:** `configs/pf.conf` (`rdr`, `tag`/`tagged` e a regra do ICMP).

**Precisa saber explicar**

- `rdr on ue0 inet proto tcp from any to (ue0) port 80 tag DNAT_TESTE -> 172.16.10.111 port 8080`: troca o **destino** (porta 80 da WAN para a 8080 do host).
- `pass in on ue0 ... tagged DNAT_TESTE`: só o que o `rdr` marcou entra na LAN; o filtro vê o destino já traduzido.
- O host da LAN precisa ter a Pi como gateway para a resposta voltar (o DHCP entrega isso).
- A regra do ping: `block in quick log on ue1 inet proto icmp from 172.16.0.0/16 to ! 172.16.0.0/16 icmp-type echoreq`. `quick` garante que vale mesmo com o `pass` depois; `log` copia para `pflog0`; só echo request para fora da LAN (o gateway responde, curl e traceroute UDP seguem).
- Como ver o bloqueio: `tcpdump -n -e -ttt -i pflog0`.

**Comandos de cor**

```sh
# LAN:  nc -lk 8080
# WAN:  telnet IP_WAN_DA_PI 80      (ou: nc IP_WAN_DA_PI 80)
pfctl -ss | grep 8080
tcpdump -n -e -ttt -i pflog0
pfctl -vs rules | grep -A1 "icmp-type echoreq"
```

Para sair: `Ctrl+C` no `nc`; no telnet, `Ctrl+]` e `quit`.

**Se o professor pedir**

- "Mostre o DNAT": servidor `nc -lk 8080` na LAN, `telnet` na WAN, uma frase em cada sentido, `pfctl -ss | grep 8080` mostrando `ESTABLISHED`.
- "Mostre o bloqueio de ping": `ping 172.16.0.1` responde, `ping 192.168.2.241` perde tudo, `pflog0` registra, `curl` continua funcionando.
- "Libere o ping": comentar a regra `block ... icmp-type echoreq`, `pfctl -nf` e `pfctl -f /etc/pf.conf`; repetir o ping de um host novo (estados antigos podem manter o ping aberto). Restaurar depois.
- "Faça a LAN falar com a WLAN": LAN → WLAN por TCP já funciona pelo NAT (`nc -lk 9000` na WLAN, `nc IP 9000` na LAN, `pfctl -ss | grep 9000`); o ping LAN → WLAN é barrado pelo requisito e só passa com uma exceção `pass in quick ... to IP_WLAN` colocada **acima** da regra do ICMP.
- "Faça a WLAN falar com a LAN": regra `pass in on ue0 inet from IP_WLAN to 172.16.0.0/16 keep state` (no fim do arquivo vale) e rota `172.16.0.0/16 via IP_WAN_DA_PI` no computador da WLAN.
- "Mude a porta ou o destino do DNAT": `porta_servico` e `host_alvo` no `pf.conf`, `pfctl -nf`, `pfctl -f`, e o `nc -lk` na porta nova.

**Perguntas prováveis**

- _Diferença entre NAT e DNAT?_ NAT troca a origem (saída); DNAT troca o destino (entrada).
- _O que o `tag` resolve?_ Impede que qualquer TCP direto da WAN para a LAN passe; só o redirecionado passa.
- _Por que o ping bloqueado não afeta o curl?_ A regra casa só ICMP echo request; TCP segue por outras regras.
- _O host consegue pingar a Pi?_ Sim: o destino 172.16.0.1 está dentro da LAN, fora do alcance da regra (`to ! rede_lan`).

---

## Pedidos extras: quem assume cada um

O professor costuma improvisar (relato de outros grupos). O procedimento de cada item está em [4-demonstracao.md](4-demonstracao.md), na seção "Pedidos extras". Quem for o dono assume o teclado; o reserva confere os comandos.

| Pedido do professor                                                 | Dono    | Reserva | Seção    |
| ------------------------------------------------------------------- | ------- | ------- | -------- |
| Bloquear o IP de um host da LAN ou um IP de destino                 | Giovani | Davi    | P1       |
| Cortar a conexão de um cliente, do NAT ou de uma conexão específica | Giovani | Pedro   | P4       |
| LAN falar com a WLAN (TCP, ping, e WLAN → LAN com regra e rota)     | Pedro   | Giovani | P2       |
| Mudar o IP reservado do host (DHCP + `host_alvo`)                   | Davi    | Euller  | P3a      |
| Mudar o IP de um computador à mão ou da WAN da Pi para fixo         | Euller  | Davi    | P3b, P3c |
| Cortar a WAN, a LAN ou o DHCP; reiniciar o roteador                 | Euller  | Pedro   | P4       |
| Mudar a porta ou o destino do DNAT; liberar o ping                  | Pedro   | Euller  | P5       |
| Mudar faixa/DNS do DHCP; trocar de host de testes                   | Davi    | Giovani | P5       |

Regras de ouro para todos (valem em qualquer pedido): fazer backup (`cp /etc/pf.conf /etc/pf.conf.bak`), validar antes (`pfctl -nf`), recarregar com `pfctl -f` (não reiniciar), lembrar que o `pf` mantém estados abertos (`pfctl -k IP` ou `pfctl -F states`) e restaurar no fim.

## Ensaio recomendado

1. Cada dono explica a sua parte em 2 minutos olhando só o arquivo, sem consulta.
2. Cada dono executa os comandos de cor da sua parte na Pi, com o reserva cronometrando.
3. Sorteiem perguntas de outras áreas: quem for sorteado tenta responder; se não souber, o dono corrige. Repitam até todos acertarem as perguntas gerais.
4. Façam uma rodada completa (D1 a D7) em 15 minutos, trocando quem está na Pi e quem está no host.
5. Rodada de improviso: um integrante faz de professor e sorteia pedidos da tabela "Pedidos extras" (bloquear IP, LAN ↔ WLAN, mudar IP, cortar conexão) sem avisar o dono. O dono resolve em até 3 minutos, restaura o estado e mostra que `pfctl -sr` voltou ao original.
6. Antes do dia, repetir o checklist de ensaio de [4-demonstracao.md](4-demonstracao.md): os comandos dos pedidos extras já foram executados na Pi em 16/11/2026 e funcionaram; o objetivo agora é cada dono fazer sozinho, rápido e explicando.
