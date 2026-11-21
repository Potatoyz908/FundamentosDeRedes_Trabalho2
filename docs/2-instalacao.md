# Instalação: do cartão SD ao roteador pronto

## 0. Material

Raspberry Pi com fonte, microSD (16 GB ou mais), adaptador USB-Ethernet (será a LAN), dois cabos de rede, um notebook para acessar a Pi e um segundo equipamento (ou o mesmo notebook) como host de testes.

## 1. Gravar o cartão

Baixar a imagem oficial do FreeBSD 15.1 para Raspberry Pi (arm64, arquivo terminado em `RPI.img.xz`), conferir o SHA256 publicado no site do FreeBSD e gravar no microSD (por exemplo com `xzcat imagem.img.xz | sudo dd of=/dev/sdX bs=4M status=progress`, trocando `sdX` pelo cartão; conferir o dispositivo antes, pois o `dd` apaga o destino).

## 2. Primeiro boot e acesso

1. Ligar a Pi com o cabo da rede de acesso na porta nativa (`ue0`). O adaptador USB-Ethernet fica desconectado nesse primeiro momento.
2. Descobrir o IP da Pi (lista de clientes DHCP do roteador de acesso) e acessar: `ssh freebsd@IP_DA_PI`. O usuário `freebsd` está no grupo `wheel`; para virar root, usar `su -`.
3. Trocar as senhas, acertar o fuso (`tzsetup`) e conferir a data (`date`).

## 3. Identificar as interfaces

```sh
ifconfig -l
ifconfig ue0 ; ifconfig ue1      # procurar "status: active" e o MAC
```

`ue0` deve ser a interface nativa (WAN) e `ue1` o adaptador USB (LAN). Se estiverem invertidas, trocar os nomes nas macros `wan_if` e `lan_if` do `pf.conf`, em `interface=` do `dnsmasq.conf` e nas linhas `ifconfig_ue*` do `rc.conf`.

## 4. Instalar o dnsmasq

```sh
pkg install -y dnsmasq
dnsmasq --version
```

Precisa de internet na WAN. Sem ela, instalar o pacote antes, em outra rede, ou levar o `.pkg` baixado.

## 5. Copiar e validar os arquivos

No notebook, enviar os arquivos do repositório para a Pi (`scp configs/* freebsd@IP_DA_PI:/tmp/`). Na Pi, como root:

```sh
cp /etc/rc.conf /etc/rc.conf.orig              # guarda o original
cp /tmp/pf.conf /etc/pf.conf
cp /tmp/dnsmasq.conf /usr/local/etc/dnsmasq.conf
cp /tmp/rc.conf /etc/rc.conf                   # confira com: diff /etc/rc.conf.orig /etc/rc.conf

pfctl -nf /etc/pf.conf                         # sem saída = ok
dnsmasq --test -C /usr/local/etc/dnsmasq.conf  # "syntax check OK."
sh -n /etc/rc.conf                             # sem saída = ok
```

Arquivo de configuração com erro de interpretação é anulado, então a validação é obrigatória antes de reiniciar.

## 6. Reiniciar e conferir

```sh
shutdown -r now
```

Reiniciar, e não ligar o `pf` na mão, evita derrubar a sessão SSH no meio da configuração. Depois do boot:

```sh
ifconfig ue0 ; ifconfig ue1
sysctl net.inet.ip.forwarding            # 1
netstat -rn -f inet                      # default pela WAN, 172.16.0.0/16 em ue1
service pf status ; service pflog status ; service dnsmasq status
pfctl -sn ; pfctl -sr                    # regras nat, rdr e filtro
```

Desligar sempre com `shutdown -p now`, para não corromper o microSD.

## 7. Conectar o host de testes e fixar o IP

1. Ligar o adaptador USB-Ethernet ao host de testes (Wi-Fi do host desligado) e deixar a placa cabeada em DHCP.
2. Na Pi, pegar o MAC do host: `cat /var/db/dnsmasq.leases` (formato `validade MAC IP nome`) ou `grep DHCP /var/log/dnsmasq.log`.
3. Editar a linha `dhcp-host=` do `dnsmasq.conf` com esse MAC, validar e reiniciar o serviço:
   ```sh
   dnsmasq --test -C /usr/local/etc/dnsmasq.conf && service dnsmasq restart
   ```
4. Renovar o DHCP no host: ele deve receber `172.16.10.111`. É possível listar vários MACs na mesma linha (`dhcp-host=MAC1,MAC2,nome,172.16.10.111`), desde que só um esteja ligado por vez.

## 8. No laboratório

- Perguntar ao professor o valor de X da rede 192.168.X.0/24 e se a WAN é DHCP ou IP fixo.
- Com IP fixo, comentar `ifconfig_ue0="DHCP"` e ativar as linhas alternativas do `rc.conf` (`ifconfig_ue0` e `defaultrouter` com 192.168.X.Y e 192.168.X.1); reiniciar.
- Se o professor pedir DNS 192.168.X.1, trocar a opção `dns-server` do `dnsmasq.conf`.
- Se o professor usar outra máquina como host, repetir o passo 7.

## 9. Alterar um arquivo depois

Editar no repositório, validar (`pfctl -nf`, `dnsmasq --test`, `sh -n`), copiar para a Pi e aplicar: `pfctl -f /etc/pf.conf` (recarrega o `pf` sem reiniciar) ou `service dnsmasq restart`. Nunca misturar arquivos de máquinas diferentes: a cópia da Pi e a do repositório devem ser idênticas.

## 10. Problemas comuns

| Sintoma                                    | O que verificar                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Host da LAN não recebe IP                  | Cabo na `ue1`; `service dnsmasq status`; `interface=` com o nome certo; `tail /var/log/dnsmasq.log`                        |
| Recebe IP, mas não navega                  | `sysctl net.inet.ip.forwarding` = 1; `pfctl -sn`; a WAN da Pi tem internet? (`ping 192.168.2.241` na Pi)                   |
| Navega por IP, mas não por nome            | Os DNS 164.41.101.4/.11 só respondem na rede da UnB; fora dela, testar por IP                                              |
| DNAT não chega                             | `nc -lk 8080` rodando no host; firewall do host liberando 8080; host com a Pi como gateway                                 |
| Ping da LAN ainda sai                      | Estado antigo na tabela: repetir o ping; conferir `pfctl -sr \| grep icmp`                                                 |
| `pfctl -e` congela o SSH                   | Normal em sessão remota; reiniciar a Pi                                                                                    |
| Interface `ue1` não aparece                | Adaptador USB não reconhecido (`dmesg \| tail`); trocar a porta USB                                                        |
| Rota default do notebook com métrica 20100 | O NetworkManager penaliza a interface sem internet detectada; nos testes, usar `-I enp44s0` (ping) ou `--interface` (curl) |
