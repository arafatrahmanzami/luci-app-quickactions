'use strict';
'require view';
'require ui';
'require uci';
'require rpc';
'require form';
'require fs';
'require dom';
'require uqr';
'require tools.widgets as widgets';

var GuestWifiViewClass = (function() {

/*
	Copyright 2026 Rafał Wabik - IceG - From eko.one.pl forum
	
	Licensed to the GNU General Public License v3.0.
*/

let DEFAULTS = {
	ssid:          'Guest-WiFi',
	encryption:    'psk2',
	password:      '',
	radio:         'radio0',
	isolate:       '1',
	macaddr:       '',
	ip:            '172.16.0.1',
	netmask:       '255.240.0.0',
	dhcpStart:     '100',
	dhcpLimit:     '150',
	dhcpLease:     '12h',
	fwForwardDest: 'wan',
	fwInput:       'REJECT',
	fwOutput:      'ACCEPT',
	fwForward:     'REJECT',
	fwDhcpPorts:   '67-68',
	fwDnsPort:     '53'
};

let OWNER_TAG = 'guest_owner';

function addGuestWifiStyles() {
	let style = document.createElement('style');
	style.type = 'text/css';
	style.textContent = '\
		:root {\
			--gw-badge-on-bg:      #34c759;\
			--gw-badge-off-bg:     #7f8c8d;\
			--gw-badge-text:       #ffffff;\
			--gw-badge-shadow:     0 1px 2px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.25);\
			--gw-badge-border-on:  transparent;\
			--gw-badge-border-off: transparent;\
		}\
		:root[data-darkmode="true"] {\
			--gw-badge-on-bg:      rgba(46,204,113,0.28);\
			--gw-badge-off-bg:     rgba(255,255,255,0.12);\
			--gw-badge-text:       #e5e7eb;\
			--gw-badge-shadow:     0 1px 2px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.22);\
			--gw-badge-border-on:  rgba(46,204,113,0.5);\
			--gw-badge-border-off: rgba(255,255,255,0.3);\
		}\
		.gw-badge {\
			display:inline-block;\
			padding:4px 10px;\
			border-radius:4px;\
			color:var(--gw-badge-text);\
			font-size:13px;\
			font-weight:500;\
			white-space:nowrap;\
			text-align:center;\
			border:1px solid transparent;\
			text-shadow:var(--gw-badge-shadow);\
		}\
		.gw-badge-on  { background:var(--gw-badge-on-bg);  border-color:var(--gw-badge-border-on);  }\
		.gw-badge-off { background:var(--gw-badge-off-bg); border-color:var(--gw-badge-border-off); }\
	';
	document.head.appendChild(style);
}

function ssidBadge(section_id, text) {
	let val = uci.get('guestwifi', section_id, 'enable');
	let enabled = (val == null) ? true : (val === '1');
	let cls = 'gw-badge ' + (enabled ? 'gw-badge-on' : 'gw-badge-off');
	return E('span', { 'class': cls }, text || '');
}

function radioBadge(section_id, radioName, wifiDevices) {
	let val = uci.get('guestwifi', section_id, 'enable');
	let enabled = (val == null) ? true : (val === '1');
	let label = radioLabel(radioName, wifiDevices);

	return E('span', { 'class': 'ifacebadge' }, [
		E('img', { 'src': L.resource('icons/wifi%s.svg').format(enabled ? '' : '_disabled') }),
		' ',
		label,
		'\u00A0'
	]);
}

let ENCRYPTION_MODES = [
	['psk2',       'WPA2-PSK'],
	['sae',        'WPA3-SAE'],
	['sae-mixed',  'WPA2-PSK/WPA3-SAE ' + _('Mixed Mode')],
	['psk-mixed',  'WPA-PSK/WPA2-PSK ' + _('Mixed Mode')],
	['psk',        'WPA-PSK'],
	['owe',        'OWE (' + _('Enhanced Open') + ')'],
	['wep-open',   _('WEP Open System')],
	['wep-shared', _('WEP Shared Key')],
	['none',       _('No encryption (open network)')]
];

function encryptionLabel(key) {
	let hit = ENCRYPTION_MODES.filter(function(m) { return m[0] === key; })[0];
	return hit ? hit[1] : key;
}

let PASSWORD_CHARSETS = {
	upper:   'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
	lower:   'abcdefghijklmnopqrstuvwxyz',
	digits:  '1234567890',
	special: '!@#$%^&*()-_=+[]{}?'
};

function secureRandomInt(max) {
	let cryptoObj = window.crypto || window.msCrypto;
	let arr = new Uint32Array(1);

	if (cryptoObj && cryptoObj.getRandomValues) {
		cryptoObj.getRandomValues(arr);
		return arr[0] % max;
	}

	return Math.floor(Math.random() * max);
}

function shuffleArray(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		let j = secureRandomInt(i + 1);
		let tmp = arr[i];
		arr[i] = arr[j];
		arr[j] = tmp;
	}
	return arr;
}

function generateStrongPassword(length, components) {
	let chosenSets = (components || []).map(function(c) { return PASSWORD_CHARSETS[c]; }).filter(Boolean);

	if (!chosenSets.length)
		chosenSets = [PASSWORD_CHARSETS.lower, PASSWORD_CHARSETS.digits];

	length = Math.max(parseInt(length, 10) || 0, chosenSets.length);
	length = Math.min(Math.max(length, 8), 63);

	let pool = chosenSets.join('');
	let result = chosenSets.map(function(set) { return set.charAt(secureRandomInt(set.length)); });

	for (let i = result.length; i < length; i++)
		result.push(pool.charAt(secureRandomInt(pool.length)));

	return shuffleArray(result).join('');
}

let cbiPasswordComponentsValue = form.ListValue.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		let choices = this.transformChoices();
		let widget = new ui.Dropdown(
			(cfgvalue != null) ? cfgvalue : this.default,
			choices,
			{
				id: this.cbid(section_id),
				sort: this.keylist,
				optional: true,
				multiple: true,
				display_items: 4,
				dropdown_items: 4,
				select_placeholder: this.placeholder,
				validate: L.bind(this.validate, this, section_id),
				disabled: (this.readonly != null) ? this.readonly : this.map.readonly
			}
		);

		window.__guestPasswordComponentsDropdown = window.__guestPasswordComponentsDropdown || {};
		window.__guestPasswordComponentsDropdown[section_id] = widget;

		return widget.render();
	}
});

function buildSVGQRCode(data, code, options, dummy) {
	let opts = Object.assign({
		pixelSize: 4,
		whiteColor: 'white',
		blackColor: 'black',
		ecc: 'M'
	}, options);

	let svg = uqr.renderSVG(data, opts);

	if (dummy)
		return svg;

	code.style.opacity = '';
	dom.content(code, Object.assign(E(svg), { style: 'width:100%;height:auto' }));
}

function assignNetIndexes() {
	let defs = uci.sections('guestwifi', 'guest');
	let used = {};

	defs.forEach(function(def) {
		let idx = parseInt(def.net_idx, 10);
		if (idx > 0)
			used[idx] = true;
	});

	let nextIdx = 1;
	function takeNextFreeIdx() {
		while (used[nextIdx]) nextIdx++;
		used[nextIdx] = true;
		return nextIdx;
	}

	defs.forEach(function(def) {
		let idx = parseInt(def.net_idx, 10);
		if (!(idx > 0))
			uci.set('guestwifi', def['.name'], 'net_idx', String(takeNextFreeIdx()));
	});
}

function namesForNetIndex(idx) {
	let suf = (idx > 1) ? String(idx) : '';
	return {
		networkName: 'guest'     + (suf ? '_' + suf : ''),
		deviceName:  'br-guest'  + suf,
		wifiName:    'guestwifi' + (suf ? '_' + suf : ''),
		dhcpName:    'guest'     + (suf ? '_' + suf : '')
	};
}

let IP_POOL_FIRST_OCTET  = 172;
let IP_POOL_SECOND_FIRST = 16;
let IP_POOL_SECOND_LAST  = 31;

function usedInterfaceIps(excludeSid) {
	let used = {};

	uci.sections('guestwifi', 'guest').forEach(function(s) {
		if (s['.name'] === excludeSid) return;
		if (s.interface_ip) used[s.interface_ip] = true;
	});
	uci.sections('network', 'interface').forEach(function(s) {
		if (excludeSid != null && s[OWNER_TAG] === excludeSid) return;
		if (s.ipaddr) used[s.ipaddr] = true;
	});

	return used;
}

function randomFreeGuestIp(excludeSid) {
	let used = usedInterfaceIps(excludeSid);
	let candidates = [];

	for (let o2 = IP_POOL_SECOND_FIRST; o2 <= IP_POOL_SECOND_LAST; o2++) {
		let ip = IP_POOL_FIRST_OCTET + '.' + o2 + '.0.1';
		if (!used[ip])
			candidates.push(ip);
	}

	if (!candidates.length)
		return null;

	return candidates[Math.floor(Math.random() * candidates.length)];
}

function bandLabelForDevice(dev) {
	if (!dev)
		return '';

	let band = dev.band;
	if (band === '2g') return '2.4 GHz';
	if (band === '5g') return '5 GHz';
	if (band === '6g') return '6 GHz';

	let hw = dev.hwmode || '';
	if (/^11a/.test(hw) && !/^11ax/.test(hw)) {
		return '5 GHz';
	}
	if (/^11(b|g)/.test(hw))
		return '2.4 GHz';

	let htmode = dev.htmode || '';
	if (/^HE160|HE80|VHT/.test(htmode))
		return '5 GHz';

	return '';
}

function radioLabel(radioName, wifiDevices) {
	let dev = wifiDevices.filter(function(d) { return d['.name'] === radioName; })[0];
	let band = bandLabelForDevice(dev);
	return band ? (radioName + ' (' + band + ')') : radioName;
}

function uciDeleteMatching(config, type, field, value) {
	uci.sections(config, type).forEach(function(s) {
		if (s[field] === value)
			uci.remove(config, s['.name']);
	});
}

function cleanupGuestConfig(validSids, ownerSid) {
	function shouldRemove(s) {
		let owner = s[OWNER_TAG];
		if (!owner)
			return false;
		if (ownerSid != null)
			return owner === ownerSid;
		return validSids.indexOf(owner) === -1;
	}

	uci.sections('network', 'interface').forEach(function(s) {
		if (shouldRemove(s)) uci.remove('network', s['.name']);
	});
	uci.sections('network', 'device').forEach(function(s) {
		if (shouldRemove(s)) uci.remove('network', s['.name']);
	});
	uci.sections('wireless', 'wifi-iface').forEach(function(s) {
		if (shouldRemove(s)) uci.remove('wireless', s['.name']);
	});
	uci.sections('dhcp', 'dhcp').forEach(function(s) {
		if (shouldRemove(s)) uci.remove('dhcp', s['.name']);
	});
	uci.sections('firewall', 'zone').forEach(function(s) {
		if (shouldRemove(s)) uci.remove('firewall', s['.name']);
	});
	uci.sections('firewall', 'forwarding').forEach(function(s) {
		if (shouldRemove(s)) uci.remove('firewall', s['.name']);
	});
	uci.sections('firewall', 'rule').forEach(function(s) {
		if (shouldRemove(s)) uci.remove('firewall', s['.name']);
	});
}

function collectOwnerSids() {
	let sids = {};

	uci.sections('network', 'interface').forEach(function(s) { if (s[OWNER_TAG]) sids[s[OWNER_TAG]] = true; });
	uci.sections('network', 'device').forEach(function(s) { if (s[OWNER_TAG]) sids[s[OWNER_TAG]] = true; });
	uci.sections('wireless', 'wifi-iface').forEach(function(s) { if (s[OWNER_TAG]) sids[s[OWNER_TAG]] = true; });
	uci.sections('dhcp', 'dhcp').forEach(function(s) { if (s[OWNER_TAG]) sids[s[OWNER_TAG]] = true; });
	uci.sections('firewall', 'zone').forEach(function(s) { if (s[OWNER_TAG]) sids[s[OWNER_TAG]] = true; });
	uci.sections('firewall', 'forwarding').forEach(function(s) { if (s[OWNER_TAG]) sids[s[OWNER_TAG]] = true; });
	uci.sections('firewall', 'rule').forEach(function(s) { if (s[OWNER_TAG]) sids[s[OWNER_TAG]] = true; });

	return Object.keys(sids);
}

function importGuestNetwork(sid) {
	let iface = uci.sections('network', 'interface').filter(function(s) { return s[OWNER_TAG] === sid; })[0];
	let dhcp  = uci.sections('dhcp', 'dhcp').filter(function(s) { return s[OWNER_TAG] === sid; })[0];
	let wifi  = uci.sections('wireless', 'wifi-iface').filter(function(s) { return s[OWNER_TAG] === sid; })[0];
	let zone  = uci.sections('firewall', 'zone').filter(function(s) { return s[OWNER_TAG] === sid; })[0];
	let fwd   = uci.sections('firewall', 'forwarding').filter(function(s) { return s[OWNER_TAG] === sid; })[0];
	let rules = uci.sections('firewall', 'rule').filter(function(s) { return s[OWNER_TAG] === sid; });

	let dhcpRule = rules.filter(function(r) { return r.proto === 'udp'; })[0];
	let dnsRule  = rules.filter(function(r) { return r.proto === 'tcpudp'; })[0];

	uci.add('guestwifi', 'guest', sid);
	uci.set('guestwifi', sid, 'enable', (wifi && wifi.disabled === '1') ? '0' : '1');

	if (wifi) {
		uci.set('guestwifi', sid, 'ssid', wifi.ssid || DEFAULTS.ssid);
		uci.set('guestwifi', sid, 'radio', wifi.device || DEFAULTS.radio);
		uci.set('guestwifi', sid, 'isolate', wifi.isolate || DEFAULTS.isolate);
		if (wifi.macaddr)
			uci.set('guestwifi', sid, 'macaddr', wifi.macaddr);

		if (!wifi.encryption || wifi.encryption === 'none' || wifi.encryption === 'owe') {
			uci.set('guestwifi', sid, 'encryption', wifi.encryption || 'none');
		} else if (wifi.encryption === 'wep-open' || wifi.encryption === 'wep-shared') {
			uci.set('guestwifi', sid, 'encryption', wifi.encryption);
			uci.set('guestwifi', sid, 'password', wifi.key1 || DEFAULTS.password);
		} else {
			uci.set('guestwifi', sid, 'encryption', wifi.encryption);
			uci.set('guestwifi', sid, 'password', wifi.key || DEFAULTS.password);
		}
	}

	if (iface) {
		uci.set('guestwifi', sid, 'interface_ip', iface.ipaddr || DEFAULTS.ip);
		uci.set('guestwifi', sid, 'netmask', iface.netmask || DEFAULTS.netmask);
	}

	if (dhcp) {
		uci.set('guestwifi', sid, 'dhcp_start', dhcp.start || DEFAULTS.dhcpStart);
		uci.set('guestwifi', sid, 'dhcp_limit', dhcp.limit || DEFAULTS.dhcpLimit);
		uci.set('guestwifi', sid, 'dhcp_lease', dhcp.leasetime || DEFAULTS.dhcpLease);
	}

	if (zone) {
		uci.set('guestwifi', sid, 'fw_input', zone.input || DEFAULTS.fwInput);
		uci.set('guestwifi', sid, 'fw_output', zone.output || DEFAULTS.fwOutput);
		uci.set('guestwifi', sid, 'fw_forward', zone.forward || DEFAULTS.fwForward);
	}

	if (fwd) {
		uci.set('guestwifi', sid, 'fw_forward_dest', fwd.dest || DEFAULTS.fwForwardDest);
	}

	if (dhcpRule) {
		uci.set('guestwifi', sid, 'fw_dhcp_ports', dhcpRule.dest_port || DEFAULTS.fwDhcpPorts);
	}

	if (dnsRule) {
		uci.set('guestwifi', sid, 'fw_dns_port', dnsRule.dest_port || DEFAULTS.fwDnsPort);
	}
}

function knownGuestSids() {
	return uci.sections('guestwifi', 'guest').map(function(s) { return s['.name']; });
}

function resolveDuplicateInterfaceIps() {
	let seen = {};

	uci.sections('guestwifi', 'guest').forEach(function(def) {
		let sid = def['.name'];
		let ip  = def.interface_ip;
		if (!ip) return;

		if (seen[ip]) {
			let newIp = randomFreeGuestIp(sid);
			if (newIp) {
				uci.set('guestwifi', sid, 'interface_ip', newIp);
				seen[newIp] = true;
			}
		} else {
			seen[ip] = true;
		}
	});
}

function guessLegacyInterfaceNames() {
	return uci.sections('network', 'interface').filter(function(s) {
		if (s[OWNER_TAG]) return false;
		if (/^cfg[0-9a-f]+$/i.test(s['.name'])) return false;
		return /guest/i.test(s['.name']) || /guest/i.test(s.device || '');
	}).map(function(s) { return s['.name']; });
}

function zoneMatchesNetwork(zone, ifname) {
	let net = zone.network;
	if (Array.isArray(net)) return net.indexOf(ifname) !== -1;
	return net === ifname;
}

function importLegacyGuestNetwork(ifname) {
	let sid = ifname;

	uci.set('network', ifname, OWNER_TAG, sid);

	let iface = uci.sections('network', 'interface').filter(function(s) { return s['.name'] === ifname; })[0];
	let deviceName = iface ? iface.device : null;

	if (deviceName) {
		let dev = uci.sections('network', 'device').filter(function(d) { return d.name === deviceName; })[0];
		if (dev) uci.set('network', dev['.name'], OWNER_TAG, sid);
	}

	let dhcp = uci.sections('dhcp', 'dhcp').filter(function(d) { return d.interface === ifname; })[0];
	if (dhcp) uci.set('dhcp', dhcp['.name'], OWNER_TAG, sid);

	let wifi = uci.sections('wireless', 'wifi-iface').filter(function(w) { return w.network === ifname; })[0];
	if (wifi) uci.set('wireless', wifi['.name'], OWNER_TAG, sid);

	let zone = uci.sections('firewall', 'zone').filter(function(z) { return zoneMatchesNetwork(z, ifname); })[0];
	if (zone) {
		uci.set('firewall', zone['.name'], OWNER_TAG, sid);

		let zoneName = zone.name || zone['.name'];
		uci.sections('firewall', 'forwarding').forEach(function(f) {
			if (f.src === zoneName) uci.set('firewall', f['.name'], OWNER_TAG, sid);
		});
		uci.sections('firewall', 'rule').forEach(function(r) {
			if (r.src === zoneName) uci.set('firewall', r['.name'], OWNER_TAG, sid);
		});
	}

	importGuestNetwork(sid);
}

function importExistingGuestNetworks() {
	collectOwnerSids().forEach(function(sid) {
		if (knownGuestSids().indexOf(sid) === -1)
			importGuestNetwork(sid);
	});

	guessLegacyInterfaceNames().forEach(function(ifname) {
		if (knownGuestSids().indexOf(ifname) === -1)
			importLegacyGuestNetwork(ifname);
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('network'),
			uci.load('wireless'),
			uci.load('dhcp'),
			uci.load('firewall'),
			uci.load('guestwifi')
		]).then(function() {
			importExistingGuestNetworks();
		});
	},

	buildGuestNetwork: function(sid) {
		let get = function(name, def) { return uci.get('guestwifi', sid, name) || def; };

		let enabled    = get('enable', '1') === '1';
		let ssid       = get('ssid', DEFAULTS.ssid);
		let encryption = get('encryption', DEFAULTS.encryption);
		let password   = get('password', DEFAULTS.password);
		let radio      = get('radio', DEFAULTS.radio);
		let isolate    = get('isolate', DEFAULTS.isolate);
		let macaddr    = get('macaddr', DEFAULTS.macaddr);
		let ip         = get('interface_ip', DEFAULTS.ip);
		let netmask    = get('netmask', DEFAULTS.netmask);
		let dhcpStart  = get('dhcp_start', DEFAULTS.dhcpStart);
		let dhcpLimit  = get('dhcp_limit', DEFAULTS.dhcpLimit);
		let dhcpLease  = get('dhcp_lease', DEFAULTS.dhcpLease);
		let fwDest     = get('fw_forward_dest', DEFAULTS.fwForwardDest);
		let fwInput    = get('fw_input', DEFAULTS.fwInput);
		let fwOutput   = get('fw_output', DEFAULTS.fwOutput);
		let fwForward  = get('fw_forward', DEFAULTS.fwForward);
		let fwDhcpPorts= get('fw_dhcp_ports', DEFAULTS.fwDhcpPorts);
		let fwDnsPort  = get('fw_dns_port', DEFAULTS.fwDnsPort);

		let netIdx = parseInt(get('net_idx', ''), 10);
		let names  = namesForNetIndex(netIdx > 0 ? netIdx : 1);
		let networkName = names.networkName;
		let deviceName  = names.deviceName;
		let wifiName    = names.wifiName;
		let dhcpName    = names.dhcpName;

		// NETWORK
		uci.add('network', 'interface', networkName);
		uci.set('network', networkName, OWNER_TAG, sid);
		uci.set('network', networkName, 'device', deviceName);
		uci.set('network', networkName, 'proto', 'static');
		uci.set('network', networkName, 'ipaddr', ip);
		uci.set('network', networkName, 'netmask', netmask);

		let devSid = uci.add('network', 'device');
		uci.set('network', devSid, OWNER_TAG, sid);
		uci.set('network', devSid, 'name', deviceName);
		uci.set('network', devSid, 'type', 'bridge');
		uci.set('network', devSid, 'bridge_empty', '1');

		// DHCP
		uci.add('dhcp', 'dhcp', dhcpName);
		uci.set('dhcp', dhcpName, OWNER_TAG, sid);
		uci.set('dhcp', dhcpName, 'start', dhcpStart);
		uci.set('dhcp', dhcpName, 'limit', dhcpLimit);
		uci.set('dhcp', dhcpName, 'leasetime', dhcpLease);
		uci.set('dhcp', dhcpName, 'interface', networkName);
		uci.set('dhcp', dhcpName, 'dhcpv4', 'server');

		uci.set('dhcp', dhcpName, 'ignore', enabled ? '0' : '1');

		// WIRELESS
		uci.add('wireless', 'wifi-iface', wifiName);
		uci.set('wireless', wifiName, OWNER_TAG, sid);
		uci.set('wireless', wifiName, 'device', radio);
		uci.set('wireless', wifiName, 'mode', 'ap');
		uci.set('wireless', wifiName, 'network', networkName);
		uci.set('wireless', wifiName, 'ssid', ssid);
		uci.set('wireless', wifiName, 'isolate', isolate);

		if (macaddr)
		uci.set('wireless', wifiName, 'macaddr', macaddr);
		uci.set('wireless', wifiName, 'disabled', enabled ? '0' : '1');

		if (encryption === 'none' || encryption === 'owe') {
			uci.set('wireless', wifiName, 'encryption', encryption);
		} else if (encryption === 'wep-open' || encryption === 'wep-shared') {
			uci.set('wireless', wifiName, 'encryption', encryption);
			uci.set('wireless', wifiName, 'key', '1');
			uci.set('wireless', wifiName, 'key1', password);
		} else {
			uci.set('wireless', wifiName, 'encryption', encryption);
			uci.set('wireless', wifiName, 'key', password);
		}

		// FIREWALL
		let zoneSid = uci.add('firewall', 'zone');
		uci.set('firewall', zoneSid, OWNER_TAG, sid);
		uci.set('firewall', zoneSid, 'name', networkName);
		uci.set('firewall', zoneSid, 'network', [ networkName ]);
		uci.set('firewall', zoneSid, 'input', fwInput);
		uci.set('firewall', zoneSid, 'output', fwOutput);
		uci.set('firewall', zoneSid, 'forward', fwForward);

		let fwdSid = uci.add('firewall', 'forwarding');
		uci.set('firewall', fwdSid, OWNER_TAG, sid);
		uci.set('firewall', fwdSid, 'src', networkName);
		uci.set('firewall', fwdSid, 'dest', fwDest);

		// Rule: DHCP
		let dhcpRuleSid = uci.add('firewall', 'rule');
		uci.set('firewall', dhcpRuleSid, OWNER_TAG, sid);
		uci.set('firewall', dhcpRuleSid, 'src', networkName);
		uci.set('firewall', dhcpRuleSid, 'proto', 'udp');
		uci.set('firewall', dhcpRuleSid, 'src_port', fwDhcpPorts);
		uci.set('firewall', dhcpRuleSid, 'dest_port', fwDhcpPorts);
		uci.set('firewall', dhcpRuleSid, 'target', 'ACCEPT');
		uci.set('firewall', dhcpRuleSid, 'family', 'ipv4');

		// Rule: DNS
		let dnsRuleSid = uci.add('firewall', 'rule');
		uci.set('firewall', dnsRuleSid, OWNER_TAG, sid);
		uci.set('firewall', dnsRuleSid, 'src', networkName);
		uci.set('firewall', dnsRuleSid, 'dest_port', fwDnsPort);
		uci.set('firewall', dnsRuleSid, 'target', 'ACCEPT');
		uci.set('firewall', dnsRuleSid, 'family', 'ipv4');
		uci.set('firewall', dnsRuleSid, 'proto', 'tcpudp');
	},

	applyAll: function(m) {
		let self = this;

		return m.save().then(function() {
			resolveDuplicateInterfaceIps();

			assignNetIndexes();

			let defs = uci.sections('guestwifi', 'guest');
			let validSids = defs.map(function(s) { return s['.name']; });

			cleanupGuestConfig(validSids, null);

			defs.forEach(function(def) {
				let sid = def['.name'];
				cleanupGuestConfig(validSids, sid);
				self.buildGuestNetwork(sid);
			});

			return uci.save();
		}).then(function() {
			return ui.changes.apply(false);
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Error saving configuration:') + ' ' + err.message), 'error');
		});
	},

	render: function() {
		let self = this;

		addGuestWifiStyles();

		let wifiDevices = uci.sections('wireless', 'wifi-device');
		let radios = wifiDevices.map(function(d) { return d['.name']; });
		if (!radios.length)
			radios = ['radio0', 'radio1', 'radio2'];

		let m = new form.Map('guestwifi', _('Guest Wi-Fi'),
			_('A user interface for easily creating and management isolated Wi-Fi networks for guests, each with its own access point, DHCP, and firewall rules.'));

		self.map = m;

		let s = m.section(form.GridSection, 'guest', _('Guest networks'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Add new guest network...');

		s.tab('general', _('General'));
		s.tab('security', _('Security'));
		s.tab('network', _('Network & DHCP'));
		s.tab('firewall', _('Firewall'));

		let o = s.taboption('general', form.Flag, 'enable', _('Enabled'),
			_('Enable guest network.'));
		o.rmempty = false;
		o.default = '1';
		o.editable = true;

		o = s.taboption('general', form.Value, 'ssid', _('Network name (SSID)'));
		o.rmempty = false;
		o.default = DEFAULTS.ssid;
		o.textvalue = function(section_id) {
			let val = this.cfgvalue(section_id) || this.default;
			return ssidBadge(section_id, val);
		};

		o = s.taboption('general', form.ListValue, 'radio', _('Radio'),
			_('The radio on which the guest network will work.'));
		radios.forEach(function(r) { o.value(r, radioLabel(r, wifiDevices)); });
		o.default = DEFAULTS.radio;
		o.rmempty = false;
		o.textvalue = function(section_id) {
			let val = this.cfgvalue(section_id) || this.default;
			return radioBadge(section_id, val, wifiDevices);
		};

		o = s.taboption('security', form.ListValue, 'encryption', _('Encryption'),
			_('WPA2-PSK is recommended for most devices. WPA3-SAE offers the strongest security but requires WPA3-capable clients.'));
		ENCRYPTION_MODES.forEach(function(m) { o.value(m[0], m[1]); });
		o.default = DEFAULTS.encryption;
		o.rmempty = false;
		o.textvalue = function(section_id) {
			let val = this.cfgvalue(section_id) || this.default;
			return encryptionLabel(val);
		};

		o = s.taboption('network', form.Value, 'interface_ip', _('Interface IP address'));
		o.datatype = 'ip4addr';
		o.rmempty = false;
		o.default = DEFAULTS.ip;
		o.cfgvalue = function(section_id) {
			let val = uci.get('guestwifi', section_id, 'interface_ip');
			if (val) return val;
			return randomFreeGuestIp(section_id) || DEFAULTS.ip;
		};

		o.textvalue = function(section_id) {
			let val = this.cfgvalue(section_id) || this.default;
			return E('code', {}, val);
		};
		o.validate = function(section_id, value) {
			if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value))
				return true;

			let used = usedInterfaceIps(section_id);
			if (!used[value])
				return true;

			let newIp = randomFreeGuestIp(section_id);
			if (!newIp) {
				return _('The address %s is already in use and no free address is available in the 172.16.0.1 - 172.31.0.1 range.').format(value);
			}

			let el = this.getUIElement(section_id);
			if (el) el.setValue(newIp);
			return true;
		};

		o = s.taboption('network', form.Value, 'netmask', _('Netmask'));
		o.datatype = 'ip4addr';
		o.rmempty = false;
		o.default = DEFAULTS.netmask;
		o.modalonly = true;

		o = s.taboption('network', form.Value, 'dhcp_start', _('DHCP range start'),
			_('Lowest leased address, as offset from the network address.'));
		o.datatype = 'uinteger';
		o.rmempty = false;
		o.default = DEFAULTS.dhcpStart;
		o.modalonly = true;

		o = s.taboption('network', form.Value, 'dhcp_limit', _('DHCP client limit'),
			_('Maximum number of leased addresses.'));
		o.datatype = 'uinteger';
		o.rmempty = false;
		o.default = DEFAULTS.dhcpLimit;
		o.modalonly = true;

		o = s.taboption('network', form.Value, 'dhcp_lease', _('DHCP lease time'),
			_('E.g. "1h", "30m", "12h". Minimum is "2m".'));
		o.rmempty = false;
		o.default = DEFAULTS.dhcpLease;

		o = s.taboption('security', form.Value, 'password', _('Password'), ' ');
		o.password = true;
		o.depends('encryption', 'psk');
		o.depends('encryption', 'psk2');
		o.depends('encryption', 'psk-mixed');
		o.depends('encryption', 'sae');
		o.depends('encryption', 'sae-mixed');
		o.depends('encryption', 'wep-open');
		o.depends('encryption', 'wep-shared');
		o.default = DEFAULTS.password;
		o.modalonly = true;
		o.validate = function(section_id, value) {
			let enc = this.map.lookupOption('encryption', section_id)[0].formvalue(section_id);

			let inputEl = document.getElementById(this.cbid(section_id));
			let strength = inputEl ? inputEl.parentNode.querySelector('.cbi-value-description') : null;
			let strongRegex = new RegExp("^(?=.{8,})(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*\\W).*$", "g"),
			    mediumRegex = new RegExp("^(?=.{7,})(((?=.*[A-Z])(?=.*[a-z]))|((?=.*[A-Z])(?=.*[0-9]))|((?=.*[a-z])(?=.*[0-9]))).*$", "g"),
			    enoughRegex = new RegExp("(?=.{6,}).*", "g");

			if (strength) {
				if (!value || !value.length)
					strength.innerHTML = '';
				else if (false == enoughRegex.test(value))
					strength.innerHTML = '%s: <span style="color:red">%s</span>'.format(_('Password strength'), _('More Characters'));
				else if (strongRegex.test(value))
					strength.innerHTML = '%s: <span style="color:green">%s</span>'.format(_('Password strength'), _('Strong'));
				else if (mediumRegex.test(value))
					strength.innerHTML = '%s: <span style="color:orange">%s</span>'.format(_('Password strength'), _('Medium'));
				else
					strength.innerHTML = '%s: <span style="color:red">%s</span>'.format(_('Password strength'), _('Weak'));
			}

			if (!value)
				return true;

			if (enc === 'wep-open' || enc === 'wep-shared') {
				let isHex = /^[0-9a-fA-F]+$/.test(value);
				let validLength = isHex ? (value.length === 10 || value.length === 26)
				                        : (value.length === 5 || value.length === 13);
				if (!validLength)
					return _('WEP key must be 5 or 13 ASCII characters, or 10 or 26 hexadecimal digits.');
				return true;
			}

			if (enc !== 'none' && enc !== 'owe' && value.length < 8)
				return _('Password must be at least 8 characters long (WPA-PSK/WPA2-PSK/WPA3-SAE).');

			return true;
		};

		let passwordDependsOn = function(opt) {
			opt.depends('encryption', 'psk');
			opt.depends('encryption', 'psk2');
			opt.depends('encryption', 'psk-mixed');
			opt.depends('encryption', 'sae');
			opt.depends('encryption', 'sae-mixed');
			opt.depends('encryption', 'wep-open');
			opt.depends('encryption', 'wep-shared');
		};

		o = s.taboption('security', form.Value, 'password_length', _('Password length'),
			_('Minimum length is 8 characters, 13 characters recommended.'));
		o.datatype = 'range(8,63)';
		o.default = '13';
		o.rmempty = true;
		o.modalonly = true;
		passwordDependsOn(o);

		o = s.taboption('security', cbiPasswordComponentsValue, 'password_components', _('Password composition'),
			_('Character types to use when generating a password.'));
		o.value('upper',   _('Uppercase letters'));
		o.value('lower',   _('Lowercase letters'));
		o.value('digits',  _('Digits'));
		o.value('special', _('Special characters'));
		o.default = ['upper', 'lower', 'digits', 'special'];
		o.placeholder = _('Select password components...');
		o.rmempty = true;
		o.modalonly = true;
		passwordDependsOn(o);

		o = s.taboption('security', form.Button, '_password_generate', _('Generate password'));
		o.inputtitle = _('Generate');
		o.inputstyle = 'action';
		o.modalonly = true;
		passwordDependsOn(o);
		o.onclick = function(ev, section_id) {
			let section = this.section;
			let lengthEl = section.getUIElement(section_id, 'password_length');
			let componentsEl = section.getUIElement(section_id, 'password_components');
			let passwordEl = section.getUIElement(section_id, 'password');

			let length = lengthEl ? parseInt(lengthEl.getValue(), 10) : 16;
			let components = componentsEl ? componentsEl.getValue() : [];

			if (!Array.isArray(components))
				components = components ? [components] : [];

			let newPassword = generateStrongPassword(length, components);

			if (passwordEl) {
				passwordEl.setValue(newPassword);
				if (typeof passwordEl.triggerValidation === 'function')
					passwordEl.triggerValidation();
			}
		};

		o = s.taboption('security', form.DummyValue, '_qrops', _('QR Code'),
			_('Generates a QR code with the guest network data (SSID, encryption, password) so a client device can scan and connect.'));
		o.modalonly = true;

		o.createWiFiPassword = function(section_id) {
			function pctEncode(str) {
				let bytes = new TextEncoder().encode(str);
				let out = '';

				for (let i = 0; i < bytes.length; i++) {
					let b = bytes[i];
					let printable = (b >= 0x20 && b <= 0x3A && b !== 0x3B) || (b >= 0x3C && b <= 0x7E);

					if (printable)
						out += String.fromCharCode(b);
					else
						out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
				}

				return out;
			}

			let wifiSSID = this.section.formvalue(section_id, 'ssid');
			let wifiEncr = this.section.formvalue(section_id, 'encryption') || '';
			let wifiKey  = this.section.formvalue(section_id, 'password');

			let trdisable = '';
			if (wifiEncr === 'sae') trdisable = 0;
			else if (wifiEncr === 'owe') trdisable = 3;

			return [
				'WIFI:',
				(wifiKey) ? 'T:WPA;' : null,
				(trdisable !== '') ? 'R:' + trdisable + ';' : null,
				'S:' + wifiSSID + ';',
				(wifiKey) ? 'P:' + pctEncode(wifiKey) + ';' : null
			].filter(Boolean).join('') + ';';
		};

		o.handleGenerateQR = function(section_id, ev) {
			let parent = s.map;
			let mapNode = document.querySelector('body.modal-overlay-active > #modal_overlay > .modal.cbi-modal > .cbi-map:not(.hidden)');
			let headNode = mapNode.parentNode.querySelector('h4');
			let wifiQRGenerator = this.createWiFiPassword.bind(this, section_id);

			return Promise.all([
				parent.save(null, true)
			]).then(function() {
				let qrm, qrs, qro;

				qrm = new form.JSONMap({ qrcode: {} }, null, _('Scan this QR code with the client device.'));
				qrm.parent = parent;

				qrs = qrm.section(form.NamedSection, 'qrcode');

				function handleQRParamChange(ev, section_id, value) {
					let code = this.map.findElement('.qr-code');
					let conf = this.map.findElement('.wifi-qr-code-content');
					let ecc = this.section.getUIElement(section_id, 'ecc');

					if (this.isValid(section_id)) {
						conf.firstChild.data = wifiQRGenerator(section_id);
						code.style.opacity = '.5';
						buildSVGQRCode(conf.firstChild.data, code, { ecc: ecc.getValue() });
					}
				}

				qro = qrs.option(form.ListValue, 'ecc', _('QR Error Correction Code Level'));
				qro.value('L', _('Low'));
				qro.value('M', _('Medium'));
				qro.value('Q', _('Quartile'));
				qro.value('H', _('High'));
				qro.onchange = handleQRParamChange;

				qro = qrs.option(form.DummyValue, 'output');
				qro.renderWidget = function() {
					let wifi_qr = wifiQRGenerator(section_id);
					let ecc = this.section.formvalue(section_id, 'ecc');

					return E('div', {
						'class': 'qr-code-display',
						'style': 'display:flex; flex-wrap:wrap; align-items:center; gap:.5em'
					}, [
						E('div', { 'class': 'qr-code' }, [
							E(buildSVGQRCode(wifi_qr, null, { ecc: ecc || undefined }, true))
						]),
						E('pre', {
							'class': 'wifi-qr-code-content',
							'style': 'flex:1; overflow:auto; word-break:break-all;',
							'click': function(ev) {
								let sel = window.getSelection();
								let range = document.createRange();

								range.selectNodeContents(ev.currentTarget);

								sel.removeAllRanges();
								sel.addRange(range);
							}
						}, [wifi_qr])
					]);
				};

				return qrm.render().then(function(nodes) {
					let dStyle = mapNode.style;
					mapNode.style.display = 'none';

					let bRowStyle = mapNode.nextElementSibling.style;
					mapNode.nextElementSibling.style.display = 'none';

					headNode.appendChild(E('span', [' » ', _('Generate guest WiFi QR…')]));
					mapNode.parentNode.appendChild(E([], [
						nodes,
						E('div', { 'class': 'right' }, [
							E('button', {
								'class': 'btn',
								'click': function() {
									nodes.parentNode.removeChild(nodes.nextSibling);
									nodes.parentNode.removeChild(nodes);
									mapNode.style = dStyle;
									mapNode.nextSibling.style = bRowStyle;
									headNode.removeChild(headNode.lastChild);
								}
							}, [_('Back to settings')])
						])
					]));
				});
			});
		};

		o.cfgvalue = function(section_id) {
			return E('button', {
				'class': 'btn qr-code',
				'style': 'display:inline-flex;align-items:center;gap:.5em',
				'click': ui.createHandlerFn(this, 'handleGenerateQR', section_id)
			}, [
				E(buildSVGQRCode('openwrt.org', null, { pixelSize: 1, ecc: 'L' }, true)),
				_('Generate QR…')
			]);
		};

		o = s.taboption('security', form.ListValue, 'isolate', _('Client isolation'),
			_('Blocks communication between clients on this guest network.'));
		o.value('1', _('Yes'));
		o.value('0', _('No'));
		o.default = DEFAULTS.isolate;
		o.rmempty = false;
		o.modalonly = true;

		o = s.taboption('security', form.Value, 'macaddr', _('MAC address'),
			_('Override default MAC address - the range of usable addresses might be limited by the driver'));
		o.value('', _('driver default'));
		o.value('random', _('randomly generated'));
		o.datatype = "or('random',macaddr)";
		o.default = DEFAULTS.macaddr;
		o.rmempty = true;
		o.modalonly = true;

		o = s.taboption('firewall', widgets.ZoneSelect, 'fw_forward_dest', _('Forwarding destination zone'),
			_('Firewall zone guest traffic is forwarded to (usually "wan"). Pick an existing zone from the list or fill out the <em>-- custom --</em> field to enter one manually.'));
		o.rmempty = false;
		o.default = DEFAULTS.fwForwardDest;
		o.modalonly = true;

		o = s.taboption('firewall', form.ListValue, 'fw_input', _('Input'),
			_('Traffic from guests to the router itself (e.g. LuCI, SSH).'));
		o.value('REJECT', _('reject')); o.value('ACCEPT', _('accept')); o.value('DROP', _('drop'));
		o.default = DEFAULTS.fwInput;
		o.rmempty = false;
		o.modalonly = true;

		o = s.taboption('firewall', form.ListValue, 'fw_output', _('Output'),
			_('Traffic from the router itself to guests. ACCEPT is recommended so router services (DHCP, DNS) keep working.'));
		o.value('REJECT', _('reject')); o.value('ACCEPT', _('accept')); o.value('DROP', _('drop'));
		o.default = DEFAULTS.fwOutput;
		o.rmempty = false;
		o.modalonly = true;

		o = s.taboption('firewall', form.ListValue, 'fw_forward', _('Forward'),
			_('Traffic passing between guests and other networks/zones (e.g. LAN). Keep this REJECT or DROP to isolate guests from your LAN. ACCEPT would allow guests to reach other networks.'));
		o.value('REJECT', _('reject')); o.value('ACCEPT', _('accept')); o.value('DROP', _('drop'));
		o.default = DEFAULTS.fwForward;
		o.rmempty = false;
		o.modalonly = true;

		o = s.taboption('firewall', form.Value, 'fw_dhcp_ports', _('DHCP rule ports'),
			_('UDP port range for DHCP traffic, e.g. "67-68".'));
		o.rmempty = false;
		o.default = DEFAULTS.fwDhcpPorts;
		o.modalonly = true;

		o = s.taboption('firewall', form.Value, 'fw_dns_port', _('DNS rule port'));
		o.datatype = 'port';
		o.rmempty = false;
		o.default = DEFAULTS.fwDnsPort;
		o.modalonly = true;

		return m.render();
	},

	handleSave: function(ev) {
		return this.applyAll(this.map);
	},
	handleSaveApply: null,
	handleReset: null
});

})();

return view.extend({
    pollInterval: 5,
    designStyle: '3d',
    timerId: null,
    customMappings: {},
    installedThemes: [],
    callInitStatus: null,
    callSystemCommand: null,
    activeTab: 'dashboard',

    load: function() {
        var self = this;
        this.callInitStatus = rpc.declare({ object: 'luci', method: 'getInitList', expect: { '': {} } });
        this.callSystemCommand = rpc.declare({ object: 'file', method: 'exec', params: [ 'command', 'params' ], expect: { '': {} } });
        return uci.load('quickactions').catch(function(){}).then(function() {
            var interval = uci.get('quickactions', 'global', 'poll_interval');
            self.pollInterval = parseInt(interval, 10) || 5;
            self.designStyle = uci.get('quickactions', 'global', 'design_style') || '3d';
            var maps = uci.sections('quickactions', 'mapping') || [];
            self.customMappings = {};
            maps.forEach(function(sec) {
                if (sec.keyword) {
                    self.customMappings[sec.keyword.toLowerCase().trim()] = {
                        service: sec.service ? sec.service.trim() : null,
                        dangerous: sec.dangerous === '1',
                        icon: sec.icon ? sec.icon.trim() : ''
                    };
                }
            });
            return self.fetchThemeList().then(function(themes) {
                self.installedThemes = themes || [];
                return Promise.all([
                    uci.load('luci').then(function() { return uci.sections('luci', 'command'); }).catch(function(){ return []; }),
                    self.callInitStatus().catch(function(){ return {}; })
                ]);
            });
        });
    },

    fetchThemeList: function() {
        return this.callSystemCommand('/bin/sh', ['-c', 'opkg list-installed 2>/dev/null | grep "^luci-theme-" | sed "s/ .*//"']).then(function(r) {
            return (r.stdout || '').split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; }).map(function(p) { return p.replace(/^luci-theme-/, ''); });
        }).catch(function() { return []; });
    },

    handleThemeSwitch: function(themeKey) {
        uci.load('luci').then(function() {
            var cur = uci.get('luci', 'main', 'mediaurlbase');
            var nb = '/luci-static/' + themeKey;
            if (cur === nb) { ui.addNotification('Theme', 'Already using "' + themeKey + '".', 'info'); return; }
            ui.addNotification('Theme', 'Applying "' + themeKey + '"...', 'info');
            uci.set('luci', 'main', 'mediaurlbase', nb);
            uci.save().then(function() { return uci.apply(10, true); }).then(function() { setTimeout(function() { window.location.reload(); }, 1500); })
              .catch(function(err) { ui.addNotification('Theme Error', (err && err.message) ? err.message : String(err), 'danger'); });
        }).catch(function(err) { ui.addNotification('Theme Error', (err && err.message) ? err.message : String(err), 'danger'); });
    },

    handleLanguageSwitch: function(langCode) {
        uci.load('luci').then(function() {
            var cur = uci.get('luci', 'main', 'lang') || 'en';
            if (cur === langCode) { ui.addNotification('Language', 'Already set.', 'info'); return; }
            ui.addNotification('Language', 'Switching to ' + langCode + '...', 'info');
            uci.set('luci', 'main', 'lang', langCode);
            uci.save().then(function() { return uci.apply(10, true); }).then(function() { setTimeout(function() { window.location.reload(); }, 1500); })
              .catch(function(err) { ui.addNotification('Language Error', (err && err.message) ? err.message : String(err), 'danger'); });
        }).catch(function(err) { ui.addNotification('Language Error', (err && err.message) ? err.message : String(err), 'danger'); });
    },

    moveItem: function(section, name, direction) {
        var self = this;
        var secs = (uci.sections('quickactions', section) || []).slice();
        if (secs.length < 2) return;
        secs.sort(function(a, b) { return (parseInt(a.order, 10) || 999) - (parseInt(b.order, 10) || 999); });
        var idx = -1;
        for (var i = 0; i < secs.length; i++) { if (secs[i]['.name'] === name) { idx = i; break; } }
        if (idx < 0) return;
        var target = direction === 'up' ? idx - 1 : idx + 1;
        if (target < 0 || target >= secs.length) return;
        secs.forEach(function(s, i) { uci.set('quickactions', s['.name'], 'order', String((i + 1) * 10)); });
        var aOrder = (idx + 1) * 10;
        var bOrder = (target + 1) * 10;
        uci.set('quickactions', secs[idx]['.name'], 'order', String(bOrder));
        uci.set('quickactions', secs[target]['.name'], 'order', String(aOrder));
        return uci.save().then(function() { ui.addNotification('Reordered', name + ' moved ' + direction, 'info'); });
    },

    getServiceInfo: function(buttonName) {
        var name = buttonName.toLowerCase();
        for (var kw in this.customMappings) { if (name.includes(kw)) return this.customMappings[kw]; }
        return null;
    },

    getServiceStatus: function(buttonName, initList) {
        if (!buttonName || !initList) return null;
        var name = buttonName.toLowerCase();
        var info = this.getServiceInfo(buttonName);
        if (info && info.service && initList[info.service]) return initList[info.service].enabled && initList[info.service].running;
        var fb = { 'dns':'dnsmasq','dhcp':'dnsmasq','firewall':'firewall','vpn':'openvpn','wireguard':'network' };
        for (var k in fb) { if (name.includes(k) && initList[fb[k]]) return initList[fb[k]].enabled && initList[fb[k]].running; }
        return null;
    },

    executeValidatedCommand: function(commandStr, buttonName, btnElement) {
        var self = this;
        btnElement.setAttribute('data-executing', 'true');
        btnElement.style.opacity = '0.5';
        ui.addNotification('Executing', buttonName + ' is running...', 'info');
        this.callSystemCommand('/bin/sh', [ '-c', commandStr ]).then(function(result) {
            btnElement.setAttribute('data-executing', 'false');
            btnElement.style.opacity = '1';
            var output = result.stdout || '';
            if (result.stderr) output += '\n[stderr]\n' + result.stderr;
            if (!output.trim()) output = 'Done.';
            var uid = 'qa-out-' + Date.now();
            var pre = document.createElement('pre');
            pre.id = uid;
            pre.style.cssText = 'text-align:left;white-space:pre-wrap;max-height:70vh;overflow-y:auto;background:#1e1e1e;color:#00ff00;padding:15px;border-radius:8px;font-family:monospace;font-size:0.9em;width:100%;box-sizing:border-box;margin:0;';
            pre.textContent = output;
            ui.addNotification(buttonName + ' Done', pre, 'info');
            var el = document.getElementById(uid);
            if (el && el.closest) { var c = el.closest('.alert'); if (c) { c.style.maxWidth = '95%'; c.style.width = 'auto'; } }
            self.updateAllButtonsRealtime();
        }).catch(function(err) {
            btnElement.setAttribute('data-executing', 'false');
            btnElement.style.opacity = '1';
            ui.addNotification('Failed', (err && err.message) ? err.message : String(err), 'danger');
        });
    },

    handleButtonClick: function(commandStr, buttonName, btnElement) {
        if (btnElement.getAttribute('data-executing') === 'true') return;
        var info = this.getServiceInfo(buttonName);
        if (info && info.dangerous) {
            if (confirm('Warning: high-risk operation (' + buttonName + ').\nProceed?')) this.executeValidatedCommand(commandStr, buttonName, btnElement);
        } else this.executeValidatedCommand(commandStr, buttonName, btnElement);
    },

    applyLiveColor: function(element, isRunning) {
        if (isRunning) { element.style.backgroundColor = '#2ed573'; if (this.designStyle === '3d') element.style.borderBottom = '5px solid #26b360'; }
        else { element.style.backgroundColor = '#ff4757'; if (this.designStyle === '3d') element.style.borderBottom = '5px solid #d93d4b'; }
    },

    updateAllButtonsRealtime: function() {
        var self = this;
        var gridNode = document.getElementById('quickactions-grid-container');
        if (!gridNode) { if (this.timerId) { clearInterval(this.timerId); this.timerId = null; } return; }
        this.callInitStatus().then(function(initList) {
            var buttons = gridNode.getElementsByClassName('custom-action-btn');
            for (var i = 0; i < buttons.length; i++) {
                var btn = buttons[i];
                if (btn.getAttribute('data-executing') === 'true') continue;
                var bName = btn.getAttribute('data-name');
                var isRunning = self.getServiceStatus(bName, initList);
                if (isRunning !== null) self.applyLiveColor(btn, isRunning);
            }
        }).catch(function(){});
    },

    runCommand: function(cmd, label) {
        return this.callSystemCommand('/bin/sh', [ '-c', cmd ]).then(function(r) {
            var out = r.stdout || '';
            if (r.stderr) out += '\n[stderr]\n' + r.stderr;
            if (!out.trim()) out = 'Done.';
            var uid = 'qa-tool-out-' + Date.now();
            var pre = document.createElement('pre');
            pre.id = uid;
            pre.style.cssText = 'text-align:left;white-space:pre-wrap;max-height:70vh;overflow-y:auto;background:#1e1e1e;color:#00ff00;padding:12px;border-radius:6px;font-family:monospace;font-size:0.9em;width:100%;box-sizing:border-box;margin:0;';
            pre.textContent = out;
            ui.addNotification(label + ' Done', pre, 'info');
            var el = document.getElementById(uid);
            if (el && el.closest) { var c = el.closest('.alert'); if (c) { c.style.maxWidth = '95%'; c.style.width = 'auto'; } }
            return r;
        });
    },

    renderDashboard: function(cmds, initList) {
        var self = this;
        var currentLang = (uci.get('luci', 'main', 'lang') || 'en');
        var themeBar = E('div', { 'style': 'background:rgba(0,0,0,0.04);padding:12px 14px;border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;' }, [E('strong', { 'style': 'min-width:130px;' }, 'Theme Switcher: ')]);
        if (this.installedThemes.length === 0) themeBar.appendChild(E('span', { 'style': 'color:#777;font-style:italic;' }, 'No themes detected'));
        else this.installedThemes.forEach(function(t) {
            themeBar.appendChild(E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'style': 'padding:4px 12px;text-transform:capitalize;font-weight:bold;', 'click': function() { self.handleThemeSwitch(t); } }, t));
        });
        var langBar = E('div', { 'style': 'background:rgba(0,0,0,0.04);padding:12px 14px;border-radius:8px;margin-bottom:20px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;' }, [E('strong', { 'style': 'min-width:130px;' }, 'Language Switcher: ')]);
        [ { code: 'en', label: 'English' }, { code: 'bn_BD', label: 'বাংলা' } ].forEach(function(l) {
            var active = (currentLang === l.code);
            var btn = E('button', { 'class': 'btn cbi-button ' + (active ? 'cbi-button-action important' : 'cbi-button-neutral'), 'style': 'padding:4px 14px;font-weight:bold;', 'click': function() { self.handleLanguageSwitch(l.code); } }, l.label);
            langBar.appendChild(btn);
        });
        var grid = E('div', { 'id': 'quickactions-grid-container', 'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;' });
        if (cmds.length === 0) grid.appendChild(E('p', { 'style': 'grid-column:1/-1;color:#888;' }, 'No custom commands. Add them in System > Custom Commands first.'));
        else {
            var is3d = this.designStyle === '3d';
            cmds.forEach(function(c) {
                var name = c.name || c.command;
                var style = 'padding:14px 12px;font-size:0.9em;font-weight:bold;cursor:pointer;text-align:center;color:#fff;box-shadow:0 4px 6px rgba(0,0,0,0.1);word-wrap:break-word;white-space:normal;line-height:1.3;';
                style += is3d ? 'border-radius:8px;border:none;' : 'border-radius:4px;border:1px solid rgba(0,0,0,0.1);';
                var info = self.getServiceInfo(name);
                var label = (info && info.icon) ? info.icon + ' ' + name : name;
                var btn = E('button', { 'class': 'btn cbi-button custom-action-btn', 'style': style + 'background-color:#747d8c;' + (is3d ? 'border-bottom:5px solid #57606f;' : ''), 'data-name': name, 'data-executing': 'false' }, label);
                var r = self.getServiceStatus(name, initList);
                if (r !== null) self.applyLiveColor(btn, r);
                btn.addEventListener('click', function() { self.handleButtonClick(c.command, name, btn); });
                grid.appendChild(btn);
            });
        }
        return E('div', {}, [themeBar, langBar, grid]);
    },

    renderEssential: function() {
        var self = this;
        var secs = (uci.sections('quickactions', 'essential') || []).slice();
        secs.sort(function(a, b) { return (parseInt(a.order, 10) || 999) - (parseInt(b.order, 10) || 999); });
        var is3d = this.designStyle === '3d';
        var grid = E('div', { 'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;' });
        if (secs.length === 0) grid.appendChild(E('p', { 'style': 'grid-column:1/-1;color:#888;' }, 'No essential buttons. Add them in the Configuration tab.'));
        else secs.forEach(function(s, idx) {
            var cmd = s.command || '';
            var label = s.label || s['.name'];
            var icon = s.icon || '';
            var needsConfirm = s.confirm === '1';
            var isFirst = idx === 0;
            var isLast = idx === secs.length - 1;
            var style = 'padding:14px 12px;font-size:0.92em;font-weight:bold;cursor:pointer;text-align:center;color:#fff;background-color:#1e90ff;box-shadow:0 4px 6px rgba(0,0,0,0.1);word-wrap:break-word;white-space:normal;line-height:1.35;flex:1;';
            style += is3d ? 'border-radius:8px;border:none;border-bottom:5px solid #197ad9;' : 'border-radius:4px;border:1px solid rgba(0,0,0,0.1);';
            var btn = E('button', { 'class': 'btn cbi-button', 'style': style, 'data-executing': 'false' }, (icon ? icon + '  ' : '') + label);
            btn.addEventListener('click', function() {
                if (btn.getAttribute('data-executing') === 'true') return;
                if (!cmd) { ui.addNotification('Error', 'No command', 'danger'); return; }
                if (needsConfirm && !confirm('Confirm: ' + label + '\n\nCommand:\n' + cmd + '\n\nProceed?')) return;
                btn.setAttribute('data-executing', 'true'); btn.style.opacity = '0.5';
                ui.addNotification('Running', label + '...', 'info');
                self.runCommand(cmd, label).then(function() { btn.setAttribute('data-executing', 'false'); btn.style.opacity = '1'; })
                    .catch(function(err) { btn.setAttribute('data-executing', 'false'); btn.style.opacity = '1'; ui.addNotification('Failed', (err && err.message) ? err.message : String(err), 'danger'); });
            });
            var upBtn = E('button', { 'class': 'btn cbi-button', 'style': 'padding:2px 6px;font-size:0.7em;line-height:1;', 'title': 'Move up', 'click': function() { if (isFirst) return; self.moveItem('essential', s['.name'], 'up').then(function() { self.switchTab('essential'); }); } }, '▲');
            var downBtn = E('button', { 'class': 'btn cbi-button', 'style': 'padding:2px 6px;font-size:0.7em;line-height:1;', 'title': 'Move down', 'click': function() { if (isLast) return; self.moveItem('essential', s['.name'], 'down').then(function() { self.switchTab('essential'); }); } }, '▼');
            var arrows = E('div', { 'style': 'display:flex;flex-direction:column;gap:2px;' }, [upBtn, downBtn]);
            var row = E('div', { 'style': 'display:flex;gap:6px;align-items:stretch;' }, [btn, arrows]);
            grid.appendChild(row);
        });
        return E('div', {}, [
            E('p', { 'style': 'color:#777;font-size:0.9em;margin-bottom:14px;' }, 'Essential operations. Use ▲▼ arrows to reorder. Edit in Configuration tab.'),
            grid
        ]);
    },

    renderTools: function() {
        var self = this;
        function section(title, body) {
            return E('div', { 'style': 'background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.06);border-radius:8px;padding:16px;margin-bottom:18px;' }, [E('h3', { 'style': 'margin:0 0 12px 0;font-size:1.05em;' }, title), body]);
        }
        function inputRow(label, id, type) {
            return E('div', { 'style': 'margin-bottom:10px;' }, [
                E('label', { 'style': 'display:block;font-size:0.9em;color:#666;margin-bottom:4px;' }, label),
                E('input', { 'id': id, 'type': type || 'text', 'style': 'width:100%;max-width:400px;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:0.95em;box-sizing:border-box;' })
            ]);
        }
        var pppoeSection = section('PPPoE Internet Setup', E('div', {}, [
            E('p', { 'style': 'color:#666;font-size:0.9em;margin:0 0 12px 0;' }, 'Configure WAN as PPPoE. Backs up /etc/config/network first.'),
            inputRow('PPPoE Username', 'qa-pppoe-user'),
            inputRow('PPPoE Password', 'qa-pppoe-pass', 'password'),
            E('button', { 'class': 'btn cbi-button cbi-button-action important', 'style': 'margin-top:8px;', 'click': function() {
                var u = document.getElementById('qa-pppoe-user').value;
                var p = document.getElementById('qa-pppoe-pass').value;
                if (!u || !p) { ui.addNotification('Error', 'Username and password required.', 'danger'); return; }
                if (!confirm('Reconfigure WAN as PPPoE with user "' + u + '"? Internet may drop briefly.')) return;
                var cmd = 'cp /etc/config/network /etc/config/network.bak.$(date +%s) 2>/dev/null; uci -q delete network.wan 2>/dev/null; uci set network.wan=interface; uci set network.wan.proto=pppoe; uci set network.wan.username="' + u + '"; uci set network.wan.password="' + p + '"; uci commit network; /etc/init.d/network restart';
                ui.addNotification('Running', 'Configuring PPPoE...', 'info');
                self.runCommand(cmd, 'PPPoE Setup');
            } }, 'Apply PPPoE')
        ]));
        var pwSection = section('Change Root Password', E('div', {}, [
            inputRow('New Password', 'qa-pw', 'password'),
            inputRow('Confirm Password', 'qa-pw2', 'password'),
            E('button', { 'class': 'btn cbi-button cbi-button-action important', 'style': 'margin-top:8px;', 'click': function() {
                var p1 = document.getElementById('qa-pw').value;
                var p2 = document.getElementById('qa-pw2').value;
                if (!p1 || p1.length < 4) { ui.addNotification('Error', 'Password too short.', 'danger'); return; }
                if (p1 !== p2) { ui.addNotification('Error', 'Passwords do not match.', 'danger'); return; }
                if (!confirm('Change root password? You will be logged out.')) return;
                var rpcSetPw = rpc.declare({ object: 'luci', method: 'setPassword', params: [ 'username', 'password' ], expect: { '': {} } });
                rpcSetPw('root', p1).then(function() { ui.addNotification('Success', 'Password changed. Log in again.', 'info'); document.getElementById('qa-pw').value = ''; document.getElementById('qa-pw2').value = ''; })
                    .catch(function(err) { ui.addNotification('Failed', (err && err.message) ? err.message : String(err), 'danger'); });
            } }, 'Change Password')
        ]));
        var shortcutSecs = (uci.sections('quickactions', 'shortcut') || []).slice();
        shortcutSecs.sort(function(a, b) { return (parseInt(a.order, 10) || 999) - (parseInt(b.order, 10) || 999); });
        var shortcutBody;
        if (shortcutSecs.length === 0) shortcutBody = E('p', { 'style': 'color:#888;' }, 'No shortcuts.');
        else {
            shortcutBody = E('div', { 'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;' });
            shortcutSecs.forEach(function(s, idx) {
                var path = s.path || '', label = s.label || s['.name'], icon = s.icon || '';
                var isFirst = idx === 0, isLast = idx === shortcutSecs.length - 1;
                var navBtn = E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'style': 'padding:12px 10px;font-weight:bold;flex:1;', 'click': function() { if (path) window.location.href = '/cgi-bin/luci/' + path; } }, (icon ? icon + '  ' : '') + label);
                var upBtn = E('button', { 'class': 'btn cbi-button', 'style': 'padding:2px 6px;font-size:0.7em;line-height:1;', 'click': function() { if (isFirst) return; self.moveItem('shortcut', s['.name'], 'up').then(function() { self.switchTab('tools'); }); } }, '▲');
                var downBtn = E('button', { 'class': 'btn cbi-button', 'style': 'padding:2px 6px;font-size:0.7em;line-height:1;', 'click': function() { if (isLast) return; self.moveItem('shortcut', s['.name'], 'down').then(function() { self.switchTab('tools'); }); } }, '▼');
                var arrows = E('div', { 'style': 'display:flex;flex-direction:column;gap:2px;' }, [upBtn, downBtn]);
                shortcutBody.appendChild(E('div', { 'style': 'display:flex;gap:6px;align-items:stretch;' }, [navBtn, arrows]));
            });
        }
        var shortcutSection = section('Quick Navigation Shortcuts', shortcutBody);
        return E('div', {}, [pppoeSection, pwSection, shortcutSection]);
    },

    renderLogs: function() {
        var self = this;
        var levels = [
            { v: 8, label: 'Debug (8)' }, { v: 7, label: 'Info (7)' }, { v: 6, label: 'Notice (6)' },
            { v: 5, label: 'Warning (5)' }, { v: 4, label: 'Error (4)' }, { v: 3, label: 'Critical (3)' },
            { v: 2, label: 'Alert (2)' }, { v: 1, label: 'Emergency (1)' }, { v: 0, label: 'Silent (0)' }
        ];
        var current = uci.get('system', '@system[0]', 'log_level') || '5';
        var select = E('select', { 'id': 'qa-log-level', 'style': 'padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:0.95em;min-width:220px;' });
        levels.forEach(function(l) {
            var opt = E('option', { 'value': String(l.v) }, l.label);
            if (String(l.v) === String(current)) opt.selected = true;
            select.appendChild(opt);
        });
        return E('div', {}, [
            E('div', { 'style': 'background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.06);border-radius:8px;padding:16px;margin-bottom:18px;' }, [
                E('h3', { 'style': 'margin:0 0 12px 0;font-size:1.05em;' }, 'System Log Level'),
                E('p', { 'style': 'color:#777;font-size:0.9em;margin:0 0 12px 0;' }, 'Current: ' + current + '. Lower = fewer logs.'),
                select,
                E('button', { 'class': 'btn cbi-button cbi-button-action important', 'style': 'margin-top:12px;margin-left:8px;', 'click': function() {
                    var v = document.getElementById('qa-log-level').value;
                    if (!confirm('Change log level to ' + v + '?')) return;
                    var cmd = 'uci set system.@system[0].log_level=' + v + '; uci commit system; /etc/init.d/log restart';
                    self.runCommand(cmd, 'Set log level').then(function() { ui.addNotification('Done', 'Log level set to ' + v, 'info'); });
                } }, 'Apply')
            ]),
            E('div', { 'style': 'background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.06);border-radius:8px;padding:16px;margin-bottom:18px;' }, [
                E('h3', { 'style': 'margin:0 0 12px 0;font-size:1.05em;' }, 'Cron Log Level'),
                E('p', { 'style': 'color:#777;font-size:0.9em;margin:0 0 12px 0;' }, 'OpenWrt cron is BusyBox crond — logs go to syslog at current system level.'),
                E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'click': function() {
                    self.runCommand('/etc/init.d/cron restart && logger -t cron "cron restarted"', 'Restart cron');
                } }, 'Restart Cron'),
                E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'style': 'margin-left:8px;', 'click': function() {
                    self.runCommand('logread | grep -i cron | tail -30', 'Recent cron log');
                } }, 'Show Recent Cron Log')
            ]),
            E('div', { 'style': 'background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.06);border-radius:8px;padding:16px;' }, [
                E('h3', { 'style': 'margin:0 0 12px 0;font-size:1.05em;' }, 'Log Viewer'),
                E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'click': function() { self.runCommand('logread | tail -50', 'Last 50 log lines'); } }, 'Last 50 lines'),
                E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'style': 'margin-left:8px;', 'click': function() { self.runCommand('logread | grep -i error | tail -30', 'Errors'); } }, 'Errors only'),
                E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'style': 'margin-left:8px;', 'click': function() { self.runCommand('dmesg | tail -30', 'Kernel messages'); } }, 'Kernel (dmesg)')
            ])
        ]);
    },

    renderServices: function() {
        var self = this;
        function inputRow(label, id, placeholder) {
            return E('div', { 'style': 'margin-bottom:10px;' }, [
                E('label', { 'style': 'display:block;font-size:0.9em;color:#666;margin-bottom:4px;' }, label),
                E('input', { 'id': id, 'placeholder': placeholder || '', 'style': 'width:100%;max-width:400px;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:0.95em;box-sizing:border-box;' })
            ]);
        }
        var actionSelect = E('select', { 'id': 'qa-svc-action', 'style': 'padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:0.95em;min-width:220px;' }, [
            E('option', { 'value': 'enable_start' }, 'Enable + Start'),
            E('option', { 'value': 'disable_stop' }, 'Disable + Stop'),
            E('option', { 'value': 'restart' }, 'Restart'),
            E('option', { 'value': 'status' }, 'Show Status')
        ]);
        var row2 = E('div', { 'style': 'margin-bottom:10px;' }, [
            E('label', { 'style': 'display:block;font-size:0.9em;color:#666;margin-bottom:4px;' }, 'Action'),
            actionSelect
        ]);

        var applierSection = E('div', { 'style': 'background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.06);border-radius:8px;padding:16px;margin-bottom:18px;' }, [
            E('h3', { 'style': 'margin:0 0 12px 0;font-size:1.05em;' }, 'Service Mode Applier'),
            E('p', { 'style': 'color:#777;font-size:0.9em;margin:0 0 12px 0;' }, 'Enable, disable, restart, or check any service on the router.'),
            inputRow('Service Name', 'qa-svc-name', 'e.g. dnsmasq, firewall, uhttpd'),
            row2,
            E('button', { 'class': 'btn cbi-button cbi-button-action important', 'style': 'margin-top:8px;', 'click': function() {
                var name = document.getElementById('qa-svc-name').value.trim();
                var action = document.getElementById('qa-svc-action').value;
                if (!name) { ui.addNotification('Error', 'Enter service name', 'danger'); return; }
                if (!/^[a-zA-Z0-9_\-]+$/.test(name)) { ui.addNotification('Error', 'Invalid service name', 'danger'); return; }
                var cmd;
                if (action === 'enable_start') cmd = '/etc/init.d/' + name + ' enable && /etc/init.d/' + name + ' start';
                else if (action === 'disable_stop') cmd = '/etc/init.d/' + name + ' stop; /etc/init.d/' + name + ' disable';
                else if (action === 'restart') cmd = '/etc/init.d/' + name + ' restart';
                else cmd = '/etc/init.d/' + name + ' enabled; /etc/init.d/' + name + ' running 2>/dev/null; ubus call service list "{\\"name\\":\\"' + name + '\\"}" 2>/dev/null';
                if (!confirm('Apply "' + action + '" to service "' + name + '"?\n\nCommand:\n' + cmd)) return;
                ui.addNotification('Running', name + ' ' + action, 'info');
                self.runCommand(cmd, name + ': ' + action);
            } }, 'Apply')
        ]);

        var listSection = E('div', { 'style': 'background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.06);border-radius:8px;padding:16px;' }, [
            E('h3', { 'style': 'margin:0 0 12px 0;font-size:1.05em;' }, 'Service Lists'),
            E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'click': function() { self.runCommand('/etc/init.d/* enabled 2>/dev/null; echo "---"; ls /etc/init.d/', 'Enabled services'); } }, 'Enabled Services'),
            E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'style': 'margin-left:8px;', 'click': function() { self.runCommand('for s in /etc/init.d/*; do n=$(basename $s); /etc/init.d/$n enabled 2>/dev/null || echo "DISABLED: $n"; done', 'Disabled services'); } }, 'Disabled Services'),
            E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'style': 'margin-left:8px;', 'click': function() { self.runCommand('ubus list | sort', 'All ubus services'); } }, 'Active ubus Services')
        ]);
        return E('div', {}, [applierSection, listSection]);
    },

    renderDependencies: function() {
        var self = this;
        var inputRow = E('div', { 'style': 'margin-bottom:10px;' }, [
            E('label', { 'style': 'display:block;font-size:0.9em;color:#666;margin-bottom:4px;' }, 'Package name (leave blank to list all)'),
            E('input', { 'id': 'qa-dep-pkg', 'placeholder': 'e.g. luci-app-firewall', 'style': 'width:100%;max-width:400px;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:0.95em;box-sizing:border-box;' })
        ]);

        var detectCmd = 'command -v apk >/dev/null 2>&1 && echo "apk" || echo "opkg"';

        function runSingle() {
            var pkg = document.getElementById('qa-dep-pkg').value.trim();
            if (!pkg) { ui.addNotification('Error', 'Enter a package name', 'danger'); return; }
            if (!/^[a-zA-Z0-9_\-\+\.]+$/.test(pkg)) { ui.addNotification('Error', 'Invalid package name', 'danger'); return; }
            var cmd = 'if command -v apk >/dev/null 2>&1; then echo "=== apk info --depends ' + pkg + ' ==="; apk info --depends ' + pkg + ' 2>&1 || apk info -R ' + pkg + ' 2>&1; else echo "=== opkg info ' + pkg + ' ==="; opkg info ' + pkg + ' 2>&1 | grep -A50 "^Package:"; fi';
            ui.addNotification('Running', 'Fetching ' + pkg + ' dependencies...', 'info');
            self.runCommand(cmd, 'Dependencies: ' + pkg);
        }

        var singleBox = E('div', { 'style': 'background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.06);border-radius:8px;padding:16px;margin-bottom:18px;' }, [
            E('h3', { 'style': 'margin:0 0 12px 0;font-size:1.05em;' }, 'Package Dependency Inspector'),
            E('p', { 'style': 'color:#777;font-size:0.9em;margin:0 0 12px 0;' }, 'Auto-detects apk (OpenWrt 25.12+) vs opkg (older). Enter a package name to view its dependencies.'),
            inputRow,
            E('button', { 'class': 'btn cbi-button cbi-button-action important', 'click': runSingle }, 'Show Dependencies')
        ]);

        var allBox = E('div', { 'style': 'background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.06);border-radius:8px;padding:16px;' }, [
            E('h3', { 'style': 'margin:0 0 12px 0;font-size:1.05em;' }, 'All Installed Packages with Dependencies'),
            E('p', { 'style': 'color:#777;font-size:0.9em;margin:0 0 12px 0;' }, 'Lists every installed package and its full dependency tree. Output may be large.'),
            E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'click': function() {
                var cmd = 'if command -v apk >/dev/null 2>&1; then apk list --installed -I 2>/dev/null | head -200; echo ""; echo "=== Total installed ==="; apk list -I 2>/dev/null | wc -l; else opkg list-installed; fi';
                ui.addNotification('Running', 'Listing all packages...', 'info');
                self.runCommand(cmd, 'All packages');
            } }, 'List All Packages'),
            E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'style': 'margin-left:8px;', 'click': function() {
                var cmd = 'if command -v apk >/dev/null 2>&1; then apk list -I --depends 2>/dev/null | head -300; else awk \'/^Package:/{p=$2} /^Depends:/{print p " -> " $0}\' /usr/lib/opkg/status; fi';
                ui.addNotification('Running', 'Listing dependencies...', 'info');
                self.runCommand(cmd, 'Package dependencies');
            } }, 'List All Dependencies'),
            E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'style': 'margin-left:8px;', 'click': function() {
                var cmd = 'if command -v apk >/dev/null 2>&1; then apk info --depends 2>/dev/null | head -200; else opkg status | grep -E "^(Package|Depends):"; fi';
                ui.addNotification('Running', 'Fetching dependency pairs...', 'info');
                self.runCommand(cmd, 'Dependency pairs');
            } }, 'Compact View')
        ]);

        var totalsBox = E('div', { 'style': 'background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.06);border-radius:8px;padding:16px;margin-top:18px;' }, [
            E('h3', { 'style': 'margin:0 0 12px 0;font-size:1.05em;' }, 'System Package Summary'),
            E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'click': function() {
                var cmd = 'echo "Package manager:"; command -v apk >/dev/null 2>&1 && echo "apk (OpenWrt 25.12+)" || echo "opkg (OpenWrt <=24.10)"; echo ""; echo "Total installed packages:"; if command -v apk >/dev/null 2>&1; then apk list -I 2>/dev/null | wc -l; else opkg list-installed | wc -l; fi; echo ""; echo "Recent installs:"; if command -v apk >/dev/null 2>&1; then apk list -I 2>/dev/null | tail -20; else opkg list-installed | tail -20; fi';
                self.runCommand(cmd, 'Package summary');
            } }, 'System Package Summary')
        ]);

        return E('div', {}, [singleBox, allBox, totalsBox]);
    },

    renderCommand: function() {
        var self = this;
        function docBox(title, content) {
            var details = E('details', { 'style': 'margin-bottom:12px;background:rgba(0,0,0,0.02);border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:12px 16px;' });
            details.appendChild(E('summary', { 'style': 'cursor:pointer;font-weight:bold;color:#1e90ff;font-size:1em;' }, title));
            details.appendChild(E('div', { 'style': 'padding-top:10px;font-size:0.92em;line-height:1.5;' }, content));
            return details;
        }
        function codeBlock(text) {
            return E('pre', { 'style': 'background:#1e1e1e;color:#00ff00;padding:10px;border-radius:6px;font-family:monospace;font-size:0.85em;overflow-x:auto;margin:8px 0;white-space:pre-wrap;' }, text);
        }
        var runnerBox = E('div', { 'style': 'background:rgba(30,144,255,0.08);border:1px solid rgba(30,144,255,0.2);border-radius:8px;padding:16px;margin-bottom:20px;' }, [
            E('h3', { 'style': 'margin:0 0 10px 0;' }, 'Direct Command Execution'),
            E('p', { 'style': 'color:#666;font-size:0.9em;margin:0 0 12px 0;' }, 'Run shell commands as root. Output in notification.'),
            E('textarea', { 'id': 'qa-cmd-input', 'placeholder': 'e.g. df -h', 'style': 'width:100%;min-height:90px;padding:10px;border:1px solid #ccc;border-radius:4px;font-family:monospace;font-size:0.9em;box-sizing:border-box;' }),
            E('div', { 'style': 'margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;' }, [
                E('button', { 'class': 'btn cbi-button cbi-button-action important', 'click': function() {
                    var cmd = document.getElementById('qa-cmd-input').value.trim();
                    if (!cmd) return;
                    if (!confirm('Run this command?\n\n' + cmd)) return;
                    ui.addNotification('Running', 'Command executing...', 'info');
                    self.runCommand(cmd, 'Command');
                } }, 'Run Command'),
                E('button', { 'class': 'btn cbi-button', 'click': function() { document.getElementById('qa-cmd-input').value = ''; } }, 'Clear')
            ])
        ]);
        var docs = E('div', {}, [
            E('h3', { 'style': 'margin:0 0 12px 0;' }, 'OpenWrt Command Reference'),
            docBox('System Information', E('div', {}, [codeBlock('uname -a\ncat /etc/openwrt_release\ncat /proc/cpuinfo\nfree -h\ndf -h\nuptime')])),
            docBox('Network Diagnostics', E('div', {}, [codeBlock('ip addr show\nip route show\niwinfo\nping -c 4 8.8.8.8\nnslookup google.com\ntraceroute 8.8.8.8')])),
            docBox('WiFi Management', E('div', {}, [codeBlock('/sbin/wifi down\n/sbin/wifi up\nwifi status\niwinfo wlan0 scan')])),
            docBox('Firewall / Routing', E('div', {}, [codeBlock('nft list ruleset\nuci show firewall\nuci show network\nfw4 reload')])),
            docBox('Package Management', E('div', {}, [codeBlock('opkg update && opkg list-installed\napk update && apk list -I')])),
            docBox('Service Control', E('div', {}, [codeBlock('/etc/init.d/network restart\nservice <name> enable\nservice <name> disable')])),
            docBox('Logs and Debugging', E('div', {}, [codeBlock('logread\nlogread -f\ndmesg\nlogread | grep error')])),
            docBox('UCI Configuration', E('div', {}, [codeBlock('uci show\nuci get network.wan.proto\nuci set network.wan.proto=dhcp\nuci commit network')])),
            docBox('Process Management', E('div', {}, [codeBlock('ps w\ntop -n 1\nkill <pid>\nlsmod')])),
            docBox('GPIO / Hardware Buttons', E('div', {}, [codeBlock('ubus call system board\nls /sys/class/gpio/\n/etc/rc.button/reset')])),
            docBox('Backup and Restore', E('div', {}, [codeBlock('sysupgrade -b /tmp/backup.tar.gz\nsysupgrade -r /tmp/backup.tar.gz\nfirstboot -y')])),
            docBox('Useful One-Liners', E('div', {}, [
                E('p', {}, 'Clear cache:'), codeBlock('rm -rf /tmp/luci-* && /etc/init.d/rpcd restart && /etc/init.d/uhttpd restart'),
                E('p', {}, 'LEDs off:'), codeBlock('for f in /sys/class/leds/*/brightness; do echo 0 > $f; done'),
                E('p', {}, 'Reboot in 5 min:'), codeBlock('(sleep 300 && reboot) &')
            ]))
        ]);
        return E('div', {}, [runnerBox, docs]);
    },

    renderHotplug: function() {
        var self = this;

        var regenBar = E('div', { 'style': 'background:rgba(30,144,255,0.08);border:1px solid rgba(30,144,255,0.2);border-radius:8px;padding:12px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;' }, [
            E('div', { 'style': 'font-size:0.9em;' }, [
                E('strong', {}, 'Generator: '),
                E('span', {}, 'Rules are stored in UCI. After Save & Apply, click Regenerate to write the handler scripts into /etc/hotplug.d/iface/.')
            ]),
            E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': function() {
                if (!confirm('Regenerate hotplug handler scripts from /etc/config/hotplug?')) return;
                ui.addNotification('Running', 'Regenerating handlers...', 'info');
                self.callSystemCommand('/bin/sh', [ '-c', '/etc/init.d/quickactions-hotplug restart' ]).then(function(r) {
                    var out = r.stdout || '';
                    if (r.stderr) out += '\n' + r.stderr;
                    var uid = 'qa-hp-gen-' + Date.now();
                    var pre = document.createElement('pre');
                    pre.id = uid;
                    pre.style.cssText = 'text-align:left;white-space:pre-wrap;background:#1e1e1e;color:#00ff00;padding:12px;border-radius:6px;font-family:monospace;font-size:0.85em;width:100%;box-sizing:border-box;margin:0;';
                    pre.textContent = out || 'Handlers regenerated.';
                    ui.addNotification('Regenerated', pre, 'info');
                    var el = document.getElementById(uid);
                    if (el && el.closest) { var c = el.closest('.alert'); if (c) { c.style.maxWidth = '95%'; c.style.width = 'auto'; } }
                }).catch(function(err) {
                    ui.addNotification('Failed', (err && err.message) ? err.message : String(err), 'danger');
                });
            } }, 'Regenerate Handlers')
        ]);

        var m = new form.Map('hotplug', _('Hotplug Rules'),
            _('Run commands on network interface events or when connectivity monitors fail. Replaces luci-app-hotplug.'));

        var s = m.section(form.GridSection, 'iface', _('Interface Events'),
            _('Execute commands when a logical interface goes up, down, or changes state.'));
        s.addremove = true;
        s.nodescriptions = true;
        var o = s.option(form.TextValue, 'description', _('Description'));
        o.placeholder = _('e.g. Restart firewall on WAN up');
        o = s.option(form.Flag, 'enabled', _('Enabled'));
        o.default = '1';
        o.rmempty = false;
        o = s.option(form.ListValue, 'action', _('Trigger event'));
        o.default = 'ifup';
        o.value('ifup', _('Interface up'));
        o.value('ifdown', _('Interface down'));
        o.value('ifup-failed', _('Interface up failed'));
        o.value('ifupdate', _('Interface changed'));
        o.value('free', _('Interface removed'));
        o.value('reload', _('Interface reload'));
        o.value('iflink', _('Interface received link'));
        o.value('create', _('Interface created'));
        o = s.option(form.Value, 'interface', _('Interface'),
            _('The logical interface to watch (e.g. wan, lan)'));
        o.rmempty = false;
        o = s.option(form.DynamicList, 'command', _('Commands to run'));
        o.datatype = 'string';
        o.placeholder = _('/etc/init.d/firewall restart');

        var s2 = m.section(form.GridSection, 'hotplug', _('Connectivity Monitors'),
            _('Ping test hosts through an interface. After consecutive failures, reset the interface or reboot.'));
        s2.addremove = true;
        s2.nodescriptions = true;
        o = s2.option(form.Flag, 'enabled', _('Enabled'));
        o.default = '1';
        o.rmempty = false;
        o = s2.option(form.Value, 'iface', _('Ping interface'));
        o.rmempty = false;
        o = s2.option(form.DynamicList, 'testip', _('Test hosts'));
        o.datatype = 'or(hostname,ipaddr("nomask"))';
        o.placeholder = '1.1.1.1';
        o = s2.option(form.Value, 'check_period', _('Check period (seconds)'));
        o.default = '60';
        o.datatype = 'and(uinteger,min(20))';
        o.rmempty = false;
        o = s2.option(form.Value, 'sw_before_modres', _('Failures before interface reset'));
        o.default = '3';
        o.datatype = 'and(uinteger,min(0),max(100))';
        o.rmempty = false;
        o = s2.option(form.Value, 'sw_before_sysres', _('Failures before reboot'));
        o.default = '0';
        o.datatype = 'and(uinteger,min(0),max(100))';
        o.rmempty = false;

        return m.render().then(function(formNode) {
            return E('div', {}, [regenBar, formNode]);
        });
    },

    cwAddStyles: function() {
        if (document.getElementById('cw-styles')) return;
        var style = document.createElement('style');
        style.id = 'cw-styles';
        style.type = 'text/css';
        style.textContent = `
        .cw-root .cron-multiselect {
          width: 100%; min-height: 140px;
          background: rgba(0,0,0,0.03);
          color: inherit; border: 1px solid rgba(0,0,0,0.15);
          border-radius: 4px; padding: 4px; font-family: inherit;
          font-size: 13px; line-height: 1.4; outline: none;
        }
        :root[data-darkmode="true"] .cw-root .cron-multiselect {
          background: #2a2f34; color: #e5e7eb; border-color: #3a4146;
        }
        .cw-root .cron-minute-head  { background: #fdd2d6; color: #263238; font-weight: bold; padding: 8px; }
        .cw-root .cron-hour-head    { background: #cfead1; color: #263238; font-weight: bold; padding: 8px; }
        .cw-root .cron-day-head     { background: #ffd8ad; color: #263238; font-weight: bold; padding: 8px; }
        .cw-root .cron-month-head   { background: #bbdefb; color: #263238; font-weight: bold; padding: 8px; }
        .cw-root .cron-weekday-head { background: #e1bee7; color: #263238; font-weight: bold; padding: 8px; }
        :root[data-darkmode="true"] .cw-root .cron-minute-head  { background: #8b4f5a; color: #ffcdd2; }
        :root[data-darkmode="true"] .cw-root .cron-hour-head    { background: #4f6b52; color: #c8e6c9; }
        :root[data-darkmode="true"] .cw-root .cron-day-head     { background: #7a5838; color: #ffe0b2; }
        :root[data-darkmode="true"] .cw-root .cron-month-head   { background: #4a6b8e; color: #bbdefb; }
        :root[data-darkmode="true"] .cw-root .cron-weekday-head { background: #5a4f71; color: #e1bee7; }
        .cw-root .cron-badge {
          display: inline-block; padding: 3px 6px; border-radius: 6px;
          border: 1px solid rgba(0,0,0,0.15); font-weight: 600;
        }
        :root[data-darkmode="true"] .cw-root .cron-badge { border-color: rgba(255,255,255,0.2); }
        .cw-root #cw_preview {
          min-height: 40px; padding: 8px; border-radius: 6px;
          border: 1px solid rgba(0,0,0,0.15); font-family: monospace;
          background: rgba(0,0,0,0.03);
        }
        :root[data-darkmode="true"] .cw-root #cw_preview { background: #2a2f34; border-color: #3a4146; }
        .cw-root .cw-section { background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.06); border-radius: 8px; padding: 16px; margin-bottom: 18px; }
        :root[data-darkmode="true"] .cw-root .cw-section { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.08); }
        `;
        document.head.appendChild(style);
    },

    cwColors: {
        light: { minute:'#fdd2d6', hour:'#cfead1', day:'#ffd8ad', month:'#bbdefb', weekday:'#e1bee7' },
        dark:  { minute:'#5b2f35', hour:'#2f4732', day:'#4a3828', month:'#30475e', weekday:'#3a2f41' }
    },
    cwGetCurrentColors: function() {
        return document.documentElement.getAttribute('data-darkmode') === 'true' ? this.cwColors.dark : this.cwColors.light;
    },
    cwGetBadgeTextColor: function() {
        return document.documentElement.getAttribute('data-darkmode') === 'true' ? '#ffffff' : '#111111';
    },
    cwWeekdayNames: function() {
        return [ _('Sunday'), _('Monday'), _('Tuesday'), _('Wednesday'), _('Thursday'), _('Friday'), _('Saturday') ];
    },
    cwMonthNames: function() {
        return [ '', _('January'), _('February'), _('March'), _('April'), _('May'), _('June'),
                 _('July'), _('August'), _('September'), _('October'), _('November'), _('December') ];
    },
    cwFormatRange: function(a, b) { return a + '-' + b; },

    cwParseSegments: function(expr) {
        if (!expr || expr === '*') return { type: 'any' };
        if (/^\*\/\d+$/.test(expr)) return { type: 'step', step: parseInt(expr.slice(2), 10) };
        var segs = [];
        expr.split(',').forEach(function(part) {
            var m = part.match(/^(\d+)-(\d+)$/);
            if (m) { segs.push({ kind:'range', a:parseInt(m[1],10), b:parseInt(m[2],10) }); }
            else { var v = parseInt(part, 10); if (!isNaN(v)) segs.push({ kind:'single', v:v }); }
        });
        return { type:'list', segs:segs };
    },
    cwExpand: function(parsed, minVal, maxVal) {
        if (parsed.type === 'any') return null;
        var vals = {};
        if (parsed.type === 'step') {
            for (var i = minVal; i <= maxVal; i += parsed.step) vals[i] = 1;
        } else {
            parsed.segs.forEach(function(s) {
                if (s.kind === 'single') { if (s.v >= minVal && s.v <= maxVal) vals[s.v] = 1; }
                else { for (var i = s.a; i <= s.b; i++) if (i >= minVal && i <= maxVal) vals[i] = 1; }
            });
        }
        return Object.keys(vals).map(Number).sort(function(a,b){ return a-b; });
    },
    cwHumanList: function(parsed, labeller) {
        if (parsed.type === 'any' || parsed.type === 'step') return null;
        var self = this;
        return parsed.segs.map(function(s) {
            if (s.kind === 'single') return labeller(s.v);
            return self.cwFormatRange(labeller(s.a), labeller(s.b));
        }).join(', ');
    },
    cwPad2: function(n) { return n < 10 ? '0' + n : '' + n; },

    cwDescribeCron: function(minute, hour, day, month, weekday, command) {
        var parts = [];
        if (minute !== '*') parts.push(_('minute: %s').format(minute));
        if (hour !== '*') parts.push(_('hour: %s').format(hour));
        if (day !== '*') parts.push(_('day: %s').format(day));
        if (month !== '*') parts.push(_('month: %s').format(month));
        if (weekday !== '*') parts.push(_('weekday: %s').format(weekday));
        if (parts.length === 0) return command ? _('Command "%s" will run every minute.').format(command) : '';
        return command ? _('Command "%s" will run at').format(command) + ': ' + parts.join('; ')
                       : _('Runs at') + ': ' + parts.join('; ');
    },

    cwBadge: function(bg, content) {
        var color = this.cwGetBadgeTextColor();
        return '<span class="cron-badge" style="background:' + bg + ';color:' + color + '">' + content + '</span>';
    },
    cwGetSelectedValues: function(selectId) {
        var sel = document.getElementById(selectId);
        if (!sel) return [];
        return Array.prototype.slice.call(sel.selectedOptions || []).map(function(o){ return o.value; });
    },
    cwNormalizeSelection: function(values) {
        if (!values || values.length === 0) return ['*'];
        if (values.indexOf('*') >= 0) return ['*'];
        var seen = {};
        values.forEach(function(v){ seen[parseInt(v,10)] = 1; });
        return Object.keys(seen).map(Number).sort(function(a,b){ return a-b; }).map(String);
    },
    cwCompressValues: function(values) {
        if (!values || values.length === 0) return '*';
        if (values.length === 1) return values[0];
        var nums = values.map(Number), parts = [], start = nums[0], prev = nums[0];
        for (var i = 1; i < nums.length; i++) {
            var cur = nums[i];
            if (cur === prev + 1) { prev = cur; continue; }
            parts.push(start === prev ? String(start) : (start + '-' + prev));
            start = prev = cur;
        }
        parts.push(start === prev ? String(start) : (start + '-' + prev));
        return parts.join(',');
    },
    cwBuildField: function(selectId, checkboxId) {
        var vals = this.cwNormalizeSelection(this.cwGetSelectedValues(selectId));
        if (checkboxId) {
            var cb = document.getElementById(checkboxId);
            if (cb && cb.checked) {
                var sel = vals[0];
                return (sel === '*' || sel === undefined) ? '*' : '*/' + sel;
            }
        }
        if (vals.length === 0 || vals[0] === '*') return '*';
        return this.cwCompressValues(vals);
    },

    cwUpdatePreview: function() {
        var minute  = this.cwBuildField('cw_minute',  'cw_minute_cb');
        var hour    = this.cwBuildField('cw_hour',    'cw_hour_cb');
        var day     = this.cwBuildField('cw_day',     'cw_day_cb');
        var month   = this.cwBuildField('cw_month');
        var weekday = this.cwBuildField('cw_weekday');
        var cmdEl   = document.getElementById('cw_command');
        var command = cmdEl ? cmdEl.value : '';

        var colors = this.cwGetCurrentColors();
        var html = '';
        html += (minute  !== '*') ? this.cwBadge(colors.minute,  minute)  : minute;  html += ' ';
        html += (hour    !== '*') ? this.cwBadge(colors.hour,    hour)    : hour;    html += ' ';
        html += (day     !== '*') ? this.cwBadge(colors.day,     day)     : day;     html += ' ';
        html += (month   !== '*') ? this.cwBadge(colors.month,   month)   : month;   html += ' ';
        html += (weekday !== '*') ? this.cwBadge(colors.weekday, weekday) : weekday; html += ' ';
        html += command ? '<span class="cron-badge" style="background:#90a4ae">' + command + '</span>' : '';

        var prev = document.getElementById('cw_preview');
        if (prev) prev.innerHTML = html;
        var txt = document.getElementById('cw_preview_text');
        if (txt) txt.value = minute + ' ' + hour + ' ' + day + ' ' + month + ' ' + weekday + ' ' + command;
        var hum = document.getElementById('cw_human');
        if (hum) hum.value = this.cwDescribeCron(minute, hour, day, month, weekday, command);
    },

    cwAppend: function() {
        var input = document.getElementById('cw_preview_text');
        if (!input) return;
        var line = (input.value || '').trim();
        if (!line || line === '* * * * *') { ui.addNotification('Error', _('Check the cron entry - it must contain time + command'), 'danger'); return; }
        if (line.split(/\s+/).length < 6) { ui.addNotification('Error', _('Please enter the command'), 'danger'); return; }
        if (!confirm('Add this cron entry?\n\n' + line)) return;

        fs.read('/etc/crontabs/root').catch(function(){ return ''; }).then(function(content) {
            var cur = (content || '').replace(/\r\n/g, '\n');
            var haystack = '\n' + cur + (cur.slice(-1) === '\n' ? '' : '\n');
            if (haystack.indexOf('\n' + line + '\n') >= 0) {
                ui.addNotification('Duplicate', _('This entry already exists'), 'info');
                return null;
            }
            if (cur && cur.slice(-1) !== '\n') cur += '\n';
            cur += line + '\n';
            return fs.write('/etc/crontabs/root', cur).then(function() {
                return fs.exec('/etc/init.d/cron', ['restart']);
            }).then(function() {
                ui.addNotification('Added', E('p', {}, line), 'info');
            });
        }).catch(function(e) {
            ui.addNotification('Error', (e && e.message) ? e.message : String(e), 'danger');
        });
    },

    cwGenerateOptions: function(start, end, labels) {
        var opts = [ E('option', { value: '*', selected: true }, '*') ];
        if (labels) {
            for (var i = 0; i < labels.length; i++) opts.push(E('option', { value: String(start + i) }, labels[i]));
        } else {
            for (var j = start; j <= end; j++) opts.push(E('option', { value: String(j) }, String(j)));
        }
        return opts;
    },
    cwResetMulti: function(id) {
        var sel = document.getElementById(id);
        if (!sel) return;
        Array.prototype.slice.call(sel.options).forEach(function(o){ o.selected = (o.value === '*'); });
    },

    renderCrontabWizard: function() {
        var self = this;
        this.cwAddStyles();

        var grid = E('div', { 'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1em;margin-bottom:1em;' });

        function cwSelect(id, opts, cbId, cbLabel) {
            var sel = E('select', { 'id': id, 'class': 'cron-multiselect', 'multiple': true, 'size': 8, 'change': function(){ self.cwUpdatePreview(); } }, opts);
            var kids = [ sel ];
            if (cbId) {
                kids.push(E('div', { 'style': 'display:flex;align-items:center;gap:5px;margin-top:6px;' }, [
                    E('input', { 'type': 'checkbox', 'id': cbId, 'change': function(){ self.cwUpdatePreview(); } }),
                    E('label', { 'for': cbId, 'style': 'font-size:12px;' }, cbLabel)
                ]));
            }
            return E('div', { 'class': 'cw-section', 'style': 'padding:0;' }, [
                E('div', { 'class': id.replace('cw_', 'cron-') + '-head' }, cbLabel || id),
                E('div', { 'style': 'padding:8px;' }, kids)
            ]);
        }

        grid.appendChild(cwSelect('cw_minute',  this.cwGenerateOptions(0, 59), 'cw_minute_cb', _('Minute')));
        grid.appendChild(cwSelect('cw_hour',    this.cwGenerateOptions(0, 23), 'cw_hour_cb',   _('Hour')));
        grid.appendChild(cwSelect('cw_day',     this.cwGenerateOptions(1, 31), 'cw_day_cb',    _('Day')));
        grid.appendChild(cwSelect('cw_month',   this.cwGenerateOptions(1, 12, this.cwMonthNames().slice(1)), null, _('Month')));
        grid.appendChild(cwSelect('cw_weekday', this.cwGenerateOptions(0, 6, this.cwWeekdayNames()), null, _('Weekday')));

        var root = E('div', { 'class': 'cw-root' }, [
            E('h3', { 'style': 'margin:0 0 4px 0;' }, _('Graphical Crontab Configurator')),
            E('p', { 'style': 'color:#888;font-size:0.9em;margin:0 0 16px 0;' }, _('Pick time units, type a command, preview the generated cron line, then add it.')),
            grid,
            E('div', { 'class': 'cw-section' }, [
                E('label', { 'style': 'font-weight:bold;display:block;margin-bottom:5px;' }, _('Command to execute:')),
                E('input', { 'id': 'cw_command', 'class': 'cbi-input-text', 'style': 'width:100%;margin-bottom:12px;', 'placeholder': 'echo hello', 'keyup': function(){ self.cwUpdatePreview(); }, 'change': function(){ self.cwUpdatePreview(); } }),
                E('label', { 'style': 'font-weight:bold;display:block;margin-bottom:5px;' }, _('Preview:')),
                E('div', { 'id': 'cw_preview' }),
                E('label', { 'style': 'font-weight:bold;display:block;margin:12px 0 5px 0;' }, _('Description:')),
                E('textarea', { 'id': 'cw_human', 'readonly': true, 'style': 'width:100%;min-height:50px;font-size:0.85em;resize:vertical;' }),
                E('label', { 'style': 'font-weight:bold;display:block;margin:12px 0 5px 0;' }, _('Generated cron entry:')),
                E('input', { 'id': 'cw_preview_text', 'readonly': true, 'style': 'width:100%;font-family:monospace;' }),
                E('div', { 'style': 'margin-top:12px;display:flex;gap:10px;justify-content:flex-end;' }, [
                    E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'click': function() {
                        self.cwResetMulti('cw_minute'); self.cwResetMulti('cw_hour'); self.cwResetMulti('cw_day');
                        self.cwResetMulti('cw_month'); self.cwResetMulti('cw_weekday');
                        document.getElementById('cw_command').value = '';
                        ['cw_minute_cb','cw_hour_cb','cw_day_cb'].forEach(function(id){ var e = document.getElementById(id); if (e) e.checked = false; });
                        self.cwUpdatePreview();
                    } }, _('Reset')),
                    E('button', { 'class': 'btn cbi-button cbi-button-action important', 'click': function(){ self.cwAppend(); } }, _('Add to Cron'))
                ])
            ])
        ]);

        setTimeout(function(){ self.cwUpdatePreview(); }, 0);
        return root;
    },

    renderGuestWifi: function() {
        var self = this;
        var gw = new GuestWifiViewClass();
        return gw.load().then(function() {
            return gw.render();
        }).then(function(node) {
            var actions = node.querySelector('.cbi-page-actions');
            if (actions) actions.style.display = 'none';
            var saveBtn = E('button', {
                'class': 'btn cbi-button cbi-button-action important',
                'click': function() {
                    if (!confirm('Save and apply guest WiFi configuration?')) return;
                    ui.addNotification('Saving', 'Applying guest WiFi configuration...', 'info');
                    Promise.resolve(gw.handleSave()).then(function() {
                        ui.addNotification('Success', 'Guest WiFi configuration saved and applied.', 'info');
                    }).catch(function(err) {
                        ui.addNotification('Error', (err && err.message) ? err.message : String(err), 'danger');
                    });
                }
            }, 'Save Guest WiFi');
            return E('div', {}, [node, E('div', { 'style': 'margin-top:20px;text-align:right;' }, [saveBtn])]);
        });
    },

    renderConfigForm: function() {
        var m = new form.Map('quickactions', 'Quick Actions Configuration', 'Manage all sections. Use Order field to control sequence (lower = first).');
        var s = m.section(form.NamedSection, 'global', 'settings', 'Global Settings');
        s.anonymous = true;
        var o = s.option(form.Value, 'poll_interval', 'Polling Interval (seconds)');
        o.datatype = 'integer'; o.placeholder = '5';
        o = s.option(form.ListValue, 'design_style', 'Button Style');
        o.value('flat', 'Modern Flat'); o.value('3d', 'Tactile 3D'); o.default = '3d';

        var s2 = m.section(form.GridSection, 'essential', 'Essential Buttons', 'Reorder field controls display order.');
        s2.anonymous = true; s2.addremove = true;
        o = s2.option(form.Value, 'order', 'Order'); o.datatype = 'integer'; o.placeholder = '10';
        s2.option(form.Value, 'label', 'Label');
        o = s2.option(form.Value, 'icon', 'Icon / Emoji'); o.placeholder = '🔄';
        o = s2.option(form.Value, 'command', 'Shell Command'); o.placeholder = '/sbin/reboot';
        s2.option(form.Flag, 'confirm', 'Require Confirmation');

        var s3 = m.section(form.GridSection, 'mapping', 'Service Mappings', 'Map keywords to init services.');
        s3.anonymous = true; s3.addremove = true;
        o = s3.option(form.Value, 'order', 'Order'); o.datatype = 'integer';
        s3.option(form.Value, 'keyword', 'Label Keyword');
        s3.option(form.Value, 'service', 'Target Service');
        o = s3.option(form.Value, 'icon', 'Icon / Emoji'); o.placeholder = '⚙️';
        s3.option(form.Flag, 'dangerous', 'Require Confirmation');

        var s4 = m.section(form.GridSection, 'shortcut', 'Navigation Shortcuts', 'Buttons that jump to other LuCI pages.');
        s4.anonymous = true; s4.addremove = true;
        o = s4.option(form.Value, 'order', 'Order'); o.datatype = 'integer';
        s4.option(form.Value, 'label', 'Label');
        o = s4.option(form.Value, 'icon', 'Icon / Emoji'); o.placeholder = '🔗';
        o = s4.option(form.Value, 'path', 'LuCI Path'); o.placeholder = 'admin/network/firewall';

        return m.render();
    },

    render: function(data) {
        var self = this;
        var cmds = data[0] || [];
        var initList = data[1] || {};
        var tabBar = E('div', { 'style': 'display:flex;gap:2px;border-bottom:2px solid rgba(0,0,0,0.08);margin:0 0 20px 0;flex-wrap:wrap;' });
        var tabContent = E('div');
        var tabButtons = {};
        var tabs = [
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'essential', label: 'Essential' },
            { id: 'tools', label: 'Tools' },
            { id: 'logs', label: 'Logs' },
            { id: 'services', label: 'Services' },
            { id: 'hotplug', label: 'Hotplug' },
            { id: 'crontab', label: 'Crontab' },
            { id: 'guestwifi', label: 'Guest WiFi' },
            { id: 'command', label: 'Command' },
            { id: 'dependencies', label: 'Dependencies' },
            { id: 'config', label: 'Configuration' }
        ];
        function showTab(id) {
            self.activeTab = id;
            Object.keys(tabButtons).forEach(function(tid) {
                var b = tabButtons[tid];
                if (tid === id) { b.style.borderBottomColor = '#1e90ff'; b.style.color = '#1e90ff'; b.style.fontWeight = 'bold'; }
                else { b.style.borderBottomColor = 'transparent'; b.style.color = '#666'; b.style.fontWeight = '500'; }
            });
            tabContent.innerHTML = '';
            if (id === 'dashboard') tabContent.appendChild(self.renderDashboard(cmds, initList));
            else if (id === 'essential') tabContent.appendChild(self.renderEssential());
            else if (id === 'tools') tabContent.appendChild(self.renderTools());
            else if (id === 'logs') tabContent.appendChild(self.renderLogs());
            else if (id === 'services') tabContent.appendChild(self.renderServices());
            else if (id === 'hotplug') {
                tabContent.appendChild(E('p', { 'style': 'color:#888;padding:20px;' }, 'Loading hotplug form...'));
                Promise.resolve(self.renderHotplug()).then(function(node) { tabContent.innerHTML = ''; tabContent.appendChild(node); })
                    .catch(function(err) { tabContent.innerHTML = ''; tabContent.appendChild(E('div', { 'class': 'alert-message error' }, 'Hotplug error: ' + (err && err.message ? err.message : String(err)))); });
            }
            else if (id === 'crontab') tabContent.appendChild(self.renderCrontabWizard());
            else if (id === 'guestwifi') {
                tabContent.appendChild(E('p', { 'style': 'color:#888;padding:20px;' }, 'Loading guest WiFi form...'));
                self.renderGuestWifi().then(function(node) { tabContent.innerHTML = ''; tabContent.appendChild(node); })
                    .catch(function(err) { tabContent.innerHTML = ''; tabContent.appendChild(E('div', { 'class': 'alert-message error' }, 'Guest WiFi error: ' + (err && err.message ? err.message : String(err)))); });
            }
            else if (id === 'command') tabContent.appendChild(self.renderCommand());
            else if (id === 'dependencies') tabContent.appendChild(self.renderDependencies());
            else if (id === 'config') {
                tabContent.appendChild(E('p', { 'style': 'color:#888;padding:20px;' }, 'Loading configuration...'));
                self.renderConfigForm().then(function(node) { tabContent.innerHTML = ''; tabContent.appendChild(node); })
                    .catch(function(err) { tabContent.innerHTML = ''; tabContent.appendChild(E('div', { 'class': 'alert-message error' }, 'Form error: ' + (err && err.message ? err.message : String(err)))); });
            }
        }
        tabs.forEach(function(t) {
            var b = E('div', { 'style': 'padding:10px 16px;cursor:pointer;border-bottom:3px solid transparent;color:#666;font-weight:500;font-size:0.9em;user-select:none;', 'click': function() { showTab(t.id); } }, t.label);
            tabButtons[t.id] = b;
            tabBar.appendChild(b);
        });
        var container = E('div', { 'class': 'cbi-map' }, [
            E('h2', { 'style': 'margin-bottom:4px;' }, 'Quick Actions'),
            E('p', { 'style': 'margin-top:0;margin-bottom:20px;color:#888;font-style:italic;font-size:0.95em;' }, 'Live Status, Commands & Controls'),
            tabBar, tabContent
        ]);
        this.switchTab = showTab;
        if (this.timerId) clearInterval(this.timerId);
        this.timerId = setInterval(function() { self.updateAllButtonsRealtime(); }, this.pollInterval * 1000);
        showTab('dashboard');
        return container;
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
