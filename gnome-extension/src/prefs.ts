import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class VSCodeWorkspacesPreferences extends ExtensionPreferences {
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
            title: _('editor Settings'),
            description: _('Configure various settings for interacting with editor'),
        });

        const editorLocationEntry = new Gtk.Entry({
            placeholder_text: currentEditorLocation, // Use current value as placeholder
            text: currentEditorLocation, // Set initial text to current value
        });

        const editorLocationHintRow = new Adw.ActionRow({
            title: _('editor Location Hint'),
            subtitle: _('Use "auto", a binary name (e.g., "code", "cursor"), or a full path'),
            activatable: false,
        });

        const editorLocation = new Adw.EntryRow({
            title: _('editor Location'),
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
                placeholder_text: _('Comma separated list of workspace directories to ignore from cleanup'),
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

        // Fix: Bind to the entry widget directly
        _settings.bind(
            'nofail-workspaces',
            nofailEntryWidget,
            'text',
            Gio.SettingsBindFlags.DEFAULT
        );

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

        // Create a save button to explicitly save settings
        const headerbar = window.get_titlebar();
        if (headerbar instanceof Adw.HeaderBar) {
            const saveButton = new Gtk.Button({
                label: _('Save'),
                css_classes: ['suggested-action'],
                valign: Gtk.Align.CENTER,
            });

            saveButton.connect('clicked', () => {
                this._saveSettings(_settings, settingsChanged);
                settingsChanged.clear(); // Clear the changes after saving
            });

            headerbar.pack_end(saveButton);
        }

        // Ensure settings are saved when the window is closed
        window.connect('close-request', () => {
            this._saveSettings(_settings, settingsChanged);
        });
    }

    // Updated method to explicitly save settings
    private _saveSettings(settings: Gio.Settings, changedSettings?: Set<string>): void {
        // Log which settings were changed
        if (changedSettings && changedSettings.size > 0 && settings.get_boolean('debug')) {
            console.log(`VSCode Workspaces: Saving changed settings: ${[...changedSettings].join(', ')}`);
        }

        // First apply all settings via the bindings
        settings.apply();

        // Force a sync to ensure settings are written to disk
        Gio.Settings.sync();

        // Log that settings were saved (if debug is enabled)
        if (settings.get_boolean('debug')) {
            console.log('VSCode Workspaces: Settings saved');
        }
    }
}
