include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-quickactions
PKG_VERSION:=2.5.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Your Name <you@example.com>

LUCI_TITLE:=Quick Actions Dashboard
LUCI_DESCRIPTION:=Tabbed dashboard with service control, hotplug rules, uninstaller, and command execution.
LUCI_DEPENDS:=+luci-base +rpcd-mod-file +rpcd-mod-luci
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

$(eval $(call BuildPackage,luci-app-quickactions))
