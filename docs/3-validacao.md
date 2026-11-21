# Validação: como provar cada requisito

Notação: **Pi** = roteador FreeBSD (`ue0` WAN, `ue1` LAN); **LAN** = host de testes (172.16.10.111); **WAN** = outro equipamento na rede de acesso. Trabalhar com **dois terminais**: um no host e outro com `ssh freebsd@172.16.0.1` (depois `su -`) na Pi. Cada teste mostra onde rodar, o comando, o resultado esperado e o que ele prova. As imagens em `../evidencias/prints/` são a execução real de 14/11/2026.

## Preparar os hosts

| Ferramenta       | Linux                                            | Windows                                 |
| ---------------- | ------------------------------------------------ | --------------------------------------- |
| Endereço e rota  | `ip -4 addr` / `ip route`                        | `ipconfig /all` / `route print`         |
| Renovar DHCP     | `nmcli connection down X; nmcli connection up X` | `ipconfig /release` e `ipconfig /renew` |
| Servidor TCP     | `nc -lk 8080`                                    | `ncat -lk 8080` (Nmap)                  |
| Cliente TCP      | `telnet IP 80` ou `nc IP 80`                     | `telnet IP 80` (recurso opcional)       |
| Rastreio da rota | `traceroute -n IP`                               | `tracert -d IP`                         |

O host precisa liberar a porta 8080 no firewall local e ter a Pi (172.16.0.1) como gateway.

## 0. Estado do roteador

```sh
ifconfig ue0 ; ifconfig ue1
sysctl net.inet.ip.forwarding
service pf status ; service pflog status ; service dnsmasq status
pfctl -nf /etc/pf.conf ; dnsmasq --test -C /usr/local/etc/dnsmasq.conf ; sh -n /etc/rc.conf
```

Esperado: WAN com IP da rede de acesso, LAN 172.16.0.1/16, `forwarding: 1`, serviços ativos e arquivos sem erro. Imagens: `01_pre_checagem_pi.png`, `02_regras_pf.png`, `03_validacao_arquivos.png`.

## 1. Conectividade

No host LAN:

```sh
ip -4 addr show ; ip route show default
ping -c3 172.16.0.1
curl -sI http://unb.br| head -1
traceroute -n 8.8.8.8
```

Esperado: 172.16.10.111/16, default via 172.16.0.1, ping respondido, `HTTP/1.1 200 OK`, primeiro salto 172.16.0.1. **Prova:** a LAN alcança o gateway e, através dele, a rede externa. Imagem: `04_teste1_conectividade.png`.

## 2. Tradução de endereço (NAT)

Na Pi, em dois terminais: `tcpdump -ni ue1 tcp port 80` e `tcpdump -ni ue0 tcp port 80`. No host LAN: `curl -sI http://unb.br`. Depois, na Pi: `pfctl -ss | grep :80`.

Esperado: em `ue1` a origem é 172.16.10.111; em `ue0` a mesma conexão (mesmo `seq`) sai com o IP da WAN e outra porta; o estado mostra `IP_WAN:porta (172.16.10.111:porta) -> destino`. **Prova:** a origem privada é traduzida. Imagem: `05_teste2_nat.png`.

## 3. Isolamento de segmento

1. Pi: `pfctl -vs rules | grep -A1 "block drop in on ue0 all"` (anotar `Packets`).
2. LAN: `nc -lk 8080`.
3. WAN: `ping -c3 172.16.10.111` (falha); `sudo ip route add 172.16.0.0/16 via IP_WAN_DA_PI`; repetir o ping e rodar `nc -vz -w3 172.16.10.111 8080`; depois `sudo ip route del 172.16.0.0/16`.
4. Pi: repetir o passo 1.

Esperado: ping 100% de perda, `nc` com timeout, nada chega ao servidor da LAN e o contador aumenta (878 para 884 na execução registrada). Também: da WAN, a porta 22 abre (SSH liberado) e 53, 443, 8080 expiram. **Prova:** o NAT sozinho não protege; quem barra a entrada é o `block in on ue0 all`. Imagem: `09_teste3_isolamento.png`.

## 4. DHCP, IP fixo e leases

- LAN: renovar o DHCP três vezes e conferir `ip -4 addr`, `ip route show default` e `resolvectl dns`. Esperado: sempre `172.16.10.111`, gateway 172.16.0.1, DNS 164.41.101.4 e 164.41.101.11.
- Pi, leases: `cat /var/db/dnsmasq.leases` (formato `validade MAC IP nome`).
- Pi, log: `grep -E "DHCP(DISCOVER|OFFER|REQUEST|ACK)" /var/log/dnsmasq.log | tail`.

**Prova:** o dnsmasq entrega a configuração e a reserva por MAC mantém o endereço. Imagem: `06_teste4_dhcp.png`. As renovações de um host que já tem lease aparecem como `REQUEST`/`ACK`; o ciclo completo (`DISCOVER`, `OFFER`, `REQUEST`, `ACK`) aparece na primeira concessão.

## 5. DNAT: porta 80 da WAN para a 8080 da LAN

1. LAN: `nc -lk 8080`.
2. WAN: `telnet IP_WAN_DA_PI 80` (ou `nc IP_WAN_DA_PI 80`). Digitar uma frase em cada lado e apertar Enter.
3. Pi, durante a conexão: `pfctl -ss | grep 8080`.
4. Encerrar: `Ctrl+C` no `nc`; no telnet, `Ctrl+]` e `quit`.

Esperado: o texto digitado em um lado aparece no outro e o estado mostra `172.16.10.111:8080 (IP_WAN:80) <- origem  ESTABLISHED`. **Prova:** a porta 80 da WAN chega à 8080 do host da LAN. Imagem: `10_teste5_dnat.png`.

## 6. Bloqueio de ping para fora da LAN

1. Pi: `tcpdump -n -e -ttt -i pflog0` (se faltar: `service pflog onestart`).
2. LAN: `ping -c3 172.16.0.1` (responde); `ping -c3 8.8.8.8` (100% de perda); `curl -sI http://unb.br` (continua funcionando).
3. Pi: `pfctl -vs rules | grep -A1 "icmp-type echoreq"` (contador da regra).

Esperado: no `pflog0` aparece `block in on ue1: 172.16.10.111 > 8.8.8.8: ICMP echo request`. **Prova:** só o ICMP echo para fora da LAN é barrado; o gateway e os demais protocolos funcionam. Imagem: `07_teste6_bloqueio_ping.png`.

## 7. Serviços: parar e iniciar

```sh
service dnsmasq status ; service dnsmasq stop ; sockstat -4l | grep -c ":67 "
service dnsmasq start  ; sockstat -4l | grep ":67 "
pfctl -f /etc/pf.conf                      # recarrega o pf sem derrubar a sessão
```

Esperado: com o serviço parado nada escuta na porta 67; ao iniciar volta `udp4 *:67`. Imagem: `08_servico_dnsmasq.png`. Evitar `pfctl -d` com a LAN em uso (desliga o NAT); para reativar: `pfctl -e`.

## Checklist

| #   | Requisito                                     | Teste | Resultado (14/11/2026) |
| --- | --------------------------------------------- | ----- | ---------------------- |
| 1   | WAN com IP da rede de acesso, LAN /16 privada | 0     | OK                     |
| 2   | Conectividade                                 | 1     | OK                     |
| 3   | NAT                                           | 2     | OK                     |
| 4   | Isolamento                                    | 3     | OK                     |
| 5   | DHCP, DNS e IP fixo                           | 4     | OK                     |
| 6   | Leases em log                                 | 4     | OK                     |
| 7   | DNAT 80 para 8080 com netcat/telnet           | 5     | OK                     |
| 8   | Bloqueio de ping para fora                    | 6     | OK                     |
| 9   | Arquivos sem erro de interpretação            | 0     | OK                     |

## Apêndice: simular o lado WAN com um único notebook

Para testar isolamento e DNAT sem segundo equipamento, criou-se um namespace de rede (`wan`) com um `ipvlan` sobre o Wi-Fi, que age como máquina na rede de acesso (IP livre, por exemplo 192.168.1.17), mais uma rota de retorno no notebook, para a resposta do servidor da LAN voltar pela Pi:

```sh
sudo ip netns add wan
sudo ip link add ipv-wan link wlp43s0 type ipvlan mode l2
sudo ip link set ipv-wan netns wan
sudo ip -n wan addr add 192.168.1.17/24 dev ipv-wan
sudo ip -n wan link set ipv-wan up ; sudo ip -n wan link set lo up
sudo ip -n wan route add default via 192.168.1.254
sudo ip route add 192.168.1.17/32 via 172.16.0.1 dev enp44s0
# testes: sudo ip netns exec wan telnet 192.168.1.31 80
# limpeza: sudo ip route del 192.168.1.17/32 ; sudo ip netns del wan
```

Ajustar os nomes de interface (`wlp43s0`, `enp44s0`) e os IPs ao ambiente. Na demonstração real, usar um segundo equipamento no lado WAN.
