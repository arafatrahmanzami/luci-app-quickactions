'use strict';
'require view';
'require form';

return view.extend({
    load: function() {
        return Promise.resolve();
    },

    render: function() {
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

        o = s2.option(form.Value, 'icon', _('Custom Icon / Emoji'), _('Paste a single emoji icon to prepend to matching buttons (e.g., 🌐, 🔒, ⚡).'));
        o.placeholder = '⚙️';

        o = s2.option(form.Flag, 'dangerous', _('Require Confirmation'),
            _('If enabled, forcing a warning popup before running the script to prevent accidental downtime.'));
        o.rmempty = false;

        return m.render();
    }
});
