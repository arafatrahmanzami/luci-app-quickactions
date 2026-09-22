include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-quickactions
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Your Name <zamimondol@gmail.com>

LUCI_TITLE:=Quick Actions Dashboard
LUCI_DESCRIPTION:=Ultra-lightweight button dashboard with theme swapper, auto-polling engine, style customizer, security gates, and custom emoji icon support.
LUCI_DEPENDS:=+luci-base +luci-app-commands +rpcd-mod-file +rpcd-mod-luci

include $(TOPDIR)/feeds/luci/luci.mk

# Call BuildPackage - OpenWrt buildroot signature
$(eval $(call BuildPackage,luci-app-quickactions))
