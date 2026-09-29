# luci-app-quickactions

All-in-one dashboard and system-control surface for OpenWrt / ImmortalWrt.

14 tabs: Dashboard, Essential, Tools, Logs, Services, Hotplug, Crontab,
Guest WiFi, Terminal (ttyd), Task Plan, Network Setup, Command,
Dependencies, Configuration.

---

## Installation

### OpenWrt 24.10 and older (opkg)

```sh
cd /tmp
wget https://github.com/arafatrahmanzami/luci-app-quickactions/releases/download/v3.0.0-r9/luci-app-quickactions_3.0.0-r9_all.ipk
opkg install --force-reinstall /tmp/luci-app-quickactions_3.0.0-r9_all.ipk
/etc/init.d/rpcd restart && /etc/init.d/uhttpd restart
rm -rf /tmp/luci-*
```

### OpenWrt 25.12 and newer (apk)

```sh
cd /tmp
wget -O luci-app-quickactions-3.0.0-r9.apk \
  https://github.com/arafatrahmanzami/luci-app-quickactions/releases/download/v3.0.0-r9/luci-app-quickactions-3.0.0-r9.apk
apk add --allow-untrusted /tmp/luci-app-quickactions-3.0.0-r9.apk
/etc/init.d/rpcd restart && /etc/init.d/uhttpd restart
rm -rf /tmp/luci-*
```

### Manual install (any version)

A rootfs tarball is available for advanced/manual installs:

```sh
cd /
wget https://github.com/arafatrahmanzami/luci-app-quickactions/releases/download/v3.0.0-r9/luci-app-quickactions-3.0.0-r9-rootfs.tar.gz
tar xzf luci-app-quickactions-3.0.0-r9-rootfs.tar.gz
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
| `/etc/config/quickactions` | Global settings + essential buttons + shortcuts |
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

## Helper binaries

| Binary | Purpose |
| --- | --- |
| `/usr/bin/quickactions-taskplanhandler` | Task executor, invoked by cron |
| `/usr/bin/quickactions-wifi-toggle` | Turn all radios on or off |

---

## Usage

After installation, navigate to **System → Quick Actions** (or **Quick
Actions** in the top menu if your theme supports top-level entries).

The page has 14 tabs. The Dashboard shows live status for all configured
buttons. Everything else is self-describing.

---

## Requirements

- `luci-base`
- `luci-app-commands`
- `rpcd-mod-file`
- `rpcd-mod-luci`
- `ttyd` (for the Terminal tab)

---

## Release history

### v3.0.0-r9

Guest WiFi overhaul:

- **Guest WiFi save routing** — form.Map's `handleSave` /
  `handleSaveApply` route through `applyAll()`, so the
  `guest_owner`-tagged runtime sections (network / device / dhcp /
  wifi-iface / firewall zone / forwarding / rules) are created on
  Save & Apply.
- **Enable toggle persistence** — the tab-level checkbox now writes to
  UCI. LuCI 24.10's GridSection wraps the `<input type=checkbox>`
  inside a cbid `<div>`; base `formvalue()` returned null and `save()`
  wrote `'0'` regardless. The new `formvalue` digs through the wrapper
  and the row for the real input.
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
- **Package size** — local backup files (`*.bak-before-*`) are now
  excluded via `.gitignore`.

### v3.0.0-r2

- Robust theme enumeration, ttyd reconnect, theme-agnostic iframe chrome
  removal.

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
3. Browser console output with the correct context selected (the console
   context dropdown has separate contexts for `top` and any iframe the
   page creates)
4. `logread | tail -50` and `dmesg | tail -30`

---

## License

Apache-2.0
