
import { Extension, ExtensionMetadata } from 'resource:///org/gnome/shell/extensions/extension.js';
import { VSCodeWorkspacesCore } from './core.js';
export default class VSCodeWorkspacesExtension extends Extension {
    private core: VSCodeWorkspacesCore;
    constructor(metadata: ExtensionMetadata) {
        super(metadata);
        let gsettings = this.getSettings();
        this.core = new VSCodeWorkspacesCore(metadata, this.openPreferences, gsettings);
    }

    enable() {
        super.enable();
        this.core.enable();
    }

    disable() {
        super.disable();
        this.core.disable();
    }
}
