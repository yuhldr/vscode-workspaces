import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import GLib from 'gi://GLib';

export default class VSCodeWorkspacesPreferences extends ExtensionPreferences {
    // Define the _saveSettings method as a class property with initial empty implementation
    private _saveSettings: (settings: Gio.Settings, changedSettings?: Set<string>) => void =
        () => { /* Default empty implementation */ };

    fillPreferencesWindow(window: Adw.PreferencesWindow) {
        const _settings = this.getSettings();
        const settingsChanged = new Set<string>(); // Track which settings have changed

        // Get current editor location value
        const currentEditorLocation = _settings.get_string('editor-location') || 'auto';

        // Debug: Log initial settings values
        if (_settings.get_boolean('debug')) {
            console.log('VSCode Workspaces: Initial settings values:');
            console.log(`- editor-location: ${currentEditorLocation}`);
            console.log(`- new-window: ${_settings.get_boolean('new-window')}`);
            console.log(`- custom-cmd-args: ${_settings.get_string('custom-cmd-args')}`);
            console.log(`- custom-icon: ${_settings.get_string('custom-icon')}`);
        }

        const page = new Adw.PreferencesPage({
            title: _('General'),
            iconName: 'dialog-information-symbolic',
        });

        // Group for New Window setting
        const newWindowGroup = new Adw.PreferencesGroup({
            title: _('New Window'),
            description: _('Configure whether to open editor in a new window'),
        });
        page.add(newWindowGroup);

        const newWindowSwitch = new Adw.SwitchRow({
            title: _('Open in New Window'),
            subtitle: _('Whether to open editor in a new window'),
        });
        newWindowGroup.add(newWindowSwitch);

        // Group for editor Location
        const editorGroup = new Adw.PreferencesGroup({
            title: _('Editor Settings'),
            description: _('Configure various settings for interacting with editor'),
        });

        const editorLocationEntry = new Gtk.Entry({
            placeholder_text: currentEditorLocation, // Use current value as placeholder
            text: currentEditorLocation, // Set initial text to current value
        });

        const editorLocationHintRow = new Adw.ActionRow({
            title: _('Editor Location'),
            subtitle: _('Use "auto", a binary name (e.g., "code", "cursor"), or a full path'),
            activatable: false,
        });

        const editorLocation = new Adw.EntryRow({
            showApplyButton: true,
            inputPurpose: Gtk.InputPurpose.FREE_FORM,
            inputHints: Gtk.InputHints.WORD_COMPLETION,
            child: editorLocationEntry
        });


        const debug = new Adw.SwitchRow({
            title: _('Debug'),
            subtitle: _('Whether to enable debug logging'),
        });

        const preferWorkspaceFile = new Adw.SwitchRow({
            title: _('Prefer Workspace File'),
            subtitle: _('Whether to prefer the workspace file over the workspace directory if a workspace file is present'),
        });

        const customCmdArgs = new Adw.EntryRow({
            title: _('Custom CMD Args'),
            showApplyButton: true,
            inputPurpose: Gtk.InputPurpose.FREE_FORM,
            inputHints: Gtk.InputHints.NONE,
            child: new Gtk.Entry({
                placeholder_text: _('Custom command line arguments for launching the editor'),
            })
        });

        editorGroup.add(editorLocationHintRow);
        editorGroup.add(editorLocation);
        editorGroup.add(preferWorkspaceFile);
        editorGroup.add(debug);
        editorGroup.add(customCmdArgs);
        page.add(editorGroup);

        // Group for Refresh Interval setting
        const refreshIntervalGroup = new Adw.PreferencesGroup({
            title: _('Refresh Interval'),
            description: _('Configure the refresh interval for the extension'),
        });
        page.add(refreshIntervalGroup);

        const refreshGroupEntry = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 3600,
                step_increment: 1,
            }),
        });
        refreshIntervalGroup.add(refreshGroupEntry);

        // Group for Custom Icon
        const iconGroup = new Adw.PreferencesGroup({
            title: _('Custom Icon'),
            description: _('Configure a custom icon for the extension'),
        });
        page.add(iconGroup);

        const customIconEntry = new Adw.EntryRow({
            title: _('Custom Icon Path'),
            showApplyButton: true,
            inputPurpose: Gtk.InputPurpose.FREE_FORM,
            inputHints: Gtk.InputHints.WORD_COMPLETION,
            child: new Gtk.Entry({
                placeholder_text: _('Enter a theme icon name or path to an icon file'),
            })
        });
        iconGroup.add(customIconEntry);

        const iconInfoRow = new Adw.ActionRow({
            title: _('Icon Info'),
            subtitle: _('You can specify either a theme icon name (e.g., "code-symbolic") or a full path to an image file'),
            activatable: false,
        });
        iconGroup.add(iconInfoRow);

        // Add new group for Cleanup Settings at end of fillPreferencesWindow

        const cleanupGroup = new Adw.PreferencesGroup({
            title: _('Cleanup Settings'),
            description: _('Advanced settings for workspace cleanup'),
        });

        // Switch row for Cleanup Orphaned Workspaces
        const cleanupSwitch = new Adw.SwitchRow({
            title: _('Cleanup Orphaned Workspaces'),
            subtitle: _('Enable automatic cleanup of orphaned workspace directories'),
        });
        cleanupGroup.add(cleanupSwitch);

        // Entry row for No-fail Workspaces (comma separated)
        const nofailEntry = new Adw.EntryRow({
            title: _('No-fail Workspaces'),
            showApplyButton: true,
            inputPurpose: Gtk.InputPurpose.FREE_FORM,
            inputHints: Gtk.InputHints.WORD_COMPLETION,
            child: new Gtk.Entry({
                placeholder_text: _('Comma separated list of workspace directories to ignore for cleanup'),
            })
        });
        cleanupGroup.add(nofailEntry);

        page.add(cleanupGroup);

        // Set up change tracking for editorLocation
        editorLocationEntry.connect('changed', () => {
            settingsChanged.add('editor-location');
        });

        // Set up change tracking for other settings
        const setupChangeTracking = (widget: Gtk.Widget, settingKey: string) => {
            if (widget instanceof Gtk.Entry) {
                widget.connect('changed', () => {
                    settingsChanged.add(settingKey);
                });
            } else if (widget instanceof Gtk.Switch) {
                widget.connect('notify::active', () => {
                    settingsChanged.add(settingKey);
                });
            } else if (widget instanceof Gtk.SpinButton) {
                widget.connect('value-changed', () => {
                    settingsChanged.add(settingKey);
                });
            }
        };

        // Track changes for various settings
        setupChangeTracking(editorLocationEntry, 'editor-location');
        setupChangeTracking(refreshGroupEntry, 'refresh-interval');

        // Track changes for switch controls
        setupChangeTracking(newWindowSwitch, 'new-window');
        setupChangeTracking(debug, 'debug');
        setupChangeTracking(preferWorkspaceFile, 'prefer-workspace-file');
        setupChangeTracking(cleanupSwitch, 'cleanup-orphaned-workspaces');

        // Track changes for entry rows - ensure we track the actual entry widgets
        const customCmdArgsEntry = customCmdArgs.child as Gtk.Entry;
        const customIconEntryWidget = customIconEntry.child as Gtk.Entry;
        const nofailEntryWidget = nofailEntry.child as Gtk.Entry;
        setupChangeTracking(customCmdArgsEntry, 'custom-cmd-args');
        setupChangeTracking(customIconEntryWidget, 'custom-icon');
        setupChangeTracking(nofailEntryWidget, 'nofail-workspaces');

        // Bind settings
        _settings.bind(
            'new-window',
            newWindowSwitch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Fix: Bind to the entry widget directly instead of the EntryRow
        _settings.bind(
            'editor-location',
            editorLocationEntry,
            'text',
            Gio.SettingsBindFlags.DEFAULT
        );

        _settings.bind(
            'debug',
            debug,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        _settings.bind(
            'prefer-workspace-file',
            preferWorkspaceFile,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        _settings.bind(
            'refresh-interval',
            refreshGroupEntry,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Fix: Bind to the entry widget directly for EntryRows
        _settings.bind(
            'custom-cmd-args',
            customCmdArgsEntry,
            'text',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Bind new settings
        _settings.bind(
            'cleanup-orphaned-workspaces',
            cleanupSwitch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Fix issue with nofail-workspaces binding (text entry vs array of strings)
        // First, initialize the entry with comma-separated string from the array
        const nofailArray = _settings.get_strv('nofail-workspaces') || [];
        const nofailString = nofailArray.join(', ');
        nofailEntryWidget.set_text(nofailString);

        // Track changes to the text field
        nofailEntryWidget.connect('changed', () => {
            settingsChanged.add('nofail-workspaces');
        });

        // Do NOT bind directly since the types are incompatible
        // Instead of using the standard binding, we'll manually handle the saving

        // Modify the save function to properly handle the array conversion
        this._saveSettings = (settings: Gio.Settings, changedSettings?: Set<string>): void => {
            // Log which settings were changed
            if (changedSettings && changedSettings.size > 0 && settings.get_boolean('debug')) {
                console.log(`VSCode Workspaces: Saving changed settings: ${[...changedSettings].join(', ')}`);
            }

            // First apply all regular bound settings via the bindings
            settings.apply();

            // Special handling for nofail-workspaces (convert text to string array)
            if (changedSettings?.has('nofail-workspaces') || true) {
                const text = nofailEntryWidget.get_text() || '';
                const values = text.split(',')
                    .map(s => s.trim())
                    .filter(s => s.length > 0);

                settings.set_strv('nofail-workspaces', values);

                if (settings.get_boolean('debug')) {
                    console.log(`VSCode Workspaces: Saved nofail-workspaces as array: [${values.join(', ')}]`);
                }
            }

            // Force a sync to ensure settings are written to disk
            Gio.Settings.sync();

            // Log that settings were saved (if debug is enabled)
            if (settings.get_boolean('debug')) {
                console.log('VSCode Workspaces: Settings saved');
            }
        };

        // Bind custom icon setting
        _settings.bind(
            'custom-icon',
            customIconEntryWidget,
            'text',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Show the window
        // Add the page to the window
        window.add(page);

        // Ensure settings are saved when the window is closed
        window.connect('close-request', () => {
            this._saveSettings(_settings, settingsChanged);
        });
    }
}
