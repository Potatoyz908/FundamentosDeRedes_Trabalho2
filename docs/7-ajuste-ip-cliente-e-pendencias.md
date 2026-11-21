# Ajuste pedido pelo professor (17/11/2026): IP fixo do cliente e pendências

Registro do que o professor pediu, do que foi feito na Pi e do que ainda falta antes da apresentação. Cada item diz o que foi **verificado** e o que **não foi**.

## 1. O que o professor pediu

1. **Trocar o IP fixo do cliente da LAN** para que ele receba sempre o final **10.111**, ou seja, **172.16.10.111** (a primeira tentativa usou .110; a versão final é .111). O IP da **Pi não muda**: continua **172.16.0.1** na LAN.
2. **Mostrar o log** quando uma requisição passa pela Pi.

## 2. O que muda e o que não muda

| Item                                    | Antes       | Depois                 | Arquivo (na Pi)                              |
| --------------------------------------- | ----------- | ---------------------- | -------------------------------------------- |
| IP reservado do cliente (DHCP, por MAC) | 172.16.0.10 | **172.16.10.111**      | `/usr/local/etc/dnsmasq.conf` (`dhcp-host=`) |
| Destino do DNAT (`host_alvo`)           | 172.16.0.10 | **172.16.10.111**      | `/etc/pf.conf`                               |
| IP da Pi na LAN (`ue1`)                 | 172.16.0.1  | **172.16.0.1 (igual)** | `/etc/rc.conf`                               |
| Gateway entregue ao cliente             | 172.16.0.1  | **172.16.0.1 (igual)** | `dnsmasq.conf` (`option:router`)             |

No repositório, `configs/dnsmasq.conf` e `configs/pf.conf` já têm o novo IP. Ainda **não foram commitados**. O README, os outros docs e o simulador (`sim/`) ainda citam 172.16.0.10. As evidências antigas devem ficar como estão, porque foram gravadas com esse IP.

## 3. Passo a passo para aplicar na Pi (como root)

```sh
cp /usr/local/etc/dnsmasq.conf /usr/local/etc/dnsmasq.conf.bak
cp /etc/pf.conf /etc/pf.conf.bak

# Troca só o IP do cliente. O IP da Pi (172.16.0.1) fica de fora.
sed -i '' 's/172\.16\.0\.10\b/172.16.10.111/g' /usr/local/etc/dnsmasq.conf /etc/pf.conf

dnsmasq --test && pfctl -nf /etc/pf.conf          # validar antes de aplicar

service dnsmasq stop
sed -i '' '/0c:cc:47:ec:09:6b/d' /var/db/dnsmasq.leases   # apaga a lease antiga do cliente
service dnsmasq start
pfctl -f /etc/pf.conf
pfctl -sn          # deve mostrar: rdr on ue0 ... -> 172.16.10.111 port 8080
```

No **cliente**, renove o DHCP: `nmcli connection down <conexao> && nmcli connection up <conexao>` (Windows: `ipconfig /release` e `/renew`). A reserva é `infinite`, então o cliente não renova sozinho.

Conferência:

```sh
ip -4 addr                 # cliente: 172.16.10.111/16
ip route                   # cliente: default via 172.16.0.1
ifconfig ue1 | grep inet   # Pi: só 172.16.0.1
grep -E "DHCP(DISCOVER|OFFER|REQUEST|ACK)" /var/log/dnsmasq.log | tail
cat /var/db/dnsmasq.leases
```

## 4. O que aconteceu na primeira tentativa

Depois da primeira troca, o cliente recebeu **172.16.1.186** (faixa dinâmica) em vez de 172.16.10.110. O log do `dnsmasq` mostrava `server-identifier 172.16.10.110`. A causa: a **própria Pi** estava com 172.16.10.110 na `ue1` e no `/etc/rc.conf` (`ifconfig_ue1="inet 172.16.10.110 ..."`). O IP reservado do cliente já estava em uso pela Pi, e o professor não quer que o IP da Pi mude.

Correção feita em 17/11 pela sessão tmux:

- `rc.conf` com `ifconfig_ue1="inet 172.16.0.1 netmask 255.255.0.0"` (backup em `/etc/rc.conf.bak-ip`);
- `ue1` voltou para 172.16.0.1 e o `dnsmasq` foi reiniciado com a lease do cliente apagada.

**Verificado:** a Pi respondeu em 172.16.0.1 e deixou de responder em 172.16.10.110. O notebook cliente, depois de renovar o DHCP, passou a ter **172.16.10.110/16**.

**Não verificado:**

- O gateway recebido. Depois da renovação, a rota padrão do cliente apareceu como `default via 172.16.10.110`, que é o IP **do próprio cliente**, e não o da Pi. Se for isso mesmo, o cliente não tem saída para a internet.
- O `server-identifier` do `dnsmasq` e o conteúdo atual de `/var/db/dnsmasq.leases` e do log. O SSH novo pediu a senha do usuário `freebsd`, e a conferência ficou pendente.

## 5. Pendência 1: o cliente não navegava na internet (Wi-Fi desligado) — RESOLVIDA

Com o Wi-Fi do cliente desligado e tudo passando pela Pi, o navegador não abria páginas. **Resolvido em 17/11**: com o Wi-Fi desligado, o cliente navega.

**Causas encontradas** (cada uma observada com um comando; não dá para dizer qual delas, sozinha, era a única):

1. **Gateway errado.** Depois da troca do IP, o cliente recebeu `default via 172.16.10.110`, o próprio IP dele, porque a linha `option:router` do `dnsmasq.conf` da Pi tinha sido alterada junto com o IP do cliente. Correção: `dhcp-option=option:router,172.16.0.1`.
2. **DNS da UnB inalcançável.** O cliente recebia só `164.41.101.4` e `.11`; `dig @164.41.101.4 unb.br` deu **timeout**, enquanto `dig @192.168.2.241 unb.br` respondeu pela mesma LAN. Com o Wi-Fi desligado, não há outro DNS e nenhum nome resolve. Correção em casa: `dhcp-option=option:dns-server,192.168.2.241,1.1.1.1`.
3. **O cliente só pega as opções novas ao renovar o DHCP.** A reserva é `infinite`, então foi preciso derrubar e subir a conexão (`nmcli connection down/up`) depois de cada mudança no `dnsmasq.conf`. O `NetworkManager` registrou renovações às 18:43 e 18:48.

**O que descartamos** (testado pela LAN, com o Wi-Fi ainda ligado mas a rota da LAN com prioridade): o NAT e o forwarding da Pi (`curl` por IP e por nome, HTTP e HTTPS, 200 OK), o MTU (download de 5 MB, `ping -M do -s 1472` sem perda) e proxy.

**Para o laboratório:** o DNS volta ao que o enunciado pede (`164.41.101.4`/`.11` ou o que o professor informar). O `configs/dnsmasq.conf` do repositório continua com o DNS da UnB.

**Hipóteses consideradas no diagnóstico:**

| #   | Hipótese                                                                                                                                                                                                                                                              | Como verificar                                                                                                                                     | Correção                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Gateway errado** no `dnsmasq.conf` da Pi: a rota padrão do cliente apareceu como 172.16.10.110. Uma troca de IP mais ampla pode ter alterado a linha `option:router`                                                                                                | Na Pi: `grep -n "router\|dhcp-host" /usr/local/etc/dnsmasq.conf`. No cliente: `ip route`                                                           | Deixar `dhcp-option=option:router,172.16.0.1`, reiniciar o `dnsmasq` e renovar o cliente                                                                                                       |
| 2   | **DNS inalcançável**. A config entrega 164.41.101.4 e .11, que são servidores da UnB. Fora da rede da UnB (em casa) eles podem não responder, e o navegador falha por nome. As evidências antigas usam `curl http://104.20.23.154 -H "Host: unb.br"`, ou seja, por IP | No cliente: `ping -c2 192.168.2.241` (se passar, a rota e o NAT estão bons); `nslookup unb.br` (se falhar, é DNS); `nslookup unb.br 192.168.2.241` | Em casa, trocar temporariamente por `dhcp-option=option:dns-server,192.168.2.241,1.1.1.1` (ou o DNS do roteador de casa). **No laboratório, manter 164.41.101.4 e .11**, como o enunciado pede |
| 3   | **Ping para fora bloqueado de propósito**. A regra do ICMP barra `ping 192.168.2.241`. Isso é esperado e não impede a navegação                                                                                                                                       | Usar `curl -I http://unb.br` em vez de ping                                                                                                        | Nenhuma: é requisito                                                                                                                                                                           |
| 4   | **Forwarding ou NAT**. Improvável, porque o teste de 14/11 e 16/11 passou                                                                                                                                                                                             | Na Pi: `sysctl net.inet.ip.forwarding` (deve ser 1); `pfctl -sn` (deve ter o `nat on ue0`); `tcpdump -ni ue0 tcp port 80` durante um `curl`        | Reaplicar `pfctl -f /etc/pf.conf`                                                                                                                                                              |
| 5   | **WAN da Pi sem internet** (rota padrão ou DHCP da WAN)                                                                                                                                                                                                               | Na Pi: `ping -c2 192.168.2.241` e `netstat -rn \| grep default`. Em 17/11 a rota padrão da Pi era `192.168.2.1` via `ue0`                          | Renovar a WAN: `service dhclient restart ue0`                                                                                                                                                  |

**Ordem de teste no cliente (uma camada de cada vez):**

```sh
ip -4 addr show enp44s0         # IP 172.16.10.111/16?
ip route                        # default via 172.16.0.1 ?
ping -c2 172.16.0.1             # chega na Pi?
curl -sI -m8 http://104.20.23.154 -H "Host: unb.br" | head -1   # internet por IP
nslookup unb.br            # DNS
curl -sI -m8 http://unb.br | head -1                            # por nome
```

Na primeira linha que falhar está o problema. Com o Wi-Fi realmente desligado, confira também que `ip route` não mostra outra rota padrão.

## 6. Pendência 2: testes de DNAT e de ICMP para a apresentação (com log)

Ainda **não foram refeitos** com o IP novo. Eles têm de ser feitos depois de resolver a pendência 1 e confirmar o IP do cliente.

### 6.1. Habilitar o log do DNAT (pedido do professor)

Hoje só a regra do ICMP tem `log`; a regra do DNAT não tem, então o `pflog0` fica vazio para a requisição redirecionada. Na Pi, em `/etc/pf.conf`, acrescente `log` à regra do DNAT:

```
pass in log on $wan_if inet proto tcp tagged DNAT_TESTE keep state
```

Aplicar: `pfctl -nf /etc/pf.conf && pfctl -f /etc/pf.conf`, e `service pflog onestart` se o `pflog0` não existir. O `log` simples registra só o primeiro pacote da conexão; use `log (all)` para ver todos. Se esta regra for mantida, o mesmo ajuste precisa entrar em `configs/pf.conf`.

### 6.2. Teste do DNAT (porta 80 da WAN para 8080 do cliente)

1. **Pi, terminal 1:** `tcpdump -n -e -ttt -i pflog0`
2. **Pi, terminal 2:** `tcpdump -ni ue1 tcp port 8080`
3. **Cliente (172.16.10.111):** `nc -lk 8080`
4. **Máquina da WAN:** `telnet IP_DA_WAN_DA_PI 80` e digitar uma frase.
5. **Pi:** `pfctl -ss | grep 8080`

Esperado: o texto digitado chega no `nc` do cliente; o `pflog0` mostra `pass in on ue0: IP_WAN.porta > 172.16.10.111.8080`; `pfctl -ss` mostra `172.16.10.111:8080 (IP_DA_WAN:80)` em `ESTABLISHED`. **Prova:** o `rdr` troca o destino e o filtro enxerga o destino já traduzido.

### 6.3. Teste do ICMP (ping para fora bloqueado)

1. **Pi:** `tcpdump -n -e -ttt -i pflog0`
2. **Cliente:** `ping 172.16.0.1` (responde) e `ping 192.168.2.241` (100% de perda).
3. **Cliente:** `curl -sI -m8 http://unb.br | head -1` (continua funcionando, se o DNS estiver bom).
4. **Pi:** `pfctl -vs rules | grep -A1 "icmp-type echoreq"` (contador de pacotes subindo).

Esperado: o `pflog0` mostra `block in on ue1: 172.16.10.111 > 192.168.2.241: ICMP echo request`, e o gateway responde. **Prova:** só o ICMP echo request para fora da LAN é barrado.

## 7. Checklist para antes de apresentar

- [ ] Pi com `ue1` em 172.16.0.1 e `ue0` com a WAN do dia.
- [ ] Cliente recebe 172.16.10.111 e gateway 172.16.0.1, em renovações repetidas.
- [x] Cliente navega na internet, com o Wi-Fi desligado (pendência 1, resolvida em 17/11). No laboratório, conferir o DNS do dia.
- [ ] DNAT testado com o log no `pflog0` (6.2).
- [ ] ICMP testado com o log no `pflog0` (6.3).
- [ ] Arquivos da Pi iguais a `configs/` (`diff`), com os dois `.conf` validados (`dnsmasq --test`, `pfctl -nf`).
- [ ] Texto do README, dos docs e do simulador atualizado para 172.16.10.111.
- [ ] DNS do laboratório (164.41.101.4 e .11) de volta, se tiver sido trocado para o teste em casa.

## 8. Para desfazer

```sh
cp /usr/local/etc/dnsmasq.conf.bak /usr/local/etc/dnsmasq.conf
cp /etc/pf.conf.bak /etc/pf.conf
service dnsmasq restart && pfctl -f /etc/pf.conf
```
