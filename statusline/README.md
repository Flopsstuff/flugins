# Statusline

Кастомный statusline для Claude Code. Один bash-скрипт без зависимостей от плагинов.

## Как выглядит

```ansi
[1mOpus 4.8[0m [33mhigh[0m  [[33m█████▎[0m[90m  [0m] [33m67%[0m  [1m📁 flugins[0m | 🌿 main | [33m#42 ●[0m
```

Слева направо:

| Сегмент | Что показывает |
|---------|----------------|
| `Opus 4.8` | Модель (`display_name`) |
| `high` | Уровень reasoning effort — цвет зависит от уровня (`low`→зелёный, `medium`→cyan, `high`→жёлтый, `xhigh`→magenta, `max`→ярко-красный жирный) |
| `[█████▎  ] 67%` | Заполнение контекстного окна. Бар из 1/8-блоков, цвет меняется: зелёный <30%, жёлтый 30–80%, красный >80% |
| `📁 flugins` | Имя текущей рабочей папки |
| `🌿 main` | Текущая git-ветка |
| `#42 ●` | Номер и статус PR/MR. `#` для GitHub, `!` для GitLab. Статус: `●` open (жёлтый), `✓` approved (зелёный), `✗` changes requested (красный), `◌` draft (серый) |

Статус PR/MR резолвится через `gh`/`glab`, кэшируется и обновляется в фоне (stale-while-revalidate, TTL 90с), поэтому рендер statusline **никогда не блокируется** сетевыми запросами. Поддерживается fork-сценарий: PR ищется и в `upstream`-репозитории по ветке форка.

## Требования

- `jq` — обязательно (парсинг JSON от Claude Code)
- `gh` (GitHub) и/или `glab` (GitLab) — опционально, только для сегмента PR/MR

## Установка

### Вариант 1 — через `/statusline`

1. Скопируйте скрипт к себе:
   ```bash
   cp statusline/statusline-command.sh ~/.claude/statusline-command.sh
   chmod +x ~/.claude/statusline-command.sh
   ```
2. В Claude Code выполните команду и попросите подключить готовый скрипт:
   ```
   /statusline use the script at ~/.claude/statusline-command.sh
   ```
   `/statusline` сам пропишет `statusLine` в `~/.claude/settings.json`.

### Вариант 2 — вручную

1. Скопируйте скрипт (как в шаге 1 выше).
2. Добавьте в `~/.claude/settings.json`:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "bash $HOME/.claude/statusline-command.sh"
     }
   }
   ```
3. Перезапустите Claude Code.

## Кастомизация

Цвета (ANSI-палитра), пороги цвета контекст-бара (`30` / `80`), ширина бара (`width=8`) и TTL кэша PR (`90`) задаются прямо в `statusline-command.sh` — правьте под себя.
