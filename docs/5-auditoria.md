# Auditoria do Trabalho 02 (14/11/2026)

Nota: esta auditoria é de 14/11/2026, com o host em 172.16.0.10; depois a reserva passou a 172.16.10.111 (pedido do professor). Feita por acesso SSH à Raspberry Pi (FreeBSD 15.1) e testes a partir do notebook, que estava na LAN (172.16.0.10) e também no Wi-Fi da rede de acesso (192.168.1.16). Nenhum arquivo de configuração foi alterado, nada foi commitado. Saídas brutas em `evidencias/auditoria_2026-11-14.txt`.

## Resultado por requisito

| # | Requisito | Situação | Evidência |
| --- | --- | --- | --- |
| 1 | WAN com IP da rede de acesso | OK | `ue0` 192.168.1.31/24 por DHCP |
| 2 | LAN /16 privada | OK | `ue1` 172.16.0.1/16 |
| 3 | NAT | OK | tcpdump nas duas pontas + `pfctl -ss` |
| 4 | Conectividade | OK | ping ao gateway, curl, traceroute (1º salto 172.16.0.1) |
| 5 | Isolamento | OK | portas 80/8080/53/443 em drop; só SSH e ping ao roteador passam. Com rota forçada a partir de um host WAN (namespace `wan`): ping 100% de perda, `nc` com timeout, contador 678 para 725 |
| 6 | DHCP | OK | DORA completo e renovações no log |
| 7 | DNS 164.41.101.4/.11 | OK na entrega; resolução só na UnB | opção 6 enviada; fora da UnB os dois expiram |
| 8 | IP fixo | OK | sempre 172.16.0.10 (várias renovações) |
| 9 | Leases em log | OK | `dnsmasq.leases` e `dnsmasq.log` |
| 10 | DNAT 80 para 8080 | OK | `telnet 192.168.1.31 80` a partir de host WAN; texto passou nos dois sentidos; estado `ESTABLISHED` no `pfctl -ss` |
| 11 | Bloqueio de ICMP | OK | 100% de perda para 8.8.8.8; gateway responde; `pflog0` registra |
| 12 | Arquivos sem erro | OK | `pfctl -nf`, `dnsmasq --test`, `sh -n` sem erro; arquivos da Pi idênticos aos de `configs/` |
| 13 | Persistência no boot | OK | `pf` ativo desde o boot, serviços em execução |
| 14 | Start/stop do serviço | OK | `service dnsmasq stop/start` funcionou, porta 67 fecha e reabre |

## Lacunas encontradas e corrigidas (documentação)

- README com as seções 2 a 6 vazias (valem 30% da nota): preenchido e reorganizado, com `docs/` numerada e diagramas próprios.
- Faltavam `docs/3-validacao.md`, `versoes.txt` e evidências reais: criados.

## Como foi fechado o teste com um só notebook

Criou-se um namespace de rede temporário (`wan`, com `ipvlan` sobre o Wi-Fi, IP 192.168.1.17) que age como máquina do lado WAN, mais uma rota de retorno `192.168.1.17/32 via 172.16.0.1` no notebook para a resposta do servidor da LAN voltar pela Pi. Tudo removido ao final (`limpa.sh`). Num cenário real isso equivale a um segundo equipamento na rede de acesso com a Pi como gateway da LAN.

## Cenários extras pedidos pelo professor (executados em 16/11/2026)

Relatos de outros grupos: bloquear um IP, fazer a LAN falar com um cliente na WLAN, mudar o IP de um computador, cortar a conexão e outros itens. Todos foram executados na Pi com restauração do estado original depois de cada um (regras, NAT e arquivos idênticos aos de `configs/`). Procedimentos em [4-demonstracao.md](4-demonstracao.md), seção "Pedidos extras"; saídas reais em `evidencias/extras_2026-11-16.txt`.

| Pedido | Resultado | Observação |
| --- | --- | --- |
| Bloquear um host da LAN | OK | `block drop log quick on ue1 ... from 172.16.0.10 to ! 172.16.0.0/16` + `pfctl -k`: `http=200` virou `000`, gateway continuou respondendo, `pflog0` registrou |
| Bloquear um IP de destino | OK | Conexão já aberta continuou passando; nova conexão bloqueada; `pfctl -F states` derruba as antigas |
| LAN → WLAN | TCP OK; ping bloqueado pelo requisito | O servidor da WLAN viu a origem 192.168.1.29 (NAT). Exceção `pass in quick ... to IP` acima da regra `REQUISITO` libera o ping só para esse IP |
| WLAN → LAN | OK com regra e rota | `pass in on ue0 ... to 172.16.0.0/16` no fim do arquivo e rota via Pi no cliente; sem isso, timeout |
| Mudar o IP reservado do host | OK | `dhcp-host` + `host_alvo`; apagar a lease antiga; o cliente precisa derrubar/subir a interface (lease `infinite`); DNAT chegou ao novo IP |
| IP manual em um computador | OK | `pf` trata qualquer origem de 172.16.0.0/16 |
| Cortar a conexão | OK | `pfctl -F nat`/`-F states`, `pfctl -k`, `ifconfig ue0 down` + `service dhclient restart ue0`, `ifconfig ue1 down`, `service dnsmasq stop` |
| Bloquear porta, liberar ping, mudar a porta do DNAT | OK | Porta 80 bloqueada (443 passa); ping liberado comentando a regra; DNAT para 9090 |

Achados: a Pi reiniciou e subiu `pf`, `pflog` e `dnsmasq` sozinha (persistência no boot confirmada); o IP da WAN mudou entre sessões (192.168.1.31 para .29) sem exigir ajuste, porque o NAT usa `(ue0)`; `ifconfig ue1 down` derruba o SSH que entra pela LAN.

## Pendências (não dá para resolver sozinho)

1. **Host de testes do professor:** a reserva está no MAC `0c:cc:47:ec:09:6b` (este notebook). Se o professor usar outro, ler o MAC no log e trocar `dhcp-host` (ver README, passo 5). Sugestão: já listar o MAC de cada notebook do grupo na mesma linha (`dhcp-host=MAC1,MAC2,nome,172.16.0.10`).
2. **No laboratório:** descobrir o X da rede 192.168.X.0/24; se a WAN for IP fixo, usar as linhas comentadas do `rc.conf`; os DNS 164.41.101.x só serão testáveis lá.
3. **Antes de entregar:** montar o ZIP (README, `configs/`, `versoes.txt`, `docs/`, `evidencias/`), validar de novo os arquivos a partir do ZIP. Os prints dos testes já estão em `evidencias/prints/`.
4. **Plágio:** as configs e os textos são do grupo. O `docs/PLANO.md` (rascunho interno) cita nominalmente o repositório de referência; não deve ir para o repositório nem para o ZIP.
5. NTP: `ntpq -p` mostrava `reach 0` logo após o boot; a data estava correta. Conferir de novo na apresentação (`date`).
6. O boot foi confirmado em 16/11/2026: a Pi reiniciou antes dos testes e `pf`, `pflog` e `dnsmasq` subiram sozinhos. Não houve um reboot comandado por nós; conferir de novo no dia.
