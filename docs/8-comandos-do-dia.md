# Comandos do dia (19/11/2026): pedidos do professor e testes

Resumo para a equipe documentar. Os comandos de NAT, DHCP e ICMP são os do roteiro; o que foi visto de fato na sessão está em [7-ajuste-ip-cliente-e-pendencias.md](7-ajuste-ip-cliente-e-pendencias.md).

## Pedidos do professor

1. O cliente da LAN deve receber **sempre** o IP final **10.111** (172.16.10.111). O IP da Pi **não muda** (172.16.0.1).
2. Mostrar o **log** quando a requisição passa pela Pi.
3. Testar NAT, DNAT, DHCP e bloqueio de ICMP.

## 1. Trocar o IP fixo do cliente (na Pi, como root)

```sh
cp /usr/local/etc/dnsmasq.conf /usr/local/etc/dnsmasq.conf.bak
nano /usr/local/etc/dnsmasq.conf
#  dhcp-host=0c:cc:47:ec:09:6b,host-avaliacao,172.16.10.111,infinite
#  dhcp-option=option:router,172.16.0.1        (gateway = IP da Pi, NÃO o do cliente)
#  dhcp-option=option:dns-server,164.41.101.4,164.41.101.11
dnsmasq --test
service dnsmasq restart
```

O DNAT precisa do mesmo IP: `host_alvo = "172.16.10.111"` no `/etc/pf.conf`. Validar e aplicar: `pfctl -nf /etc/pf.conf && pfctl -f /etc/pf.conf`.

## 2. Renovar no cliente

A reserva é `infinite`, então o cliente só pega as opções novas ao derrubar a conexão.

```sh
nmcli connection down <conexao> && nmcli connection up <conexao>
ip -4 addr show enp44s0                  # 172.16.10.111/16
ip route                                 # default via 172.16.0.1
resolvectl dns enp44s0                   # 164.41.101.4 164.41.101.11
curl -sI http://example.com | head -1    # HTTP 200
```

## 3. DHCP e logs (na Pi)

```sh
cat /var/db/dnsmasq.leases
grep -E "DHCP(DISCOVER|OFFER|REQUEST|ACK)" /var/log/dnsmasq.log | tail
```

## 4. NAT (na Pi, dois terminais; no cliente, um `curl`)

```sh
tcpdump -ni ue1 tcp port 80     # origem 172.16.x.x
tcpdump -ni ue0 tcp port 80     # origem = IP da WAN
pfctl -ss | grep :80
# cliente: curl -sI http://example.com
```

## 5. DNAT (porta 80 da WAN para 8080 do cliente)

```sh
# cliente:          nc -lk 8080
# máquina da WAN:   telnet IP_DA_WAN_DA_PI 80   (digitar uma frase)
# Pi:
tcpdump -ni ue1 tcp port 8080
pfctl -ss | grep 8080
```

Para ver a requisição no `pflog0`, a regra do DNAT precisa de `log`: `pass in log on $wan_if inet proto tcp tagged DNAT_TESTE keep state`. Depois, `tcpdump -n -e -ttt -i pflog0`.

## 6. Bloqueio de ICMP (ping para fora da LAN)

```sh
# Pi:
pfctl -sr | grep echoreq
tcpdump -n -e -ttt -i pflog0
# cliente:
ping -c3 172.16.0.1                           # responde
ping -c3 8.8.8.8                              # 100% de perda
curl -sI -m8 http://example.com | head -1     # continua funcionando
# Pi:
pfctl -vs rules | grep -A1 echoreq            # o contador sobe
```

## 7. Liberar o ping (se o professor pedir) e restaurar

```sh
cp /etc/pf.conf /etc/pf.conf.bak-icmp
sed -i '' 's/^block in quick log on \$lan_if inet proto icmp/#&/' /etc/pf.conf
pfctl -nf /etc/pf.conf && pfctl -f /etc/pf.conf
# cliente: ping -c3 8.8.8.8   (agora responde)

# restaurar o requisito:
cp /etc/pf.conf.bak-icmp /etc/pf.conf && pfctl -nf /etc/pf.conf && pfctl -f /etc/pf.conf
```

## Problemas que tivemos

- **Sem internet no cliente (Wi-Fi desligado):** o gateway entregue estava errado (era o IP do próprio cliente) e o DNS 164.41.101.x não responde fora da UnB. Em casa, usar `dhcp-option=option:dns-server,8.8.8.8,1.1.1.1`; no laboratório, o DNS do enunciado.
- **A Pi chegou a ficar com o IP do cliente na `ue1`:** corrigir `ifconfig_ue1` no `rc.conf` para `inet 172.16.0.1 netmask 255.255.0.0`.
