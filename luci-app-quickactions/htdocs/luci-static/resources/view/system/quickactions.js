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
    configRendered: false,

    load: function() {
        var self = this;
        this.callInitStatus = rpc.declare({
            object: 'luci',
            method: 'getInitList',
            expect: { '': {} }
        });
        this.callSystemCommand = rpc.declare({
            object: 'file',
            method: 'exec',
            params: [ 'command', 'params' ],
            expect: { '': {} }
        });

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
                    uci.load('luci').then(function() {
                        return uci.sections('luci', 'command');
                    }).catch(function(){ return []; }),
                    self.callInitStatus().catch(function(){ return {}; })
                ]);
            });
        });
    },

    fetchThemeList: function() {
        return this.callSystemCommand('/bin/sh', [
            '-c',
            'opkg list-installed | grep "^luci-theme-" | sed "s/ .*//"'
        ]).then(function(result) {
            var output = result.stdout || '';
            return output.split('\n')
                .map(function(line) { return line.trim(); })
                .filter(function(line) { return line.length > 0; })
                .map(function(pkg) { return pkg.replace(/^luci-theme-/, ''); });
        }).catch(function() { return []; });
    },

    handleThemeSwitch: function(themeKey) {
        var self = this;
        uci.load('luci').then(function() {
            var current = uci.get('luci', 'main', 'mediaurlbase');
            var newBase = '/luci-static/' + themeKey;
            if (current === newBase) {
                ui.addNotification('Theme', 'Already using "' + themeKey + '".', 'info');
                return;
            }
            ui.addNotification('Theme', 'Applying theme "' + themeKey + '"...', 'info');
            uci.set('luci', 'main', 'mediaurlbase', newBase);
            uci.save().then(function() {
                return uci.apply(10, true);
            }).then(function() {
                setTimeout(function() { window.location.reload(); }, 1500);
            }).catch(function(err) {
                var msg = (err && err.message) ? err.message : String(err);
                ui.addNotification('Theme Error', msg, 'danger');
            });
        }).catch(function(err) {
            var msg = (err && err.message) ? err.message : String(err);
            ui.addNotification('Theme Error', msg, 'danger');
        });
    },

    getServiceInfo: function(buttonName) {
        var name = buttonName.toLowerCase();
        for (var kw in this.customMappings) {
            if (name.includes(kw)) return this.customMappings[kw];
        }
        return null;
    },

    getServiceStatus: function(buttonName, initList) {
        if (!buttonName || !initList) return null;
        var name = buttonName.toLowerCase();
        var info = this.getServiceInfo(buttonName);
        if (info && info.service && initList[info.service]) {
            return initList[info.service].enabled && initList[info.service].running;
        }
        var fallbackMap = {
            'dns': 'dnsmasq', 'dhcp': 'dnsmasq', 'firewall': 'firewall',
            'vpn': 'openvpn', 'wireguard': 'network', 'adblock': 'adblock'
        };
        for (var key in fallbackMap) {
            if (name.includes(key)) {
                var sName = fallbackMap[key];
                if (initList[sName]) return initList[sName].enabled && initList[sName].running;
            }
        }
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
            if (result.stderr) output += '\n[System Alerts]:\n' + result.stderr;
            if (!output.trim()) output = 'Command ran successfully.';

            var uid = 'cmd-output-' + Date.now();
            var pre = document.createElement('pre');
            pre.id = uid;
            pre.style.cssText = 'text-align:left; white-space:pre-wrap; max-height:80vh; overflow-y:auto; background:#1e1e1e; color:#00ff00; padding:15px; border-radius:8px; font-family:monospace; font-size:0.95em; width:100%; box-sizing:border-box; margin:0;';
            pre.textContent = output;
            ui.addNotification(buttonName + ' Done', pre, 'info');
            var notif = document.getElementById(uid);
            if (notif) {
                var c = notif.closest ? notif.closest('.alert') : null;
                if (c) { c.style.maxWidth = '95%'; c.style.width = 'auto'; }
            }
            self.updateAllButtonsRealtime();
        }).catch(function(err) {
            btnElement.setAttribute('data-executing', 'false');
            btnElement.style.opacity = '1';
            var msg = (err && err.message) ? err.message : String(err);
            ui.addNotification('Failed', msg, 'danger');
        });
    },

    handleButtonClick: function(commandStr, buttonName, btnElement) {
        if (btnElement.getAttribute('data-executing') === 'true') return;
        var info = this.getServiceInfo(buttonName);
        if (info && info.dangerous) {
            var confirmed = confirm('Warning: Triggering high-risk operation (' + buttonName + ').\nAre you sure?');
            if (confirmed) this.executeValidatedCommand(commandStr, buttonName, btnElement);
        } else {
            this.executeValidatedCommand(commandStr, buttonName, btnElement);
        }
    },

    applyLiveColor: function(element, isRunning) {
        if (isRunning) {
            element.style.backgroundColor = '#2ed573';
            if (this.designStyle === '3d') element.style.borderBottom = '5px solid #26b360';
        } else {
            element.style.backgroundColor = '#ff4757';
            if (this.designStyle === '3d') element.style.borderBottom = '5px solid #d93d4b';
        }
    },

    updateAllButtonsRealtime: function() {
        var self = this;
        var gridNode = document.getElementById('quickactions-grid-container');
        if (!gridNode) {
            if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
            return;
        }
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

    renderConfig: function() {
        var m, s, o, s2;
        m = new form.Map('quickactions', _('Quick Actions Core Configuration'),
            _('Fine-tune your layout styling parameters, set active warning gates, and customize icon assignments.'));
        s = m.section(form.NamedSection, 'global', 'settings', _('Visual Theme Customizations'));
        s.anonymous = true;
        o = s.option(form.Value, 'poll_interval', _('Polling Interval (Seconds)'));
        o.datatype = 'integer';
        o.placeholder = '5';
        o = s.option(form.ListValue, 'design_style', _('Button Visual Presentation Style'),
            _('Switch between flat modern styling or classic tactile 3D borders.'));
        o.value('flat', _('Modern Flat Minimalist'));
        o.value('3d', _('Tactile 3D Depth Borders'));
        o.default = '3d';
        s2 = m.section(form.GridSection, 'mapping', _('Service Mapping & Protection Guards'));
        s2.anonymous = true;
        s2.addremove = true;
        s2.option(form.Value, 'keyword', _('Label Keyword'), _('Trigger text found in button name (case-insensitive).'));
        s2.option(form.Value, 'service', _('Target System Service'), _('The official background init script name.'));
        o = s2.option(form.Value, 'icon', _('Custom Icon / Emoji'), _('Paste a single emoji icon to prepend to matching buttons.'));
        o.placeholder = '⚙️';
        o = s2.option(form.Flag, 'dangerous', _('Require Confirmation'),
            _('If enabled, forcing a warning popup before running the script to prevent accidental downtime.'));
        o.rmempty = false;
        return m.render();
    },

    render: function(data) {
        var self = this;
        var commandsList = data[0] || [];
        var initList = data[1] || {};
        var themesMap = this.installedThemes || [];

        var themeBar = E('div', {
            'style': 'background: rgba(0,0,0,0.05); padding: 12px; border-radius: 8px; margin-bottom: 25px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;'
        }, [ E('strong', {}, '1-Click Theme Switcher: ') ]);

        if (themesMap.length === 0) {
            themeBar.appendChild(E('span', { 'style': 'color:#777; font-style:italic;' }, 'No alternative themes detected.'));
        } else {
            themesMap.forEach(function(themeKey) {
                themeBar.appendChild(E('button', {
                    'class': 'btn cbi-button cbi-button-neutral',
                    'style': 'padding: 4px 12px; text-transform: capitalize; font-weight: bold;',
                    'click': function() { self.handleThemeSwitch(themeKey); }
                }, themeKey));
            });
        }

        var grid = E('div', {
            'id': 'quickactions-grid-container',
            'style': 'display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-top: 15px;'
        });

        if (commandsList.length === 0) {
            grid.appendChild(E('p', { 'style': 'grid-column: 1/-1; color:#888;' }, 'No saved entries found. Configure entries via System > Custom Commands first.'));
        } else {
            commandsList.forEach(function(cmdSection) {
                var name = cmdSection.name || cmdSection.command;
                var fullCmd = cmdSection.command;
                var is3d = self.designStyle === '3d';
                var baseStyle = 'padding: 12px 10px; font-size: 0.85em; font-weight: bold; cursor: pointer; text-align: center; color: #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: background-color 0.2s, transform 0.1s;';
                baseStyle += is3d ? ' border-radius: 8px; border: none;' : ' border-radius: 4px; border: 1px solid rgba(0,0,0,0.1);';
                baseStyle += ' word-wrap: break-word; white-space: normal; line-height: 1.3;';
                var info = self.getServiceInfo(name);
                var resolvedDisplayName = (info && info.icon) ? info.icon + ' ' + name : '⚙️ ' + name;
                var btn = E('button', {
                    'class': 'btn cbi-button custom-action-btn',
                    'style': baseStyle + ' background-color: #747d8c;' + (is3d ? ' border-bottom: 5px solid #57606f;' : ''),
                    'data-name': name,
                    'data-executing': 'false'
                }, resolvedDisplayName);
                var isRunning = self.getServiceStatus(name, initList);
                if (isRunning !== null) {
                    self.applyLiveColor(btn, isRunning);
                } else {
                    var lname = name.toLowerCase();
                    if (lname.includes('clear') || lname.includes('reset')) {
                        btn.style.backgroundColor = '#ffa502'; if(is3d) btn.style.borderBottom = '5px solid #d98c02';
                    } else if (lname.includes('check') || lname.includes('test')) {
                        btn.style.backgroundColor = '#1e90ff'; if(is3d) btn.style.borderBottom = '5px solid #197ad9';
                    }
                }
                btn.addEventListener('click', function() { self.handleButtonClick(fullCmd, name, btn); });
                btn.addEventListener('mousedown', function() { if(this.getAttribute('data-executing')!=='true') this.style.transform = 'scale(0.96)'; });
                btn.addEventListener('mouseup', function() { this.style.transform = 'scale(1)'; });
                grid.appendChild(btn);
            });
        }

        var dashboardContent = E('div', { 'id': 'quickactions-dashboard-content' }, [ themeBar, grid ]);

        var configContent = E('div', { 'id': 'quickactions-config-content' });
        configContent.style.display = 'none';

        var dashTab = E('a', { 'href': '#', 'class': 'cbi-tab cbi-tab-active' }, _('Dashboard'));
        var cfgTab = E('a', { 'href': '#', 'class': 'cbi-tab' }, _('Configuration'));

        dashTab.addEventListener('click', function(ev) {
            ev.preventDefault();
            dashboardContent.style.display = '';
            configContent.style.display = 'none';
            dashTab.classList.add('cbi-tab-active');
            cfgTab.classList.remove('cbi-tab-active');
        });

        cfgTab.addEventListener('click', function(ev) {
            ev.preventDefault();
            dashboardContent.style.display = 'none';
            configContent.style.display = '';
            cfgTab.classList.add('cbi-tab-active');
            dashTab.classList.remove('cbi-tab-active');

            if (!self.configRendered) {
                self.configRendered = true;
                configContent.innerHTML = '';
                configContent.appendChild(E('p', {}, _('Loading configuration...')));
                self.renderConfig().then(function(formNode) {
                    configContent.innerHTML = '';
                    configContent.appendChild(formNode);
                }).catch(function(err) {
                    configContent.innerHTML = '';
                    configContent.appendChild(E('div', { 'class': 'error' }, 'Failed to load form: ' + (err && err.message ? err.message : String(err))));
                });
            }
        });

        var container = E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, 'Quick Actions'),
            E('div', { 'class': 'cbi-tabs' }, [dashTab, cfgTab]),
            dashboardContent,
            configContent
        ]);

        if (this.timerId) clearInterval(this.timerId);
        this.timerId = setInterval(function() { self.updateAllButtonsRealtime(); }, this.pollInterval * 1000);

        return container;
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
