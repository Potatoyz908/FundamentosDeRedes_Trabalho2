# Roteiro da demonstração presencial

A demonstração vale 70% da nota. Dois operadores: **A** fica na Pi (dois terminais SSH) e **B** fica no host de testes, narrando o que cada teste prova.

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

Os comandos exatos estão em [3-validacao.md](3-validacao.md).

## Perguntas prováveis

| Pergunta | Resposta curta |
| --- | --- |
| Diferença entre NAT e DNAT? | NAT troca a origem (LAN para WAN); DNAT (`rdr`) troca o destino (porta 80 da WAN para 172.16.0.10:8080). |
| Por que `(ue0)` entre parênteses? | O `pf` relê o IP da interface; se o DHCP da WAN mudar, a regra acompanha. |
| Por que o NAT/rdr vem antes do filtro? | A tradução ocorre primeiro; o filtro vê o destino já traduzido (por isso `tagged`). |
| Qual regra vale no filtro? | A última que casa, exceto `quick` (vale a primeira). A do ping é `quick`. |
| Como o DHCP funciona? | DORA: Discover, Offer, Request, Ack, em UDP 67/68, com broadcast no início. |
| Onde ficam as leases? | `/var/db/dnsmasq.leases` e `/var/log/dnsmasq.log`. |
| Como o IP fica fixo? | `dhcp-host=MAC,nome,172.16.0.10`. |
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
