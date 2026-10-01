# luci-app-quickactions

All-in-one dashboard and system-control surface for OpenWrt / ImmortalWrt.

17 tabs: Dashboard, Essential, Tools, Logs, Services, Hotplug, Crontab,
Guest WiFi, Terminal (ttyd), Task Plan, Network Setup, Command,
Dependencies, Scripts, Failover, VLAN, Configuration.

---

## Installation

### OpenWrt 24.10 and older (opkg)

```sh
cd /tmp
wget https://github.com/arafatrahmanzami/luci-app-quickactions/releases/download/v3.0.0-r11/luci-app-quickactions_3.0.0-r11_all.ipk
opkg install --force-reinstall /tmp/luci-app-quickactions_3.0.0-r11_all.ipk
/etc/init.d/rpcd restart && /etc/init.d/uhttpd restart
rm -rf /tmp/luci-*
```

### OpenWrt 25.12 and newer (apk)

```sh
cd /tmp
wget -O luci-app-quickactions-3.0.0-r11.apk \
  https://github.com/arafatrahmanzami/luci-app-quickactions/releases/download/v3.0.0-r11/luci-app-quickactions-3.0.0-r11.apk
apk add --allow-untrusted /tmp/luci-app-quickactions-3.0.0-r11.apk
/etc/init.d/rpcd restart && /etc/init.d/uhttpd restart
rm -rf /tmp/luci-*
```

### Manual install (any version)

A rootfs tarball is available for advanced/manual installs:

```sh
cd /
wget https://github.com/arafatrahmanzami/luci-app-quickactions/releases/download/v3.0.0-r11/luci-app-quickactions-3.0.0-r11-rootfs.tar.gz
tar xzf luci-app-quickactions-3.0.0-r11-rootfs.tar.gz
chmod 755 /usr/bin/quickactions-*
chmod 755 /etc/init.d/quickactions-*
/etc/init.d/rpcd restart && /etc/init.d/uhttpd restart
rm -rf /tmp/luci-*
```

---

## Upgrade from v3.0.0-r8 or older

Existing installs with the old `/12` guest WiFi netmask need a one-time
migration. The old default caused multiple guests to share one kernel
route, which broke internet for all but one guest SSID.

**Method 1 (UI):** open the **Guest WiFi** tab, click **Save & Apply**
once. This rebuilds the runtime config from `/etc/config/guestwifi`.

**Method 2 (SSH):**

```sh
for s in $(uci show guestwifi | grep '=guest' | cut -d. -f2); do
    uci set guestwifi.$s.netmask=255.255.255.0
done
uci commit guestwifi

for n in guest guest_2 guest_3; do
    uci set network.$n.netmask=255.255.255.0 2>/dev/null
done
uci commit network
/etc/init.d/network reload
```

Then reconnect any guest clients so they get a fresh /24 DHCP lease.

---

## Features

### Dashboard

- Live service status buttons (auto-polling, configurable interval)
- One-click theme switcher (Argon, Bootstrap, Bootstrap-Dark, Bootstrap-Light, Footstrap, Material, Matrix, Oat, OpenWrt)
- One-click language switcher
- Custom emoji icons per keyword
- Danger confirmation for high-risk commands

### Essential

- Reorderable one-tap buttons for routine actions
- Up/down arrows to shuffle order

### Tools

- PPPoE setup form (backs up `/etc/config/network` first)
- Change root password
- **Wireless Quick Edit** — edit SSID / security / password / network /
  enabled state for every `wifi-iface` on every radio. Bidirectional
  sync with the Guest WiFi tab when the interface carries a
  `guest_owner` tag.
- Quick navigation shortcuts to other LuCI pages

### Logs

- System log level changer (persists and reloads)
- Cron restart / log viewer
- Live log viewer (last 50 lines, errors only, kernel dmesg)

### Services

- Enable / disable / restart / status for any init service
- List enabled, disabled, and active ubus services

### Hotplug

- Interface event rules (`ifup`, `ifdown`, `ifupdate`, etc.)
- Connectivity monitors with interface reset / reboot thresholds
- Handlers auto-generated into `/etc/hotplug.d/iface/91-qa-hp-*`

### Crontab

- Graphical cron builder with multiselect hour/minute/day/month/weekday
- Live preview of the generated crontab line
- Human-readable description
- Add to `/etc/crontabs/root` and reload cron

### Guest WiFi

- Multiple isolated guest networks, each with its own SSID, DHCP, and firewall zone
- Per-radio SSIDs (2.4 GHz / 5 GHz / 6 GHz)
- WPA2/WPA3/mixed/OWE/WEP/open encryption
- Client isolation, DHCP range, lease time
- Firewall rules auto-generated with `guest_owner` tag for safe cleanup
- QR code generator for easy client onboarding
- Strong password generator with configurable length and character sets
- Default netmask /24 for each guest network

### Terminal (ttyd)

- Embedded ttyd terminal
- Auto-login toggle (root shell vs. login prompt)
- Force reconnect for stale sessions
- Full ttyd config form

### Task Plan

- Scheduled tasks (reboot, shutdown, WiFi up/down, custom script, etc.)
- Startup tasks with configurable delay
- Log viewer

### Network Setup

- Mode selection (DHCP / PPPoE / Side-Router)
- WAN settings with smart diff (only changed fields are written)
- Wireless base SSID with auto-append per band
- Firmware and system preferences
- nginx shortcuts
- Aggressive rebuild (opt-in, backed up)

### Command

- Direct shell command runner
- Built-in OpenWrt command reference with 12 categories

### Dependencies

- Package dependency inspector (apk / opkg auto-detect)
- List all installed packages with dependencies
- System package summary

### Scripts

- Create / edit / run / delete shell scripts
- Scripts stored in `/etc/quickactions/scripts/`
- Metadata in `/etc/config/quickactions` (`config script` sections)
- Category tags, timeout, argument passing
- Failover-lite preset installer (MWAN3 substitute)
- Built-in help modal

### Failover

- Cron-driven ping test through the primary interface
- On repeated failure, flushes the conntrack table so the kernel falls
  back to the backup with the lowest route metric
- Zero background RAM when idle — a single ping run per minute
- Configurable primary, backups, check IPs, thresholds, ping timeout
- Optional Tailscale restart on failover and recovery
- Optional firewall reload on failover
- Enable / Disable / Run watchdog / Refresh status buttons
- Full parameter editor in the tab
- Uses `/usr/bin/wan-watchdog.sh` (cron every 60 s),
  `/etc/hotplug.d/iface/99-quickactions-conntrack-flush`,
  and `/usr/bin/quickactions-failover` (master switch)

### VLAN

- 9 subtabs: Overview, Wizard, Edit, Library, SSID, Import, Safety,
  Diagnostics, Guide
- **Overview** — platform detection (DSA vs swconfig), bridges,
  VLANs, interfaces, DHCP pools, firewall zones, wireless ifaces,
  EasyMesh devices. Resource-tier selector (auto / low / high)
- **Wizard** — 7-step flow: target platform, VLAN ID + parent bridge,
  per-port tagged/untagged assignment, logical interface, DHCP pool,
  firewall zone, optional SSID attach
- **Edit** — inline editor for `bridge-vlan` and `network.interface`
- **Library** — save / load / delete reusable VLAN templates and
  generated CLI scripts
- **SSID** — bulk attach any wifi-iface to any network interface
- **Import** — parse MikroTik RouterOS, Cisco IOS, EdgeOS, or generic
  802.1Q configs in-browser, then apply or generate CLI
- **Safety** — snapshots, restore, 90-second auto-rollback
- **Diagnostics** — live `bridge vlan show`, kernel interface stats,
  cross-VLAN ping
- **Guide** — full VLAN primer with lockout warnings and cross-platform
  syntax examples
- Cross-platform CLI generation: OpenWrt DSA, OpenWrt swconfig,
  MikroTik RouterOS 6/7, Cisco IOS/NX-OS, EdgeOS, generic 802.1Q

### Configuration

- Polling interval
- Button style (Modern Flat / Tactile 3D)
- Essential buttons editor
- Service mappings
- Navigation shortcuts

---

## Configuration files

| File | Purpose |
| --- | --- |
| `/etc/config/quickactions` | Global settings + essential buttons + shortcuts + failover + vlan + scripts metadata |
| `/etc/config/guestwifi` | Guest WiFi source of truth (per-network settings) |
| `/etc/config/hotplug` | Interface event rules + connectivity monitors |
| `/etc/config/taskplan` | Scheduled and startup tasks |

All four are declared as `conffiles` in the Makefile, so user changes
survive `opkg upgrade` / `apk upgrade`.

---

## Init scripts

| Script | Purpose |
| --- | --- |
| `/etc/init.d/quickactions-hotplug` | Regenerates hotplug handler scripts from `/etc/config/hotplug` |
| `/etc/init.d/quickactions-taskplan` | Runs scheduled and startup tasks |
| `/etc/init.d/quickactions-netwizard` | Applies shortcuts and backups |
| `/etc/init.d/quickactions-failover` | Installs cron + hotplug handler for the failover system |

## Helper binaries

| Binary | Purpose |
| --- | --- |
| `/usr/bin/quickactions-taskplanhandler` | Task executor, invoked by cron |
| `/usr/bin/quickactions-wifi-toggle` | Turn all radios on or off |
| `/usr/bin/wan-watchdog.sh` | Failover watchdog, invoked by cron every 60 s |
| `/usr/bin/quickactions-failover` | Failover master switch (`on` / `off` / `status` / `test`) |

## rpcd backends

| Object | Purpose |
| --- | --- |
| `luci.quickactions-taskplan` | Task Plan read/run endpoints |
| `luci.quickactions-failover` | Failover status, interfaces, on/off/test |
| `luci.quickactions-scripts` | Script list/read/write/run/delete |
| `luci.quickactions-vlan` | VLAN detect, apply, snapshots, generate CLI, diagnostics |

---

## Usage

After installation, navigate to **System → Quick Actions** (or **Quick
Actions** in the top menu if your theme supports top-level entries).

The Dashboard shows live status for all configured buttons. The other
16 tabs are self-describing. Every tab has an in-page guide or tooltips
where the meaning isn't obvious.

---

## Requirements

- `luci-base`
- `luci-app-commands`
- `rpcd-mod-file`
- `rpcd-mod-luci`
- `ttyd` (for the Terminal tab)

Optional (for extended VLAN diagnostics):

- `python3-light` (VLAN wizard apply)
- `lldp` (network map neighbor discovery)
- `snmp-utils` (external switch VLAN query)

---

## Release history

### v3.0.0-r11

- **Dynamic language switcher** — reads installed languages from
  `/usr/lib/lua/luci/i18n/` and maps display names. Bengali now shows
  as বাংলা instead of `bn`.
- **Command exit code visibility** — Command tab and Tools show
  `[exit code N]` prefix and use a warning toast when a command fails.
- **Progress toasts** auto-dismiss after 8 seconds via
  `ui.addTimeLimitedNotification`.
- **Essential "Download Config Backup"** — now runs
  `/sbin/sysupgrade -b` to create a real backup file and lists it in
  the toast (previous `@download:` endpoint returned "Invalid form
  data" because it requires a POST with CSRF token).
- **Makefile**: removed `/etc/config/netwizard` from `conffiles`
  (owned by `luci-app-netwizard`); dropped the bundled netwizard
  config from this package.

### v3.0.0-r10

- **New VLAN tab** — 9 subtabs, cross-platform config generation for
  MikroTik / Cisco / EdgeOS / generic 802.1Q, snapshots + auto-rollback.
- **New Scripts tab** — create / edit / run / delete shell scripts;
  Failover-lite preset.
- **New Failover tab** — cron-driven ping test with conntrack flush on
  primary WAN failure; watchdog + hotplug handler + master switch.
- **Wireless Quick Edit** — edit every wifi-iface (SSID / security /
  password / network / enabled); bidirectional sync with Guest WiFi
  when the interface is a guest.
- **rpcd backends** for failover, scripts, VLAN.
- **ACL** extended with 3 new rpcd objects.
- **uci-defaults** seeders for failover, scripts, and VLAN directories.
- Minor fixes to Guest WiFi save routing, log level display, and
  package hygiene (`*.bak-before-*` excluded via `.gitignore`).

### v3.0.0-r9

Guest WiFi overhaul:

- **Guest WiFi save routing** — form.Map's `handleSave` /
  `handleSaveApply` route through `applyAll()`, so the
  `guest_owner`-tagged runtime sections (network / device / dhcp /
  wifi-iface / firewall zone / forwarding / rules) are created on
  Save & Apply.
- **Enable toggle persistence** — the tab-level checkbox now writes to
  UCI. LuCI 24.10's GridSection wraps the `<input type=checkbox>`
  inside a cbid `<div>`; base `formvalue()` returned null and
  `save()` wrote `'0'` regardless. The new `formvalue` digs through
  the wrapper and the row for the real input.
- **Save semantics** — `applyAll()` no longer calls
  `ui.changes.apply()`; only Save & Apply triggers the reload.
- **Default netmask** changed from `/12` to `/24`. Multiple guests on
  one `/12` shared a single kernel route, breaking internet on all but
  one SSID.
- **Config preservation** — the package no longer ships
  `/etc/config/guestwifi`. A `uci-defaults` seeder creates it on first
  install only. All configs declared as `conffiles`.
- **Log level** — loads `system` UCI so the displayed value matches
  `/etc/config/system`, and reloads the page after Apply.

### v3.0.0-r2

- Robust theme enumeration, ttyd reconnect, theme-agnostic iframe chrome removal.

### v3.0.0

- 12-module full release.

### v1.0.1-tabbed

- Fix: resolve `form.Map` Promise in tabbed config view.

---

## Reporting issues

When reporting a bug, include:

1. OpenWrt / ImmortalWrt version (`cat /etc/openwrt_release`)
2. Package version (`opkg list-installed | grep quickactions` or
   `apk list -I | grep quickactions`)
3. Browser console output with the correct context selected (the
   console context dropdown has separate contexts for `top` and any
   iframe the page creates)
4. `logread | tail -50` and `dmesg | tail -30`

---

## License

Apache-2.0
