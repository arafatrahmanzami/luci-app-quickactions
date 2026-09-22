# luci-app-quickactions

Ultra-lightweight Quick Actions dashboard for OpenWrt / ImmortalWrt.

## Installation

### OpenWrt 24.10 and older (opkg)

    cd /tmp
    wget https://github.com/arafatrahmanzami/luci-app-quickactions/releases/download/v1.0.1-tabbed/luci-app-quickactions_1.0.1-r1_all.ipk
    opkg install --force-reinstall /tmp/luci-app-quickactions_1.0.1-r1_all.ipk
    /etc/init.d/rpcd restart && /etc/init.d/uhttpd restart
    rm -rf /tmp/luci-*

### OpenWrt 25.12 and newer (apk)

    cd /tmp
    wget -O luci-app-quickactions-1.0.1-r1.apk https://github.com/arafatrahmanzami/luci-app-quickactions/releases/download/v1.0.1-tabbed/luci-app-quickactions-1.0.1-r1.apk
    apk add --allow-untrusted /tmp/luci-app-quickactions-1.0.1-r1.apk
    /etc/init.d/rpcd restart && /etc/init.d/uhttpd restart
    rm -rf /tmp/luci-*

## Features

- Dashboard with live service status (auto-polling, 0% idle CPU)
- One-click theme switcher
- Configuration tab: polling interval, button style, custom icons
- Danger confirmation for high-risk commands
- Custom emoji icons per keyword

## Usage

After installation, navigate to **System -> Quick Actions**.

The page has two tabs:

- **Dashboard** -- live status buttons for all your Custom Commands
- **Configuration** -- polling interval, visual style, and service mappings

## Requirements

- `luci-base`
- `luci-app-commands`
- `rpcd-mod-file`
- `rpcd-mod-luci`

## License

Apache-2.0
