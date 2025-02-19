import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import { Extension, gettext } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// TODO: Add notifications for errors
// TODO: Implement support for snap, and flatpak installations

// TODO: Show project tags
// TODO: View as tags
// TODO: Filter by tags
// TODO: Sort by Path, Recent, Saved

interface Workspace {
    uri: string;
    storeDir: Gio.File | null;
    nofail?: boolean;
    remote?: boolean; // true if workspace is remote (vscode-remote:// or docker://)
}

interface RecentWorkspace {
    name: string;
    path: string;
    softRemove: () => void;
    removeWorkspaceItem: () => void;
}

interface EditorPath {
    name: string;
    binary: string;
    workspacePath: string;
    isDefault?: boolean;
}

const FILE_URI_PREFIX = 'file://';

export default class VSCodeWorkspacesExtension extends Extension {
    gsettings?: Gio.Settings;

    private _indicator?: PanelMenu.Button;
    private _refreshInterval: number = 30;
    private _refreshTimeout: number | null = null;
    private _newWindow: boolean = false;
    private _editorLocation: string = '';
    private _preferCodeWorkspaceFile: boolean = false;
    private _debug: boolean = false;
    private _workspaces: Set<Workspace> = new Set();
    private _recentWorkspaces: Set<RecentWorkspace> = new Set();
    private readonly _userConfigDir: string = GLib.build_filenamev([GLib.get_home_dir(), '.config']);
    private _foundEditors: EditorPath[] = [];
    private _activeEditor?: EditorPath;
    private readonly _editors: EditorPath[] = [
        {
            name: 'vscode',
            binary: 'code',
            workspacePath: GLib.build_filenamev([this._userConfigDir, 'Code/User/workspaceStorage']),
            isDefault: true,
        },
        {
            name: 'codium',
            binary: 'codium',
            workspacePath: GLib.build_filenamev([this._userConfigDir, 'VSCodium/User/workspaceStorage']),
        },
        {
            name: 'code-insiders',
            binary: 'code-insiders',
            workspacePath: GLib.build_filenamev([this._userConfigDir, 'Code - Insiders/User/workspaceStorage']),
        },
    ];
    private readonly _iconNames = ['code', 'vscode', 'vscodium', 'codium', 'code-insiders'];
    private _menuUpdating: boolean = false;
    private _cleanupOrphanedWorkspaces: boolean = false;
    private _nofailList: string[] = [];
    private _customCmdArgs: string = '';
    private _favorites: Set<string> = new Set();

    enable() {
        this.gsettings = this.getSettings();

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        let iconName = 'code';
        for (const name of this._iconNames) {
            if (this._iconExists(name)) {
                iconName = name;
                break;
            }
        }

        const icon = new St.Icon({
            icon_name: iconName,
            style_class: 'system-status-icon',
        });

        this._indicator.add_child(icon);

        Main.panel.addToStatusArea(this.metadata.uuid, this._indicator);
        this._setSettings();

        this.gsettings.connect('changed', () => {
            this._setSettings();
            this._startRefresh();
        });
        this._initializeWorkspaces();
    }

    disable() {
        // Persist settings before cleaning up
        this._persistSettings();
        this._cleanup();
        if (this._refreshTimeout) {
            GLib.source_remove(this._refreshTimeout);
            this._refreshTimeout = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = undefined;
        }
        this.gsettings = undefined;
        this._log(`VSCode Workspaces Extension disabled`);
    }

    private _persistSettings() {
        if (!this.gsettings) return;
        // Persist the user settings so they remain across reboots
        this.gsettings.set_strv('nofail-workspaces', this._nofailList);
        this.gsettings.set_string('custom-cmd-args', this._customCmdArgs);
        this.gsettings.set_strv('favorite-workspaces', Array.from(this._favorites));

        this.getSettings().set_boolean('new-window', this._newWindow);
        this.getSettings().set_string('editor-location', this._editorLocation);
        this.getSettings().set_int('refresh-interval', this._refreshInterval);
        this.getSettings().set_boolean('prefer-workspace-file', this._preferCodeWorkspaceFile);
        this.getSettings().set_boolean('debug', this._debug);
        this.getSettings().set_boolean('cleanup-orphaned-workspaces', this._cleanupOrphanedWorkspaces);

        this._log('Persisted settings to gsettings');
    }

    private _cleanup() {
        // Clean up only the cache; leave persistent settings intact
        this._workspaces.clear();
        this._recentWorkspaces.clear();
        this._log(`VSCode Workspaces Extension cleaned up`);
    }

    private _initializeWorkspaces() {
        this._log('Initializing workspaces');

        for (const editor of this._editors) {
            const dir = Gio.File.new_for_path(editor.workspacePath);

            this._log(`Checking for ${editor.name} workspace storage directory: ${editor.workspacePath}`);

            if (!dir.query_exists(null)) {
                this._log(`No ${editor.name} workspace storage directory found: ${editor.workspacePath}`);
                continue;
            }

            this._log(`Found ${editor.name} workspace storage directory: ${editor.workspacePath}`);
            this._foundEditors.push(editor);
        }

        this._log(`Found editors: ${this._foundEditors.map(editor => editor.name)}`);

        this._setActiveEditor();

        this._log(`Active editor: ${this._activeEditor?.name}`);

        if (!this._activeEditor) {
            this._log('No active editor found');
            return;
        }
        this._refresh();
    }

    private _setActiveEditor() {
        const editorLocation = this._editorLocation;
        if (editorLocation === 'auto') {
            this._activeEditor = this._foundEditors.find(editor => editor.isDefault) ?? this._foundEditors[0];
        } else {
            this._activeEditor = this._foundEditors.find(editor => editor.binary === editorLocation) ?? this._foundEditors[0];
        }

        if (!this._activeEditor && this._foundEditors.length > 0) {
            this._activeEditor = this._foundEditors[0];
        }

        if (this._activeEditor) {
            this._log(`Active editor set to: ${this._activeEditor.name}`);
        } else {
            this._log('No editor found!');
        }
    }

    private _setSettings() {
        if (!this.gsettings) {
            this._log('Settings not found');
            return;
        }

        this._newWindow = this.gsettings.get_value('new-window').deepUnpack() ?? false;
        this._editorLocation = this.gsettings.get_value('editor-location').deepUnpack() ?? 'auto';
        this._refreshInterval = this.gsettings.get_value('refresh-interval').deepUnpack() ?? 300;
        this._preferCodeWorkspaceFile = this.gsettings.get_value('prefer-workspace-file').deepUnpack() ?? false;
        this._debug = this.gsettings.get_value('debug').deepUnpack() ?? false;
        this._cleanupOrphanedWorkspaces = this.gsettings.get_value('cleanup-orphaned-workspaces').deepUnpack() ?? false;
        this._nofailList = this.gsettings.get_value('nofail-workspaces').deepUnpack() ?? [];
        this._customCmdArgs = this.gsettings.get_value('custom-cmd-args').deepUnpack() ?? '';
        // Cast the unpacked value to string[] to satisfy the Set constructor
        const favs = (this.gsettings.get_value('favorite-workspaces').deepUnpack() as string[]) ?? [];
        this._favorites = new Set(favs);

        this._log(`New Window: ${this._newWindow}`);
        this._log(`Workspaces Storage Location: ${this._editorLocation}`);
        this._log(`Refresh Interval: ${this._refreshInterval}`);
        this._log(`Prefer Code Workspace File: ${this._preferCodeWorkspaceFile}`);
        this._log(`Debug: ${this._debug}`);
        this._log(`Cleanup Orphaned Workspaces: ${this._cleanupOrphanedWorkspaces}`);
        this._log(`No-fail workspaces: ${this._nofailList.join(', ')}`);
        this._log(`Custom CMD Args: ${this._customCmdArgs}`);
        this._log(`Favorite Workspaces: ${Array.from(this._favorites).join(', ')}`);
    }

    private _iconExists(iconName: string): boolean {
        try {
            const iconTheme = St.IconTheme.new();
            return iconTheme.has_icon(iconName);
        } catch (error) {
            console.error(error as object, 'Failed to check if icon exists');
            return false;
        }
    }

    private _createMenu() {
        if (!this._indicator) return;

        // If a menu update is in progress, skip this invocation
        if (this._menuUpdating) {
            this._log('Menu update skipped due to concurrent update');
            return;
        }
        this._menuUpdating = true;

        try {
            if (this._indicator.menu instanceof PopupMenu.PopupMenu && this._indicator.menu.isOpen) {
                this._indicator.menu.close(true);
            }

            (this._indicator.menu as PopupMenu.PopupMenu).removeAll();

            this._createRecentWorkspacesMenu();

            (this._indicator.menu as PopupMenu.PopupMenu).addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Add Settings and Quit items
            const itemSettings = new PopupMenu.PopupSubMenuMenuItem('Settings');
            const itemClearWorkspaces = new PopupMenu.PopupMenuItem('Clear Workspaces');
            itemClearWorkspaces.connect('activate', () => {
                this._clearRecentWorkspaces();
            });

            const itemRefresh = new PopupMenu.PopupMenuItem('Refresh');
            itemRefresh.connect('activate', () => {
                this._refresh();
            });

            itemSettings.menu.addMenuItem(itemClearWorkspaces);
            itemSettings.menu.addMenuItem(itemRefresh);
            (this._indicator.menu as PopupMenu.PopupMenu).addMenuItem(itemSettings);

            (this._indicator.menu as PopupMenu.PopupMenu).addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            if (this._foundEditors.length > 1) {
                const editorSelector = new PopupMenu.PopupSubMenuMenuItem('Select Editor');

                this._foundEditors.forEach(editor => {
                    const item = new PopupMenu.PopupMenuItem(editor.name);
                    const isActive = this._activeEditor?.binary === editor.binary;

                    if (isActive) {
                        item.setOrnament(PopupMenu.Ornament.DOT);
                    }

                    item.connect('activate', () => {
                        this._editorLocation = editor.binary;
                        this.gsettings?.set_string('editor-location', editor.binary);
                        this._setActiveEditor();
                        this._refresh();
                    });

                    editorSelector.menu.addMenuItem(item);
                });

                (this._indicator.menu as PopupMenu.PopupMenu).addMenuItem(editorSelector);
            }

            const itemQuit = new PopupMenu.PopupMenuItem('Quit');
            itemQuit.connect('activate', () => {
                this._quit();
            });

            (this._indicator.menu as PopupMenu.PopupMenu).addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            (this._indicator.menu as PopupMenu.PopupMenu).addMenuItem(itemQuit);
        } finally {
            this._menuUpdating = false;
        }
    }

    private _get_name(workspace: RecentWorkspace) {
        let nativePath = decodeURIComponent(workspace.path).replace(FILE_URI_PREFIX, '');
        let name = GLib.path_get_basename(nativePath);

        try {
            const file = Gio.File.new_for_path(nativePath);
            if (file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) === Gio.FileType.DIRECTORY) {
                const enumerator = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info: Gio.FileInfo | null;
                while ((info = enumerator.next_file(null)) !== null) {
                    const childName = info.get_name();
                    if (childName.endsWith('.code-workspace')) {
                        name = childName.replace('.code-workspace', '');
                        break;
                    }
                }
                enumerator.close(null);
            } else {
                if (name.endsWith('.code-workspace')) {
                    name = name.replace('.code-workspace', '');
                }
            }
        } catch (error) {
            // In case of error, fallback to the base name.
            console.error(error as object, 'Error getting workspace name');
        }
        name = name.replace(GLib.get_home_dir(), '~');
        return name;
    }

    private _get_full_path(workspace: RecentWorkspace) {
        let path = decodeURIComponent(workspace.path);
        path = path.replace(FILE_URI_PREFIX, '').replace(GLib.get_home_dir(), '~');
        return path;
    }

    private _createFavoriteButton(workspace: RecentWorkspace): St.Button {
        const starIcon = new St.Icon({
            icon_name: this._favorites.has(workspace.path) ? 'tag-outline-symbolic' : 'tag-outline-add-symbolic',
            style_class: 'favorite-icon',
        });

        if (this._favorites.has(workspace.path)) {
            starIcon.add_style_class_name('is-favorited');
        }

        const starButton = new St.Button({
            child: starIcon,
            style_class: 'icon-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        starButton.connect('clicked', () => {
            this._toggleFavorite(workspace);

            if (this._favorites.has(workspace.path)) {
                starIcon.add_style_class_name('is-favorited');
            } else {
                starIcon.remove_style_class_name('is-favorited');
            }
        });

        return starButton;
    }

    private _createTrashButton(workspace: RecentWorkspace): St.Button {
        const trashIcon = new St.Icon({
            icon_name: 'user-trash-symbolic',
            style_class: 'trash-icon',
        });
        const trashButton = new St.Button({
            child: trashIcon,
            style_class: 'icon-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        trashButton.connect('clicked', () => {
            workspace.softRemove();
        });

        return trashButton;
    }

    private _createItemContainer(workspace: RecentWorkspace): PopupMenu.PopupMenuItem {
        const item = new PopupMenu.PopupMenuItem('');
        item.actor.add_style_class_name('custom-menu-item');

        // Create a horizontal container for label and buttons
        const container = new St.BoxLayout({ style_class: 'workspace-box', vertical: false });

        // Label with expand:true so it takes up available space
        const label = new St.Label({ text: this._get_name(workspace) });
        container.set_x_expand(true);
        container.add_child(label);

        //const label = new St.Label({ text: this._get_name(workspace) });
        //item.actor.insert_child_at_index(label, 0);

        const starButton = this._createFavoriteButton(workspace);
        const trashButton = this._createTrashButton(workspace);

        container.add_child(starButton);
        container.add_child(trashButton);

        item.add_child(container);

        item.connect('activate', () => {
            this._openWorkspace(workspace.path);
        });

        let tooltip: St.Widget | null = null;
        item.actor.connect('enter-event', () => {
            tooltip = new St.Label({ text: this._get_full_path(workspace), style_class: 'workspace-tooltip' });
            const [x, y] = item.actor.get_transformed_position();
            const [minWidth, natWidth] = tooltip.get_preferred_width(-1);
            tooltip.set_position(x - Math.floor(natWidth / 1.15), y);
            Main.layoutManager.addChrome(tooltip);
        });
        item.actor.connect('leave-event', () => {
            if (tooltip) {
                Main.layoutManager.removeChrome(tooltip);
                tooltip = null;
            }
        });

        item.actor.connect('destroy', () => {
            if (tooltip) {
                Main.layoutManager.removeChrome(tooltip);
                tooltip = null;
            }
        });

        return item;
    }

    private _createRecentWorkspacesMenu() {
        if (this._recentWorkspaces?.size === 0) {
            this._log('No recent workspaces found');
            return;
        }

        const popupMenu = this._indicator?.menu as PopupMenu.PopupMenu;
        if (!popupMenu) return;

        // Partition favorites and others
        const favorites = Array.from(this._recentWorkspaces).filter(ws => this._favorites.has(ws.path));
        const others = Array.from(this._recentWorkspaces).filter(ws => !this._favorites.has(ws.path));

        // Clear existing recent menus if any
        // Create Favorites section if favorites exist
        if (favorites.length > 0) {
            const favSubMenu = new PopupMenu.PopupSubMenuMenuItem('Favorites');
            const favMenu = favSubMenu.menu;
            favorites.forEach(workspace => {
                const item = this._createItemContainer(workspace);
                favMenu.addMenuItem(item);
            });
            popupMenu.addMenuItem(favSubMenu);
            popupMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // Other recent workspaces
        const recentsSubMenu = new PopupMenu.PopupSubMenuMenuItem('Recent Workspaces');
        const recentsMenu = recentsSubMenu.menu;
        others.forEach(workspace => {
            const item = this._createItemContainer(workspace);
            recentsMenu.addMenuItem(item);
        });
        popupMenu.addMenuItem(recentsSubMenu);
    }

    private _parseWorkspaceJson(workspaceStoreDir: Gio.File): Workspace | null {
        try {
            const workspaceFile = Gio.File.new_for_path(
                GLib.build_filenamev([workspaceStoreDir.get_path()!, 'workspace.json'])
            );
            if (!workspaceFile.query_exists(null)) {
                this._log(`No workspace.json found in ${workspaceStoreDir.get_path()}`);
                return null;
            }
            const [, contents] = workspaceFile.load_contents(null);
            const decoder = new TextDecoder();
            const json = JSON.parse(decoder.decode(contents));
            const workspaceURI = (json.folder || json.workspace) as string | undefined;
            if (!workspaceURI) {
                this._log('No folder or workspace property found in workspace.json');
                return null;
            }
            // Determine if the workspace URI indicates a remote resource
            const remote = workspaceURI.startsWith('vscode-remote://') || workspaceURI.startsWith('docker://');
            const nofail = json.nofail === true;
            this._log(`Parsed workspace.json in ${workspaceStoreDir.get_path()} with ${workspaceURI} (nofail: ${nofail}, remote: ${remote})`);
            return { uri: workspaceURI, storeDir: workspaceStoreDir, nofail, remote };
        } catch (error) {
            console.error(error as object, 'Failed to parse workspace.json');
            return null;
        }
    }

    private _maybeUpdateWorkspaceNoFail(workspace: Workspace): void {
        // Determine the workspace name from its URI
        let workspaceName = GLib.path_get_basename(workspace.uri);
        if (workspaceName.endsWith('.code-workspace')) {
            workspaceName = workspaceName.replace('.code-workspace', '');
        }
        // If the workspace name is in our nofail list and not already marked, update the JSON
        if (this._nofailList.includes(workspaceName) && !workspace.nofail) {
            this._log(`Updating workspace '${workspaceName}' to set nofail: true`);
            // Construct workspace.json path
            if (!workspace.storeDir) return;
            const wsJsonPath = GLib.build_filenamev([workspace.storeDir.get_path()!, 'workspace.json']);
            const wsJsonFile = Gio.File.new_for_path(wsJsonPath);
            try {
                const [success, contents] = wsJsonFile.load_contents(null);
                if (!success) {
                    this._log(`Failed to load workspace.json for ${workspaceName}`);
                    return;
                }
                const decoder = new TextDecoder();
                let json = JSON.parse(decoder.decode(contents));
                json.nofail = true;
                const encoder = new TextEncoder();
                const newContents = encoder.encode(JSON.stringify(json, null, 2));
                // Replace the contents of the file
                wsJsonFile.replace_contents(newContents, null, false, Gio.FileCreateFlags.NONE, null);
                // Update the workspace object in memory
                workspace.nofail = true;
                this._log(`Successfully updated workspace.json for ${workspaceName}`);
            } catch (error) {
                console.error(error as object, `Failed to update workspace.json for ${workspaceName}`);
            }
        }
    }

    private _iterateWorkspaceDir(dir: Gio.File, callback: (workspace: Workspace) => void) {
        let enumerator: Gio.FileEnumerator | null = null;
        try {
            enumerator = dir.enumerate_children('standard::*,unix::uid', Gio.FileQueryInfoFlags.NONE, null);
            let info: Gio.FileInfo | null;
            while ((info = enumerator.next_file(null)) !== null) {
                const workspaceStoreDir = enumerator.get_child(info);
                this._log(`Checking ${workspaceStoreDir.get_path()}`);
                const workspace = this._parseWorkspaceJson(workspaceStoreDir);
                if (!workspace) continue;

                // Update workspace.json with nofail if needed
                this._maybeUpdateWorkspaceNoFail(workspace);

                const pathToWorkspace = Gio.File.new_for_uri(workspace.uri);
                if (!pathToWorkspace.query_exists(null)) {
                    this._log(`Workspace not found: ${pathToWorkspace.get_path()}`);
                    if (this._cleanupOrphanedWorkspaces && !workspace.nofail) {
                        this._log(`Workspace will be removed: ${pathToWorkspace.get_path()}`);
                        this._workspaces.delete(workspace);
                        const trashRes = workspace.storeDir?.trash(null);
                        if (!trashRes) {
                            this._log(`Failed to move workspace to trash: ${workspace.uri}`);
                        } else {
                            this._log(`Workspace trashed: ${workspace.uri}`);
                        }
                    } else {
                        this._log(`Skipping removal for workspace: ${workspace.uri} (cleanup enabled: ${this._cleanupOrphanedWorkspaces}, nofail: ${workspace.nofail})`);
                    }
                    continue;
                }
                if ([...this._workspaces].some(ws => ws.uri === workspace.uri)) {
                    this._log(`Workspace already exists: ${workspace.uri}`);
                    continue;
                }
                this._workspaces.add(workspace);
                callback(workspace);
            }
        } catch (error) {
            console.error(error as object, 'Error iterating workspace directory');
        } finally {
            if (enumerator) {
                if (!enumerator.close(null)) {
                    this._log('Failed to close enumerator');
                }
            }
        }
    }

    private _createRecentWorkspaceEntry(workspace: Workspace): RecentWorkspace {
        let workspaceName = GLib.path_get_basename(workspace.uri);
        if (workspaceName.endsWith('.code-workspace')) {
            workspaceName = workspaceName.replace('.code-workspace', '');
        }
        return {
            name: workspaceName,
            path: workspace.uri,
            softRemove: () => {
                this._log(`Moving Workspace to Trash: ${workspaceName}`);
                this._workspaces.delete(workspace);
                this._recentWorkspaces = new Set(
                    Array.from(this._recentWorkspaces).filter(
                        recentWorkspace => recentWorkspace.path !== workspace.uri
                    )
                );
                const trashRes = workspace.storeDir?.trash(null);
                if (!trashRes) {
                    this._log(`Failed to move ${workspaceName} to trash`);
                    return;
                }
                this._log(`Workspace Trashed: ${workspaceName}`);
                this._createMenu();
            },
            removeWorkspaceItem: () => {
                this._log(`Removing workspace: ${workspaceName}`);
                this._workspaces.delete(workspace);
                this._recentWorkspaces = new Set(
                    Array.from(this._recentWorkspaces).filter(
                        recentWorkspace => recentWorkspace.path !== workspace.uri
                    )
                );
                workspace.storeDir?.delete(null);
                this._createMenu();
            },
        };
    }

    private _getRecentWorkspaces() {
        try {
            const activeEditorPath = this._activeEditor?.workspacePath;
            if (!activeEditorPath) return;
            const dir = Gio.File.new_for_path(activeEditorPath);
            this._iterateWorkspaceDir(dir, (workspace: Workspace) => {
                // Log preference and, if preferring, perform .code-workspace check
                if (!this._preferCodeWorkspaceFile) {
                    this._log(`Not preferring code-workspace file for ${workspace.uri}`);
                } else {
                    const pathToWorkspace = Gio.File.new_for_uri(workspace.uri);
                    if (pathToWorkspace.query_file_type(Gio.FileQueryInfoFlags.NONE, null) !== Gio.FileType.DIRECTORY) {
                        this._log(`Not a directory: ${pathToWorkspace.get_path()}`);
                        return;
                    }
                    const enumerator = pathToWorkspace.enumerate_children('standard::*,unix::uid', Gio.FileQueryInfoFlags.NONE, null);
                    let info: Gio.FileInfo | null;
                    let workspaceFilePath: string | null = null;
                    while ((info = enumerator.next_file(null)) !== null) {
                        const file = enumerator.get_child(info);
                        if (file.get_basename()?.endsWith('.code-workspace')) {
                            workspaceFilePath = file.get_path();
                            break;
                        }
                    }
                    if (!enumerator.close(null)) {
                        throw new Error('Failed to close enumerator');
                    }
                    this._log(`Checked for .code-workspace: ${workspaceFilePath}`);
                    if (!workspaceFilePath) return;
                    const workspaceFile = Gio.File.new_for_path(workspaceFilePath);
                    if (!workspaceFile.query_exists(null)) {
                        this._log(`.code-workspace file does not exist in ${workspace.uri}`);
                        return;
                    }
                }
            });

            const sortedWorkspaces = Array.from(this._workspaces).sort((a, b) => {
                const aInfo = Gio.File.new_for_uri(a.uri).query_info('unix::atime', Gio.FileQueryInfoFlags.NONE, null);
                const bInfo = Gio.File.new_for_uri(b.uri).query_info('unix::atime', Gio.FileQueryInfoFlags.NONE, null);
                const aAtime = aInfo ? aInfo.get_attribute_uint64('unix::atime') : 0;
                const bAtime = bInfo ? bInfo.get_attribute_uint64('unix::atime') : 0;
                return bAtime - aAtime;
            });

            this._log(`[Workspace Cache]: ${sortedWorkspaces.map(ws => ws.uri)}`);
            this._recentWorkspaces = new Set(sortedWorkspaces.map(ws => this._createRecentWorkspaceEntry(ws)));
            this._log(`[Recent Workspaces]: ${Array.from(this._recentWorkspaces).map(rw => rw.path)}`);
        } catch (e) {
            console.error(e as object, 'Failed to load recent workspaces');
        }
    }

    private _launchVSCode(files: string[]): void {
        this._log(`Launching VSCode with files: ${files.join(', ')}`);
        try {
            const filePaths: string[] = [];
            const dirPaths: string[] = [];

            files.forEach(file => {
                if (GLib.file_test(file, GLib.FileTest.IS_DIR)) {
                    this._log(`Found a directory: ${file}`);
                    dirPaths.push(file);
                } else {
                    this._log(`Found a file: ${file}`);
                    filePaths.push(file);
                }
            });

            // Build arguments array for consistency
            const args: string[] = [];
            if (this._newWindow) {
                args.push('--new-window');
            }

            if (dirPaths.length > 0) {
                args.push('--folder-uri');
                args.push(...dirPaths.map(dir => `"${dir}"`));
            }

            if (filePaths.length > 0) {
                if (dirPaths.length === 0) {
                    args.push('--file-uri');
                }
                args.push(...filePaths.map(file => `"${file}"`));
            }

            // Append custom command arguments if provided
            if (this._customCmdArgs && this._customCmdArgs.trim() !== '') {
                args.push(this._customCmdArgs.trim());
            }

            let command = this._activeEditor?.binary;
            if (!command) throw new Error('No active editor found');

            command += ` ${args.join(' ')}`;
            this._log(`Command to execute: ${command}`);
            GLib.spawn_command_line_async(command);
        } catch (error) {
            console.error(error as object, `Failed to launch ${this._activeEditor?.name}`);
        }
    }

    private _openWorkspace(workspacePath: string) {
        this._log(`Opening workspace: ${workspacePath}`);
        this._launchVSCode([workspacePath]);
    }

    private _clearRecentWorkspaces() {
        this._log('Clearing recent workspaces');
        try {
            if (
                !GLib.file_test(
                    this._activeEditor?.workspacePath!,
                    GLib.FileTest.EXISTS | GLib.FileTest.IS_DIR
                )
            ) {
                throw new Error('Recent workspaces directory does not exist');
            }
            // Create a backup of the directory before deleting it
            const backupPath = `${this._activeEditor?.workspacePath!}.bak`;
            const backupDir = Gio.File.new_for_path(backupPath);
            const recentWorkspacesDir = Gio.File.new_for_path(this._activeEditor?.workspacePath!);

            if (backupDir.query_exists(null)) {
                throw new Error('Backup directory already exists');
            }

            this._log(`Creating backup of ${this._activeEditor?.workspacePath!} to ${backupPath}`);

            const res = recentWorkspacesDir.copy(
                backupDir,
                Gio.FileCopyFlags.OVERWRITE,
                null,
                null
            );

            if (res === null) {
                throw new Error('Failed to create backup');
            }

            this._log('Backup created successfully');

            recentWorkspacesDir.enumerate_children_async(
                'standard::*,unix::uid',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (recentWorkspace, recentWorkspaceRes) => {
                    const iter = recentWorkspacesDir.enumerate_children_finish(recentWorkspaceRes);
                    try {
                        let info: Gio.FileInfo | null;

                        while ((info = iter.next_file(null)) !== null) {
                            const file = iter.get_child(info);
                            if (
                                file.query_file_type(Gio.FileQueryInfoFlags.NONE, null) !==
                                Gio.FileType.DIRECTORY
                            ) {
                                continue;
                            }

                            this._log(`Deleting ${file.get_path()}`);
                            file.delete(null);
                        }

                        iter.close_async(GLib.PRIORITY_DEFAULT, null, (_iter, _res) => {
                            try {
                                _iter?.close_finish(_res);
                            } catch (error) {
                                console.error(error as object, 'Failed to close iterator');
                            }
                        });
                    } catch (error) {
                        console.error(error as object, 'Failed to delete recent workspaces');
                    }
                }
            );

            this._cleanup();

            this._refresh();
        } catch (e) {
            console.error(`Failed to clear recent workspaces: ${e}`);
        }
    }

    private _quit() {
        this._log('Quitting VSCode Workspaces Extension');
        this.disable();
    }

    private _startRefresh() {
        if (this._refreshTimeout) {
            GLib.source_remove(this._refreshTimeout);
            this._refreshTimeout = null;
        }
        this._refreshTimeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this._refreshInterval,
            () => {
                // Load recent workspaces
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    private _refresh() {
        this._getRecentWorkspaces();
        this._createMenu();
    }

    private _log(message: any): void {
        if (!this._debug) {
            return;
        }

        console.log(gettext(`[${this.metadata.name}]: ${message}`));
    }

    private _toggleFavorite(workspace: RecentWorkspace) {
        if (this._favorites.has(workspace.path)) {
            this._favorites.delete(workspace.path);
            this._log(`Removed favorite: ${workspace.path}`);
        } else {
            this._favorites.add(workspace.path);
            this._log(`Added favorite: ${workspace.path}`);
        }
        this._persistSettings();
        this._refresh();
    }
}
