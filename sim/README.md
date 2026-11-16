# Simulador interativo do lab (D0–D7)

Terminal web estático que simula os três papéis da demonstração (**pi**, **lan**, **wan**) com saídas fiéis às evidências de 14/11/2026.

## Uso local

1. Abra `index.html` no navegador **ou** sirva a pasta:

```powershell
cd FundamentosDeRedes_Trabalho2\sim
python -m http.server 8765
```

2. Acesse `http://localhost:8765`
3. No painel **Guia** à direita: leia *Por que rodar* → **Executar** (ou **Preencher** + Enter) → confira *O que observar*.
4. Versão em Markdown (também no Pages): [`GUIA.md`](GUIA.md).

> Módulos ES (`type="module"`) exigem HTTP em alguns navegadores — prefira o `http.server` acima em vez de `file://` se algo não carregar.

## Comandos meta

| Comando | Efeito |
| --- | --- |
| `pi` / `lan` / `wan` | Troca o papel |
| `demo` | Lista D0–D7 |
| `help` | Ajuda resumida |
| `reset` | Reinicia contadores, serviços e sessões |
| `clear` | Limpa a tela |

## GitHub Pages (depois)

1. Publique o repositório no GitHub.
2. Em **Settings → Pages**, escolha branch `main` (ou `gh-pages`) e pasta `/docs` **ou** root.
3. Se Pages estiver na raiz do repo, a URL será:

```text
https://<usuario>.github.io/<repositorio>/FundamentosDeRedes_Trabalho2/sim/
```

4. Alternativa limpa: configurar Pages com root em `FundamentosDeRedes_Trabalho2/sim` (se o provedor permitir subpasta como root) ou copiar/publicar só o conteúdo de `sim/` na branch `gh-pages`.

Todos os caminhos neste simulador são **relativos** (`styles.css`, `js/…`), então funcionam em subdiretório no Pages.

## O que é simulado

Estado compartilhado entre contextos: NAT após `curl` na LAN, DNAT após `nc -lk 8080` + `telnet` na WAN, contadores do `pf` no isolamento e no bloqueio de ping, stop/start do `dnsmasq`.

Não é FreeBSD nem rede reais — serve para ensaiar comandos e narrativas da apresentação.
