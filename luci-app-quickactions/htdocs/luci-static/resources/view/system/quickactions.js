'use strict';
'require view';
'require ui';
'require uci';
'require rpc';
'require form';

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
