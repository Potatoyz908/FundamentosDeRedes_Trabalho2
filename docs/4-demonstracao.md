# Roteiro da demonstração presencial

A demonstração vale 70% da nota. Dois operadores: **A** fica na Pi (dois terminais SSH) e **B** fica no host de testes, narrando o que cada teste prova. A divisão das quatro áreas entre os integrantes está em [6-divisao-equipe.md](6-divisao-equipe.md).

## Antes do dia

- Repositório e ZIP idênticos ao que está instalado na Pi (`diff` dos três arquivos).
- MAC de cada notebook que possa ser o host cadastrado na linha `dhcp-host=` (só um ligado por vez).
- Hosts com `nc`, `telnet`, `curl`, `traceroute` e a porta 8080 liberada no firewall.
- Pi com o cartão gravado e um segundo cartão de reserva clonado.
- Levar: Pi, fonte, adaptador USB-Ethernet, três cabos, HDMI e teclado, notebooks carregados, `.pkg` do dnsmasq offline.

## Montagem

1. Cabo 1: tomada da rede de acesso para a porta nativa da Pi (WAN).
2. Adaptador USB-Ethernet na Pi e cabo 2 até o host de testes (LAN), com o Wi-Fi do host desligado.
3. Fonte da Pi por último.
4. Perguntar ao professor: valor de X, WAN por DHCP ou IP fixo, qual DNS usar.

## Sequência (cerca de 15 minutos)

| Etapa | Quem | O que mostrar | O que dizer |
| --- | --- | --- | --- |
| D1 Roteador | A | `ifconfig ue0 ue1`, `sysctl net.inet.ip.forwarding`, `netstat -rn -f inet`, `service ... status` | Duas interfaces, repasse ligado, serviços no boot |
| D2 DHCP | B + A | Renovar o DHCP; `cat /var/db/dnsmasq.leases`; `grep DHCP /var/log/dnsmasq.log` | Mesmo IP sempre (reserva por MAC) e onde ver as leases |
| D3 Conectividade | B | `ping 172.16.0.1`, `curl`, `traceroute -n` | O host alcança o gateway e a rede externa |
| D4 NAT | A + B | `tcpdump` em `ue1` e `ue0` + `curl`; `pfctl -ss` | A origem privada vira o IP da WAN |
| D5 Isolamento | WAN + A | Rota forçada, ping e `nc -vz`; contador do `block ... ue0` | NAT não é firewall; o bloqueio da WAN protege |
| D6 DNAT | B + WAN + A | `nc -lk 8080` na LAN; `telnet IP_WAN 80` na WAN; `pfctl -ss \| grep 8080` | Porta 80 da WAN chega à 8080 da LAN |
| D7 Bloqueio de ping | B + A | `ping 172.16.0.1` ok, `ping 8.8.8.8` falha; `tcpdump -i pflog0` | Só o ICMP echo para fora da LAN é barrado |
| Serviços | A | `service dnsmasq stop` e `start` | Controle do serviço e porta 67 |

Os comandos exatos estão em [3-validacao.md](3-validacao.md). Pedidos improvisados pelo professor (bloquear IP, LAN ↔ WLAN, mudar IP, cortar conexão) estão na seção seguinte.

## Pedidos extras do professor (feedback de outros grupos)

Relatos de outros grupos: o professor pede mudanças **ao vivo**, depois da demonstração básica. Os mais citados: bloquear um IP, fazer o cliente da LAN falar com um cliente na WLAN (Wi-Fi da rede de acesso), mudar o IP de um computador e cortar uma conexão. Esta seção deixa cada um pronto.

> **Status:** todos os comandos desta seção foram **executados na Pi em 16/11/2026** (FreeBSD 15.1, WAN 192.168.1.29) e funcionaram como descrito; depois de cada um, `pfctl -sr` e `pfctl -sn` voltaram idênticos ao original e os três arquivos da Pi continuaram idênticos aos de `configs/`. Saídas reais em `evidencias/extras_2026-11-16.txt`. O "cliente da WLAN" foi simulado por um namespace de rede no notebook (apêndice de [3-validacao.md](3-validacao.md)); na demonstração real, usar um segundo computador no Wi-Fi da rede de acesso.

### Regras para mexer ao vivo

1. **Backup antes:** `cp /etc/pf.conf /etc/pf.conf.bak` (e o mesmo para `dnsmasq.conf` e `rc.conf`, se for mexer neles).
2. **Validar antes de aplicar:** `pfctl -nf /etc/pf.conf` e `dnsmasq --test -C /usr/local/etc/dnsmasq.conf`.
3. **Recarregar, não reiniciar:** `pfctl -f /etc/pf.conf` (sem reboot). O `pf` **mantém os estados já abertos**: uma conexão que estava passando continua passando mesmo depois de uma regra de bloqueio nova. Para a regra valer na hora, derrubar os estados: `pfctl -k IP` (conexões que saem de um host) ou `pfctl -F states` (todos).
4. **No `pf`, a última regra que casa vale, exceto `quick` (vale a primeira).** Regras de **bloqueio** com `quick` funcionam em qualquer ponto do arquivo, inclusive no fim. Regras de **liberação** que precisam vencer o `block ... quick` do ping têm de ficar **antes** dele.
5. **Atalho sem editar arquivo:** juntar o arquivo atual com a regra nova e carregar. Para desfazer basta recarregar o original:
   ```sh
   (cat /etc/pf.conf; echo 'REGRA AQUI') | pfctl -f -     # aplica
   pfctl -f /etc/pf.conf                                  # desfaz
   ```
   Para o professor ver a mudança permanente, editar o `/etc/pf.conf` com `ee`, validar e recarregar; para desfazer, `cp /etc/pf.conf.bak /etc/pf.conf && pfctl -f /etc/pf.conf`. Um reboot também volta ao arquivo original.
6. Narrar: o que a regra faz, onde entra na ordem do arquivo e qual contador/log prova o efeito.

### P1. "Bloqueie o IP de X"

**a) Bloquear um host da LAN (cortar o acesso dele para fora).** Na Pi:
```sh
(cat /etc/pf.conf; echo 'block drop log quick on ue1 inet from 172.16.10.111 to ! 172.16.0.0/16') | pfctl -f -
pfctl -k 172.16.10.111                      # derruba as conexões abertas dele
```
No host: `curl -sI -m5 http://104.20.23.154 -H "Host: example.com"` passa a expirar; `ping 172.16.0.1` ainda responde (o destino está dentro da LAN, fora do alcance da regra). Na Pi: `tcpdump -n -e -ttt -i pflog0` mostra o bloqueio, e `pfctl -vs rules | grep -A1 "172.16.10.111"` mostra o contador. Para bloquear **tudo** do host, trocar `to ! 172.16.0.0/16` por `to any`.

**b) Bloquear um IP de destino (um site ou servidor).**
```sh
(cat /etc/pf.conf; echo 'block drop log quick on ue1 inet from 172.16.0.0/16 to 104.20.23.154') | pfctl -f -
pfctl -F states
```
No host: `curl`/`nc -vz 104.20.23.154 80` expira, e outros destinos continuam funcionando. (Usar TCP na demonstração: o ping para fora já é barrado pela regra do ICMP.)

**c) Bloquear um host da WLAN/WAN.** Já não entra: o `block in on ue0 all` barra tudo, exceto SSH, ping à Pi, DHCP e o DNAT. Para barrar também o DNAT de um IP: `(cat /etc/pf.conf; echo 'block drop log quick on ue0 inet from 192.168.1.20') | pfctl -f -`.

**Desfazer:** `pfctl -f /etc/pf.conf`. **Explicar:** a regra com `quick` para na primeira correspondência, por isso vence o `pass in on ue1 all` que vem antes na ordem; estados antigos precisam ser derrubados.

### P2. "Faça o cliente da LAN falar com o cliente da WLAN"

"Cliente da WLAN" = outro computador no Wi-Fi da rede de acesso (192.168.X.W). Duas direções:

**LAN → WLAN (já funciona por TCP/UDP).** O NAT troca a origem pelo IP da WAN da Pi.
- WLAN: `nc -lk 9000`. LAN: `echo oi | nc 192.168.X.W 9000`. Na Pi: `pfctl -ss | grep 9000` (estado com a tradução 172.16.10.111 → IP da WAN).
- **Ping LAN → WLAN falha, e é o esperado:** o requisito do enunciado é impedir ping para fora do segmento, e a WLAN está fora. Se o professor exigir o ping, abrir uma exceção **antes** da regra de bloqueio (`ee /etc/pf.conf`, inserir logo acima da linha `REQUISITO ENUNCIADO`):
  ```
  pass in quick on $lan_if inet proto icmp from $rede_lan to 192.168.X.W icmp-type echoreq keep state
  ```
  Validar (`pfctl -nf`), recarregar (`pfctl -f`), pingar, e depois restaurar o backup. Explicar que a exceção é só para esse IP.

**WLAN → LAN (hoje barrado pelo isolamento).** São necessários dois ajustes:
1. Na Pi, liberar esse host da WLAN para a LAN (no fim do arquivo funciona, porque o `block in on ue0 all` não é `quick`):
   ```sh
   (cat /etc/pf.conf; echo 'pass in on ue0 inet from 192.168.X.W to 172.16.0.0/16 keep state') | pfctl -f -
   ```
2. No computador da WLAN, ensinar a rota para a LAN pela Pi (senão o pacote vai para o roteador de casa): Linux `sudo ip route add 172.16.0.0/16 via IP_WAN_DA_PI`; Windows `route add 172.16.0.0 mask 255.255.0.0 IP_WAN_DA_PI`.

Teste: da WLAN, `ping 172.16.10.111` e `nc 172.16.10.111 8080` (com `nc -lk 8080` na LAN; o firewall do host da LAN precisa liberar). A resposta volta pela Pi porque o host da LAN usa a Pi como gateway. Desfazer: `pfctl -f /etc/pf.conf` e `sudo ip route del 172.16.0.0/16` na WLAN. **Explicar:** o ICMP bloqueado é só LAN → fora; WLAN → LAN entra como tráfego novo e precisa de regra e de rota.

### P3. "Mude o IP de um dos computadores"

**a) Mudar o IP reservado do host de testes (de 172.16.10.111 para 172.16.0.20).** O IP aparece em dois arquivos: a reserva do DHCP e a macro do DNAT.
```sh
cp /usr/local/etc/dnsmasq.conf /usr/local/etc/dnsmasq.conf.bak ; cp /etc/pf.conf /etc/pf.conf.bak
ee /usr/local/etc/dnsmasq.conf        # dhcp-host=MAC,host-avaliacao,172.16.0.20,infinite
ee /etc/pf.conf                       # host_alvo = "172.16.0.20"
dnsmasq --test -C /usr/local/etc/dnsmasq.conf && pfctl -nf /etc/pf.conf
service dnsmasq stop ; sed -i '' '/172.16.10.111/d' /var/db/dnsmasq.leases ; service dnsmasq start
pfctl -f /etc/pf.conf
```
No host, **derrubar e subir a interface** (a lease reservada é `infinite`, então o cliente não renova sozinho): `nmcli connection down X && nmcli connection up X` (Windows: `ipconfig /release` e `/renew`). Deve receber 172.16.0.20; conferir com `cat /var/db/dnsmasq.leases` e, para o DNAT, `nc -lk 8080` no host e `telnet IP_WAN 80` na WLAN. Voltar ao original com os `.bak` e repetir o procedimento.

**b) Mudar o IP à mão em um computador.** Linux: `sudo ip addr flush dev X; sudo ip addr add 172.16.0.50/16 dev X; sudo ip route add default via 172.16.0.1; sudo resolvectl dns X 164.41.101.4`. Windows: configurar IPv4 estático (172.16.0.50, máscara 255.255.0.0, gateway 172.16.0.1, DNS 164.41.101.4). Funciona sem mexer na Pi, porque o `pf` trata qualquer origem de 172.16.0.0/16; mostrar `pfctl -ss` com o novo IP traduzido. Fora da faixa dinâmica (172.16.1.x) para não colidir com o DHCP. Voltar para DHCP depois.

**c) Mudar o IP da WAN da Pi para fixo (laboratório).** Linhas comentadas do `rc.conf` (`ifconfig_ue0` e `defaultrouter`), `sh -n /etc/rc.conf` e reiniciar. Como `nat ... -> (ue0)` usa o IP atual da interface, nenhuma regra muda.

### P4. "Corte a conexão"

| Pedido | Como cortar | Como restaurar | O que explicar |
| --- | --- | --- | --- |
| Cortar um cliente da LAN | regra do item P1(a) + `pfctl -k 172.16.10.111` | `pfctl -f /etc/pf.conf` | bloqueio com `quick` e derrubada dos estados |
| Cortar a internet de todos | `pfctl -F nat ; pfctl -F states` (remove o NAT; os clientes ainda pingam o gateway) | `pfctl -f /etc/pf.conf` | sem NAT, a origem privada sai pela WAN e o roteador de acesso descarta |
| Cortar a saída da Pi (WAN) | `ifconfig ue0 down` (ou puxar o cabo da WAN) | `ifconfig ue0 up ; service dhclient restart ue0` (testado: volta com `DHCPACK`) | sem WAN não há rota default |
| Cortar o DHCP | `service dnsmasq stop` | `service dnsmasq start` | quem já tem IP continua; quem chega novo não recebe |
| Cortar uma conexão específica (ex.: o telnet do DNAT) | `pfctl -ss \| grep 8080` e `pfctl -k IP_DE_ORIGEM` | basta reconectar | o estado é a "conexão" para o `pf` |
| Cortar a LAN | `ifconfig ue1 down` (ou puxar o cabo). **Derruba o SSH que entra pela LAN:** usar `nohup sh -c 'ifconfig ue1 down; sleep 12; ifconfig ue1 up' &` ou o console local | `ifconfig ue1 up` | o host perde o gateway e volta com o mesmo IP |

Conferir no host, depois de cortar: `curl -m5 ...` expira. Restaurar e provar com um novo `curl`.

### P5. Outros pedidos prováveis

| Pedido | Comando (Pi, como root) |
| --- | --- |
| Mostrar as conexões/traduções ativas | `pfctl -ss` (ou `pfctl -ss \| grep IP`) |
| Mostrar as regras e contadores | `pfctl -sr` e `pfctl -vs rules` |
| Bloquear uma porta (ex.: HTTP) para a LAN | `(cat /etc/pf.conf; echo 'block drop log quick on ue1 proto tcp from any to any port 80') \| pfctl -f -` e `pfctl -F states` |
| Mudar a porta do DNAT (ex.: 80 → 9090 no host) | editar `porta_servico` no `pf.conf`, `pfctl -nf`, `pfctl -f`; `nc -lk 9090` no host |
| Mudar o destino do DNAT para outro host | editar `host_alvo` (e a reserva, se for o mesmo host) |
| Mudar a faixa do DHCP ou o DNS | editar `dhcp-range` ou `dhcp-option=option:dns-server`, `dnsmasq --test`, `service dnsmasq restart`, renovar no host |
| Liberar o ping para fora | comentar a regra `block in quick ... icmp-type echoreq`, `pfctl -nf`, `pfctl -f`; repetir o ping (restaurar depois) |
| Ver o que o cliente recebeu | host: `ip -4 addr`, `ip route`, `resolvectl dns`; Pi: `cat /var/db/dnsmasq.leases` |
| Capturar tráfego | `tcpdump -ni ue1` / `tcpdump -ni ue0` / `tcpdump -n -e -i pflog0` |
| Reiniciar o roteador e provar que sobe sozinho | `shutdown -r now`; depois `service pf status`, `service dnsmasq status`, `pfctl -sn` |
| Outro host de testes | ler o MAC no log, trocar `dhcp-host=`, `service dnsmasq restart` |

### Perguntas sobre esses pedidos

| Pergunta | Resposta curta |
| --- | --- |
| Por que a conexão continuou depois de bloquear o IP? | O `pf` guarda estado; pacotes de uma conexão já aberta não passam pelas regras de novo. Derrubar com `pfctl -k` ou `pfctl -F states`. |
| Por que o ping LAN → WLAN não funciona se o NAT está certo? | Porque a regra do ICMP (requisito do enunciado) barra echo request para fora da LAN; TCP/UDP passam. |
| Por que a WLAN não alcança a LAN? | O `block in on ue0 all` barra a entrada; só passam SSH, ping à Pi, DHCP e o DNAT (marcado). Para alcançar, precisa de regra e de rota via Pi. |
| Onde se muda o IP de um host reservado? | Na linha `dhcp-host` do `dnsmasq.conf` e, se for o alvo do DNAT, na macro `host_alvo` do `pf.conf`. |
| Por que o cliente não pegou o IP novo logo? | A lease reservada é `infinite`: só renova com a interface derrubada e subida (ou `ipconfig /release`). |
| Qual a diferença entre `pfctl -f` e reiniciar? | `-f` recarrega só as regras e mantém o `pf` ligado e os estados; reiniciar derruba tudo. |

### Checklist de ensaio (executado em 16/11/2026)

- [x] P1a bloquear host da LAN e provar no `pflog0`, depois restaurar
- [x] P1b bloquear IP de destino, provar com `curl`/`nc`, depois restaurar (e a pegadinha do estado aberto)
- [x] P2 LAN → WLAN por `nc` (estado no `pfctl -ss`, origem vista = IP da WAN da Pi)
- [x] P2 exceção de ping LAN → WLAN (inserida acima da regra `REQUISITO`)
- [x] P2 WLAN → LAN com regra e rota, depois restaurar
- [x] P3a mudar o IP do host para 172.16.0.20 (DHCP + `host_alvo`), provar o DNAT, depois voltar
- [x] P3b IP em um computador da LAN fora da faixa DHCP
- [x] P4 cortes: `pfctl -F nat`/`-F states`, `pfctl -k`, `ifconfig ue0 down` + `service dhclient restart ue0`, `ifconfig ue1 down`, `service dnsmasq stop`
- [x] P5 bloquear porta 80, liberar o ping, mudar a porta do DNAT (8080 → 9090)
- [x] Depois de cada ensaio: `pfctl -sr` igual ao de antes e `diff` dos três arquivos com `configs/`

Repetir o ensaio com o grupo antes do dia, trocando quem digita: o objetivo agora é velocidade e explicação, não descoberta.

## Perguntas prováveis

| Pergunta | Resposta curta |
| --- | --- |
| Diferença entre NAT e DNAT? | NAT troca a origem (LAN para WAN); DNAT (`rdr`) troca o destino (porta 80 da WAN para 172.16.10.111:8080). |
| Por que `(ue0)` entre parênteses? | O `pf` relê o IP da interface; se o DHCP da WAN mudar, a regra acompanha. |
| Por que o NAT/rdr vem antes do filtro? | A tradução ocorre primeiro; o filtro vê o destino já traduzido (por isso `tagged`). |
| Qual regra vale no filtro? | A última que casa, exceto `quick` (vale a primeira). A do ping é `quick`. |
| Como o DHCP funciona? | DORA: Discover, Offer, Request, Ack, em UDP 67/68, com broadcast no início. |
| Onde ficam as leases? | `/var/db/dnsmasq.leases` e `/var/log/dnsmasq.log`. |
| Como o IP fica fixo? | `dhcp-host=MAC,nome,172.16.10.111`. |
| Por que `port=0` no dnsmasq? | Desliga o DNS dele; só DHCP. O DNS vem das opções entregues. |
| Como habilitou o roteamento? | `gateway_enable="YES"` (sysctl `net.inet.ip.forwarding=1`). |
| O que é o `pflog0`? | Interface que recebe cópia dos pacotes de regras com `log`; lida com `tcpdump -i pflog0`. |
| Por que o NAT não basta para isolar? | Um host da WAN com rota para a LAN via Pi só é barrado pelo `block in on ue0 all`. |
| O que acontece sem `tagged`? | Qualquer TCP direto da WAN para a LAN passaria; com `tag`, só o redirecionado passa. |

## Plano B

| Problema | Ação |
| --- | --- |
| Host de testes diferente do cadastrado | Ler o MAC no log, trocar `dhcp-host`, `service dnsmasq restart` |
| Interfaces invertidas | Trocar `wan_if`/`lan_if` no `pf.conf`, `interface=` no `dnsmasq.conf`, `ifconfig_ue*` no `rc.conf` |
| Sem internet no laboratório | Mostrar o NAT com ping/curl ao gateway de acesso (192.168.X.1) e `tcpdump` |
| DNS 164.41.101.x indisponível | Conferir só o que o DHCP entrega (`resolvectl dns`) e testar por IP |
| Sessão SSH congelou | Console local (HDMI e teclado); `pfctl -d` só em emergência |
| Cartão corrompido | Trocar pelo cartão de reserva |
